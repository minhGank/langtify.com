import { validatePhoto } from '../photo-authority/validate-photo.ts';

type Target = { id: string; storage_path: string };
export type Verification = Target & {
  status: 'pending' | 'current';
  object_id: string | null;
  object_version: string | null;
};
export type AvatarAuthority = {
  authenticate: (token: string) => Promise<string | null>;
  targets: (viewer: string, ids: string[]) => Promise<Target[]>;
  sign: (
    paths: string[],
  ) => Promise<{ path: string | null; signedUrl: string | null; error?: string | null }[]>;
  verification: (viewer: string, id: string) => Promise<Verification | null>;
  download: (path: string) => Promise<Blob>;
  activate: (
    viewer: string,
    target: Verification,
    proof: { sha256: string; width: number; height: number },
  ) => Promise<unknown>;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
async function input(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('invalid_request');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > 2048) {
      await reader.cancel();
      throw new Error('invalid_request');
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid_request');
  return value as Record<string, unknown>;
}
export function validateAvatar(bytes: Uint8Array) {
  if (bytes.length > 1048576) throw new Error('invalid_avatar');
  const dimensions = validatePhoto(bytes);
  if (dimensions.width > 512 || dimensions.height > 512) throw new Error('invalid_avatar');
  return dimensions;
}
export async function handleAvatar(
  request: Request,
  authority: AvatarAuthority,
): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { headers });
  if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
  try {
    const token = request.headers.get('Authorization')?.match(/^Bearer (\S+)$/i)?.[1];
    const viewer = token ? await authority.authenticate(token) : null;
    if (!viewer) return reply({ error: 'authentication_required' }, 401);
    const body = await input(request);
    if (body.action === 'previews') {
      const ids = body.avatarIds;
      if (
        !Array.isArray(ids) ||
        ids.length < 1 ||
        ids.length > 24 ||
        ids.some((id) => typeof id !== 'string' || !uuid.test(id)) ||
        new Set(ids.map((id) => String(id).toLowerCase())).size !== ids.length
      )
        return reply({ error: 'invalid_request' }, 400);
      const targets = await authority.targets(viewer, ids);
      const signed = targets.length
        ? await authority.sign(targets.map((target) => target.storage_path))
        : [];
      const items = targets.map((target) => {
        const photo = signed.find((entry) => entry.path === target.storage_path);
        if (!photo || photo.error || !photo.signedUrl) throw new Error('avatar_signing_failed');
        const uri = new URL(photo.signedUrl);
        return { id: target.id, signed_path: uri.pathname + uri.search };
      });
      return reply({ viewer_id: viewer, items });
    }
    if (
      body.action !== 'finalize' ||
      typeof body.avatarId !== 'string' ||
      !uuid.test(body.avatarId)
    )
      return reply({ error: 'invalid_request' }, 400);
    const target = await authority.verification(viewer, body.avatarId);
    if (!target) return reply({ error: 'avatar_unavailable' }, 409);
    // Already committed retries do not download or reinterpret a newer image.
    if (target.status === 'current') return reply({ viewer_id: viewer, avatar_id: target.id });
    if (!target.object_id || !target.object_version)
      return reply({ error: 'avatar_not_uploaded' }, 409);
    const blob = await authority.download(target.storage_path);
    if (blob.size > 1048576) return reply({ error: 'invalid_avatar' }, 422);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let dimensions;
    try {
      dimensions = validateAvatar(bytes);
    } catch {
      return reply({ error: 'invalid_avatar' }, 422);
    }
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const sha256 = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    const result = await authority.activate(viewer, target, { ...dimensions, sha256 });
    return reply(result);
  } catch {
    // No privileged errors, paths, parser payloads, tokens or image bytes leave the service.
    return reply({ error: 'avatar_request_failed' }, 400);
  }
}
