import { createClient } from '@supabase/supabase-js';
import { boundedFetch } from '@/lib/http';
import { publicConfig } from '@/lib/env';
import type { Database } from '@/types/database';

export type AvatarIdentity = { userId: string; token: string };
export type AvatarState = { avatarId: string | null };
export type AvatarReservation = { id: string; storagePath: string; current: boolean };
export type AvatarGateway = {
  load: (signal: AbortSignal) => Promise<AvatarState>;
  reserve: (requestId: string, signal: AbortSignal) => Promise<AvatarReservation>;
  upload: (reservation: AvatarReservation, bytes: Uint8Array, signal: AbortSignal) => Promise<void>;
  finalize: (id: string, signal: AbortSignal) => Promise<AvatarState>;
  remove: (expectedId: string, signal: AbortSignal) => Promise<AvatarState>;
  previews: (ids: string[], signal: AbortSignal) => Promise<Record<string, string>>;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const bucket = 'profile-avatars';
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid avatar response.');
  return value as Record<string, unknown>;
}
function checked(value: unknown, userId: string) {
  const result = record(value);
  if (result.viewer_id !== userId) throw new Error('Avatar account changed.');
  return result;
}
export function parseAvatarState(value: unknown, userId: string): AvatarState {
  const result = checked(value, userId);
  if (
    result.avatar_id !== null &&
    (typeof result.avatar_id !== 'string' || !uuid.test(result.avatar_id))
  )
    throw new Error('Invalid avatar response.');
  return { avatarId: result.avatar_id };
}
export function parseAvatarPreviews(value: unknown, userId: string, ids: string[], url: string) {
  const result = checked(value, userId);
  if (!Array.isArray(result.items) || result.items.length > ids.length)
    throw new Error('Invalid avatar response.');
  const found: Record<string, string> = {};
  for (const input of result.items) {
    const item = record(input);
    if (
      typeof item.id !== 'string' ||
      !ids.includes(item.id) ||
      item.id in found ||
      typeof item.signed_path !== 'string' ||
      !item.signed_path.startsWith(`/storage/v1/object/sign/${bucket}/${item.id}.jpg?token=`)
    )
      throw new Error('Invalid avatar response.');
    const uri = new URL(item.signed_path, url);
    if (
      uri.origin !== new URL(url).origin ||
      uri.hash ||
      uri.searchParams.size !== 1 ||
      !uri.searchParams.get('token')
    )
      throw new Error('Invalid avatar response.');
    found[item.id] = uri.href;
  }
  return found;
}
export function avatarGateway(identity: AvatarIdentity): AvatarGateway {
  const config = publicConfig.config;
  if (!config) throw new Error('Supabase configuration is missing.');
  const client = createClient<Database>(config.url, config.key, {
    global: { fetch: boundedFetch },
    accessToken: async () => identity.token,
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const state = (value: unknown) => parseAvatarState(value, identity.userId);
  return {
    async load(signal) {
      const result = await client.rpc('get_own_avatar').abortSignal(signal);
      if (result.error) throw result.error;
      return state(result.data);
    },
    async reserve(requestId, signal) {
      const result = await client
        .rpc('reserve_profile_avatar', { request_id: requestId })
        .abortSignal(signal);
      if (result.error) throw result.error;
      const avatar = record(checked(result.data, identity.userId).avatar);
      if (
        typeof avatar.id !== 'string' ||
        !uuid.test(avatar.id) ||
        avatar.storage_path !== `${avatar.id}.jpg` ||
        !['pending', 'current'].includes(String(avatar.status))
      )
        throw new Error('Invalid avatar response.');
      return {
        id: avatar.id,
        storagePath: `${avatar.id}.jpg`,
        current: avatar.status === 'current',
      };
    },
    async upload(reservation, bytes, signal) {
      if (!uuid.test(reservation.id) || reservation.storagePath !== `${reservation.id}.jpg`)
        throw new Error('Invalid avatar reservation.');
      // Storage upload options do not expose AbortSignal. Bind this one transport
      // to the editor's lifetime without changing any other account-scoped request.
      const uploader = createClient<Database>(config.url, config.key, {
        global: { fetch: (input, init) => boundedFetch(input, { ...init, signal }) },
        accessToken: async () => identity.token,
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const result = await uploader.storage
        .from(bucket)
        .upload(reservation.storagePath, Uint8Array.from(bytes).buffer, {
          contentType: 'image/jpeg',
          upsert: false,
          cacheControl: '0',
        });
      // A previous upload may have succeeded before its acknowledgement was lost.
      // The trusted finalize step is still required and validates that immutable object.
      if (result.error && result.error.statusCode !== '409') throw result.error;
    },
    async finalize(id, signal) {
      const result = await client.functions.invoke('avatar-authority', {
        body: { action: 'finalize', avatarId: id },
        signal,
      });
      if (result.error) throw result.error;
      return state(result.data);
    },
    async remove(expectedId, signal) {
      const result = await client
        .rpc('remove_profile_avatar', { expected_avatar_id: expectedId })
        .abortSignal(signal);
      if (result.error) throw result.error;
      return state(result.data);
    },
    async previews(ids, signal) {
      if (!ids.length) return {};
      const result = await client.functions.invoke('avatar-authority', {
        body: { action: 'previews', avatarIds: ids },
        signal,
      });
      if (result.error) throw result.error;
      return parseAvatarPreviews(result.data, identity.userId, ids, config.url);
    },
  };
}
