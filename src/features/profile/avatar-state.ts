import { createServerCache, invalidateServerData, serverScope } from '@/lib/server-cache';
import { imageMemory } from '@/lib/image-memory';
import type { AvatarIdentity, AvatarState } from '@/services/avatars';

// One authoritative current pointer per Auth session. Feed/profile projections
// are hints; a stale page must never overwrite a confirmed avatar mutation.
const current = createServerCache<AvatarState>({ maxEntries: 4 });
export function ownAvatarEntry(identity: AvatarIdentity) {
  return current.entry(`${serverScope(identity.userId, identity.token)}:avatar`, ['avatars']);
}
export function avatarChanged(identity: AvatarIdentity, state: AvatarState, bytes?: Uint8Array) {
  const entry = ownAvatarEntry(identity);
  const previous = entry.getSnapshot().data?.avatarId;
  const memory = imageMemory(serverScope(identity.userId, identity.token), 'avatar', [
    'avatars',
    'public-profile',
  ]);
  if (previous && previous !== state.avatarId) memory.forget(previous);
  if (state.avatarId && bytes) memory.rememberVerifiedPhoto(state.avatarId, bytes);
  invalidateServerData([`avatar-access:${state.avatarId}`, `avatar-access:${previous}`], {
    discard: true,
    scope: serverScope(identity.userId, identity.token),
  });
  entry.set(state); // cancels an older in-flight pointer read before publishing
}
