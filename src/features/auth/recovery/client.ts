import { createClient } from '@supabase/supabase-js';
import { boundedFetch } from '@/lib/http';
import { ensureOAuthCrypto } from '@/lib/oauth-crypto';
import type { OAuthStorage } from '../oauth/pkce-attempt';

export const recoveryRedirect = 'langtify://auth/callback';
export function createRecoveryClient(
  config: { url: string; key: string },
  storageKey: string,
  store: OAuthStorage,
) {
  ensureOAuthCrypto();
  let session: string | null = null;
  const client = createClient(config.url, config.key, {
    global: { fetch: boundedFetch },
    auth: {
      storageKey,
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage: {
        getItem: (key) => (key === storageKey ? Promise.resolve(session) : store.getItem(key)),
        setItem: async (key, value) => {
          if (key === storageKey) session = value;
          else await store.setItem(key, value);
        },
        removeItem: async (key) => {
          if (key === storageKey) session = null;
          else await store.removeItem(key);
        },
      },
    },
  });
  return {
    async request(email: string) {
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: recoveryRedirect,
      });
      if (error) throw error;
    },
    async exchange(code: string) {
      const { data, error } = await client.auth.exchangeCodeForSession(code);
      if (error || !data.session || !('redirectType' in data) || data.redirectType !== 'recovery')
        throw new Error('Invalid recovery');
    },
    async update(password: string) {
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
    },
    async clear() {
      session = null;
      await client.auth.dispose();
      for (const key of await store.keys())
        if (key === storageKey || key.startsWith(`${storageKey}-`)) await store.removeItem(key);
    },
  };
}
export type RecoveryClient = ReturnType<typeof createRecoveryClient>;
