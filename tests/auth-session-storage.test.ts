import { createClient } from '@supabase/supabase-js';
import {
  authSessionId,
  browserSessionStorage,
  guardedSessionStorage,
  guardSessionWrites,
} from '@/lib/auth-session-storage';
import { makeOAuthSession } from './fixtures';
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function jwt(sessionId: string) {
  return `${btoa('{}').replace(/=+$/, '')}.${btoa(JSON.stringify({ session_id: sessionId, exp: Math.floor(Date.now() / 1000) + 3600 })).replace(/=+$/, '')}.c2lnbmF0dXJl`;
}
it.each(['cancel', 'another-session'] as const)(
  'the installed SDK cannot save or broadcast an obsolete session after %s',
  async (action) => {
    const saved = new Map<string, string>();
    const key = `sdk-audit-${action}`;
    const candidate = { ...makeOAuthSession(), access_token: jwt('session-a') };
    const storage = {
      getItem: (name: string) => saved.get(name) ?? null,
      setItem: (name: string, value: string) => {
        saved.set(name, value);
      },
      removeItem: (name: string) => {
        saved.delete(name);
      },
    };
    const client = createClient('https://auth.example.test', 'public-test-key', {
      auth: {
        storageKey: key,
        storage: guardedSessionStorage(storage),
        autoRefreshToken: false,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
    await client.auth.getSession();
    const event = jest.fn();
    const subscription = client.auth.onAuthStateChange(event);
    const response = deferred<Response>();
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockReturnValue(response.promise);
    let current = true;
    const release = guardSessionWrites({ sessionId: 'session-a', current: () => current });
    try {
      const attempted = client.auth.setSession(candidate);
      for (let i = 0; i < 20 && !fetchMock.mock.calls.length; i++) await Promise.resolve();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      if (action === 'cancel') current = false;
      else
        storage.setItem(
          key,
          JSON.stringify({ ...makeOAuthSession('user-b'), access_token: jwt('session-b') }),
        );
      response.resolve(
        new Response(JSON.stringify(candidate.user), {
          headers: { 'content-type': 'application/json' },
        }),
      );
      await expect(attempted).rejects.toThrow('Session changed during OAuth admission.');
      expect(event.mock.calls.some(([type]) => type === 'SIGNED_IN')).toBe(false);
      expect(saved.get(key) ?? '').not.toContain(candidate.access_token);
      if (action === 'another-session') expect(saved.get(key)).toContain('user-b');
    } finally {
      release();
      fetchMock.mockRestore();
      subscription.data.subscription.unsubscribe();
      await client.auth.dispose();
    }
  },
);
it('the cleanup guard cannot delete a newer session, including another login of the same user', async () => {
  let saved: string | null = JSON.stringify({
    ...makeOAuthSession(),
    access_token: jwt('new-session'),
  });
  const storage = guardedSessionStorage({
    getItem: () => saved,
    setItem: (_key, value) => {
      saved = value;
    },
    removeItem: () => {
      saved = null;
    },
  });
  const release = guardSessionWrites({ sessionId: 'old-session', current: () => false });
  try {
    await expect(storage.removeItem('main')).rejects.toThrow();
    expect(saved).not.toBeNull();
  } finally {
    release();
  }
});
it('does not treat token claims as an identity authorization check or expose malformed token contents', () => {
  expect(authSessionId('not-a-token')).toBeNull();
  expect(authSessionId(jwt('technical-session-id'))).toBe('technical-session-id');
});

it('preserves password sessions in memory when browser storage is disabled', async () => {
  const storage = browserSessionStorage(() => {
    throw new Error('Storage disabled');
  });
  await storage.setItem('session', 'password-session');
  expect(await storage.getItem('session')).toBe('password-session');
  await storage.removeItem('session');
  expect(await storage.getItem('session')).toBeNull();
});
