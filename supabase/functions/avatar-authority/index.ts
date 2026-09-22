import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../../src/types/database.ts';
import { handleAvatar, type Verification } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL');
const publicKey = Deno.env.get('SUPABASE_ANON_KEY');
const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const options = { auth: { persistSession: false, autoRefreshToken: false } };
Deno.serve((request: Request) => {
  if (!url || !publicKey || !secret) return new Response(null, { status: 503 });
  const auth = createClient<Database>(url, publicKey, options);
  const admin = createClient<Database>(url, secret, options);
  const bucket = admin.storage.from('profile-avatars');
  return handleAvatar(request, {
    async authenticate(token) {
      const result = await auth.auth.getUser(token);
      return result.error ? null : (result.data.user?.id ?? null);
    },
    async targets(viewer, ids) {
      const result = await admin.rpc('get_avatar_targets', { viewer, avatar_ids: ids });
      if (result.error) throw result.error;
      return result.data;
    },
    async sign(paths) {
      const result = await bucket.createSignedUrls(paths, 60);
      if (result.error) throw result.error;
      return result.data;
    },
    async verification(viewer, id) {
      const result = await admin.rpc('avatar_verification_target', {
        avatar_id: id,
        expected_user_id: viewer,
      });
      if (result.error) throw result.error;
      const value = result.data;
      if (value === null) return null;
      if (
        typeof value !== 'object' ||
        Array.isArray(value) ||
        typeof value.id !== 'string' ||
        typeof value.storage_path !== 'string' ||
        !['pending', 'current'].includes(String(value.status)) ||
        (value.object_id !== null && typeof value.object_id !== 'string') ||
        (value.object_version !== null && typeof value.object_version !== 'string')
      )
        throw new Error('invalid_verification');
      const target: Verification = {
        id: value.id,
        storage_path: value.storage_path,
        status: value.status === 'current' ? 'current' : 'pending',
        object_id: value.object_id,
        object_version: value.object_version,
      };
      return target;
    },
    async download(path) {
      const result = await bucket.download(path);
      if (result.error) throw result.error;
      return result.data;
    },
    async activate(viewer, target, proof) {
      if (!target.object_id || !target.object_version) throw new Error('missing_object');
      const result = await admin.rpc('activate_profile_avatar', {
        avatar_id: target.id,
        expected_user_id: viewer,
        expected_object_id: target.object_id,
        expected_object_version: target.object_version,
        image_sha256: proof.sha256,
        image_width: proof.width,
        image_height: proof.height,
      });
      if (result.error) throw result.error;
      return result.data;
    },
  });
});
