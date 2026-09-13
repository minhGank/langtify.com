// Browser tabs share the SDK's persisted session, but not their PKCE verifier.
// Serialize app auth mutations across tabs and keep only non-secret admission
// metadata in localStorage. Never put tokens/codes in this coordination channel.
export type CommitMarker = { sessionId: string; userId: string };
export type BrowserCoordination = ReturnType<typeof browserCoordination>;
export type AuthLocks = { request: <T>(name: string, work: () => Promise<T>) => Promise<T> };
export function browserCoordination(storage: Storage, locks: AuthLocks, scope: string) {
  const intentKey = `${scope}:intent`,
    commitKey = `${scope}:commit`;
  return {
    run: <T>(work: () => Promise<T>): Promise<T> => locks.request(`${scope}:mutation`, work),
    begin: (id: string) => storage.setItem(intentKey, id),
    current: (id: string) => storage.getItem(intentKey) === id,
    invalidate(id: string) {
      if (storage.getItem(intentKey) === id) storage.removeItem(intentKey);
    },
    commit(marker: CommitMarker | null) {
      if (marker) storage.setItem(commitKey, JSON.stringify(marker));
      else storage.removeItem(commitKey);
    },
    pending(): CommitMarker | null {
      const raw = storage.getItem(commitKey);
      if (!raw) return null;
      const row: unknown = JSON.parse(raw);
      if (
        !row ||
        typeof row !== 'object' ||
        !('sessionId' in row) ||
        typeof row.sessionId !== 'string' ||
        !('userId' in row) ||
        typeof row.userId !== 'string'
      )
        throw new Error('Invalid OAuth recovery record.');
      return { sessionId: row.sessionId, userId: row.userId };
    },
  };
}
