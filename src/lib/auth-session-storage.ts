import type { SupportedStorage } from '@supabase/supabase-js';

// This claim identifies an Auth session, not a user or authorization decision.
// The SDK/Auth server still validates the token before it can establish a session.
export function authSessionId(token: string): string | null {
  try {
    const body = token.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/');
    if (!body) return null;
    const payload: unknown = JSON.parse(atob(body.padEnd(Math.ceil(body.length / 4) * 4, '=')));
    return payload &&
      typeof payload === 'object' &&
      'session_id' in payload &&
      typeof payload.session_id === 'string'
      ? payload.session_id
      : null;
  } catch {
    return null;
  }
}
function storedSessionId(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value &&
      typeof value === 'object' &&
      'access_token' in value &&
      typeof value.access_token === 'string'
      ? authSessionId(value.access_token)
      : null;
  } catch {
    return null;
  }
}
type WriteGuard = { sessionId: string; current: () => boolean };
let guard: WriteGuard | null = null;
export function guardSessionWrites(next: WriteGuard) {
  guard = next;
  return () => {
    if (guard === next) guard = null;
  };
}
export function guardedSessionStorage(storage: SupportedStorage): SupportedStorage {
  return {
    getItem: (key) => storage.getItem(key),
    async setItem(key, value) {
      const owned = guard;
      if (owned && storedSessionId(value) === owned.sessionId) {
        const existing = storedSessionId(await storage.getItem(key));
        if (!owned.current() || (existing && existing !== owned.sessionId))
          throw new Error('Session changed during OAuth admission.');
      }
      await storage.setItem(key, value);
    },
    async removeItem(key) {
      if (guard) {
        const existing = storedSessionId(await storage.getItem(key));
        if (existing && existing !== guard.sessionId)
          throw new Error('Session changed during OAuth cleanup.');
      }
      await storage.removeItem(key);
    },
  };
}

export function browserSessionStorage(
  getStorage: () => Storage = () => globalThis.localStorage,
): SupportedStorage {
  try {
    const storage = getStorage();
    const probe = 'langtify:storage-probe';
    const previous = storage.getItem(probe);
    storage.setItem(probe, '1');
    if (previous === null) storage.removeItem(probe);
    else storage.setItem(probe, previous);
    return storage;
  } catch {
    // Preserve the SDK's password-auth behavior when browser storage is disabled.
    // Google itself requires durable storage and is disabled in that environment.
    const memory = new Map<string, string>();
    return {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => {
        memory.set(key, value);
      },
      removeItem: (key) => {
        memory.delete(key);
      },
    };
  }
}
