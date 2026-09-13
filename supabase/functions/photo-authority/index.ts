import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../../src/types/database.ts';
import { validatePhoto } from './validate-photo.ts';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
const bucketName = 'challenge-submissions';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers });
  if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
  try {
    const token = request.headers.get('Authorization')?.match(/^Bearer (\S+)$/i)?.[1];
    if (!token) return reply({ error: 'authentication_required' }, 401);
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_ANON_KEY');
    const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key || !secret) return reply({ error: 'service_unavailable' }, 503);
    const options = { auth: { persistSession: false, autoRefreshToken: false } };
    // Verify with Auth, never decode a JWT and trust its claimed user ID.
    const userClient = createClient<Database>(url, key, {
      ...options,
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const auth = await userClient.auth.getUser(token);
    if (auth.error || !auth.data.user) return reply({ error: 'authentication_required' }, 401);
    // Bound JSON input even when Content-Length is omitted or dishonest.
    const reader = request.body?.getReader();
    if (!reader) return reply({ error: 'invalid_request' }, 400);
    let raw = '',
      length = 0;
    const decoder = new TextDecoder();
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > 2048) {
        await reader.cancel();
        return reply({ error: 'invalid_request' }, 413);
      }
      raw += decoder.decode(part.value, { stream: true });
    }
    raw += decoder.decode();
    const body: unknown = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return reply({ error: 'invalid_request' }, 400);
    const input = body as Record<string, unknown>;
    if (input.action === 'previews') {
      const ids = input.submissionIds;
      if (
        !Array.isArray(ids) ||
        ids.length < 1 ||
        ids.length > 24 ||
        ids.some((id) => typeof id !== 'string' || !uuid.test(id)) ||
        new Set(ids.map((id) => String(id).toLowerCase())).size !== ids.length
      )
        return reply({ error: 'invalid_request' }, 400);
      // One owner/RLS query and one Storage batch. No client paths or TTLs.
      const rows = await userClient
        .from('submissions')
        .select('id,storage_path')
        .eq('user_id', auth.data.user.id)
        .eq('status', 'completed')
        .in('id', ids);
      if (rows.error) return reply({ error: 'service_unavailable' }, 503);
      const admin = createClient<Database>(url, secret, options);
      const signed = rows.data.length
        ? await admin.storage.from(bucketName).createSignedUrls(
            rows.data.map((s) => s.storage_path),
            60,
          )
        : { data: [], error: null };
      if (signed.error) return reply({ error: 'service_unavailable' }, 503);
      // Missing, deleted, pending and other-account IDs are indistinguishable.
      return reply({
        previews: ids.map((id) => {
          const row = rows.data.find((s) => s.id === String(id).toLowerCase());
          const photo = row && signed.data?.find((s) => s.path === row.storage_path);
          const uri = photo?.signedUrl && !photo.error ? new URL(photo.signedUrl) : null;
          return { id, signedPath: uri ? uri.pathname + uri.search : null };
        }),
      });
    }
    if (
      typeof input.submissionId !== 'string' ||
      !uuid.test(input.submissionId) ||
      !['preview', 'finalize'].includes(String(input.action))
    )
      return reply({ error: 'invalid_request' }, 400);
    const { data: submission, error } = await userClient
      .from('submissions')
      .select('*')
      .eq('id', input.submissionId)
      .eq('user_id', auth.data.user.id)
      .single();
    if (error || !submission || submission.status === 'deleted')
      return reply({ error: 'submission_unavailable' }, 404);
    const admin = createClient<Database>(url, secret, options);
    const bucket = admin.storage.from(bucketName);
    if (input.action === 'preview') {
      // No caller path, transformations, download metadata or TTL is forwarded.
      const signed = await bucket.createSignedUrl(submission.storage_path, 60);
      if (signed.error) {
        if (['Object not found', 'The resource was not found'].includes(signed.error.message))
          return reply({ signedPath: null });
        return reply({ error: 'service_unavailable' }, 503);
      }
      const signedUrl = new URL(signed.data.signedUrl);
      return reply({ signedPath: signedUrl.pathname + signedUrl.search });
    }
    if (!['private', 'public'].includes(String(input.visibility)))
      return reply({ error: 'invalid_visibility' }, 400);
    if (submission.status !== 'completed') {
      if (submission.status !== 'pending') return reply({ error: 'submission_unavailable' }, 409);
      const target = await admin.rpc('photo_verification_target', {
        submission_id: submission.id,
        expected_user_id: auth.data.user.id,
      });
      if (target.error) return reply({ error: 'service_unavailable' }, 503);
      if (!target.data) {
        // A concurrent request may have finalized between our first read and this
        // lookup. The owner RPC only accepts an already-verified object or returns
        // its committed result; it cannot manufacture verification on this retry.
        const recovered = await userClient.rpc('finalize_submission', {
          submission_id: submission.id,
          requested_visibility: String(input.visibility),
        });
        if (!recovered.error) return reply({ submission: recovered.data });
        return reply({ error: 'photo_not_uploaded' }, 409);
      }
      if (
        typeof target.data !== 'object' ||
        Array.isArray(target.data) ||
        typeof target.data.id !== 'string' ||
        typeof target.data.version !== 'string'
      )
        return reply({ error: 'service_unavailable' }, 503);
      const photo = await bucket.download(submission.storage_path);
      if (photo.error) return reply({ error: 'photo_not_uploaded' }, 409);
      if (photo.data.size > 5 * 1024 * 1024) return reply({ error: 'invalid_photo' }, 422);
      const bytes = new Uint8Array(await photo.data.arrayBuffer());
      let dimensions;
      try {
        dimensions = validatePhoto(bytes);
      } catch {
        return reply({ error: 'invalid_photo' }, 422);
      }
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const sha256 = Array.from(new Uint8Array(digest), (b) =>
        b.toString(16).padStart(2, '0'),
      ).join('');
      const attested = await admin.rpc('attest_submission_photo', {
        submission_id: submission.id,
        expected_user_id: auth.data.user.id,
        expected_object_id: target.data.id,
        expected_object_version: target.data.version,
        image_sha256: sha256,
        image_width: dimensions.width,
        image_height: dimensions.height,
      });
      if (attested.error) return reply({ error: 'submission_unavailable' }, 409);
    }
    // Final state and visibility remain authorized by the original owner RPC.
    const finished = await userClient.rpc('finalize_submission', {
      submission_id: submission.id,
      requested_visibility: String(input.visibility),
    });
    if (finished.error) return reply({ error: 'submission_unavailable' }, 409);
    return reply({ submission: finished.data });
  } catch {
    // Never return/log Storage paths, tokens, parser internals or privileged errors.
    return reply({ error: 'photo_request_failed' }, 400);
  }
});
