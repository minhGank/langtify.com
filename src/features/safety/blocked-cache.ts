import { createServerCache, invalidateServerData, serverScope } from '@/lib/server-cache';
import type { BlockedUser, SafetyIdentity, SafetyPage } from './model';

export type BlockedWindow = SafetyPage<BlockedUser> & {
  cursor: string | null;
  olderWindow: boolean;
};
export const blockedCache = createServerCache<BlockedWindow>({ maxEntries: 2 });
export const blockedProfileCache = createServerCache<BlockedUser>({ maxEntries: 8 });

function invalidatePublicEligibility(identity: SafetyIdentity) {
  invalidateServerData(
    ['discover', 'public-profile', 'user-search', 'follows', 'connections', 'comments', 'inbox'],
    { scope: serverScope(identity.userId, identity.token) },
  );
}

// A lost acknowledgement may still have committed. Reconcile only this session's
// affected reads, including on timeout; never replay the mutation automatically.
export async function unblockWithRecovery(
  identity: SafetyIdentity,
  signal: AbortSignal,
  work: () => Promise<void>,
) {
  const reconcile = () => {
    invalidateServerData(['blocked-users'], {
      scope: serverScope(identity.userId, identity.token),
    });
    invalidatePublicEligibility(identity);
  };
  signal.addEventListener('abort', reconcile, { once: true });
  try {
    await work();
  } catch (cause) {
    reconcile();
    throw cause;
  } finally {
    signal.removeEventListener('abort', reconcile);
    if (signal.aborted) reconcile();
  }
}

export function unblockChanged(identity: SafetyIdentity, id: string) {
  const scope = serverScope(identity.userId, identity.token);
  blockedCache.update((key, page) =>
    key.startsWith(`${scope}:`)
      ? { ...page, items: page.items.filter((row) => row.id !== id) }
      : page,
  );
  blockedProfileCache.entry(`${scope}:blocked-profile:${id}`, ['blocked-users', 'safety']).clear();
  // Only public eligibility can expand. Preserve owner vocabulary/progress,
  // capture recovery and settings; inactive social screens read on next use.
  invalidatePublicEligibility(identity);
}
