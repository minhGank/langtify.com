import { boundedFetch } from '@/lib/http';
import { createClient } from '@supabase/supabase-js';
import { ensureOAuthCrypto } from '@/lib/oauth-crypto';
import type { OAuthAttempt } from './coordinator';
export type OAuthStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
  keys: () => Promise<string[]>;
};
export function createOAuthAttempt(
  config: { url: string; key: string },
  storageKey: string,
  store: OAuthStorage,
): OAuthAttempt {
  ensureOAuthCrypto();
  // A staging client holds PKCE material only. Its session is never persisted or
  // subscribed by the app; only a still-current exchange may enter the main client.
  const client = createClient(config.url, config.key, {
    global: { fetch: boundedFetch },
    auth: {
      storageKey,
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage: {
        getItem: (key) => (key === storageKey ? Promise.resolve(null) : store.getItem(key)),
        setItem: (key, value) =>
          key === storageKey ? Promise.resolve() : store.setItem(key, value),
        removeItem: (key) => store.removeItem(key),
      },
    },
  });
  const value: OAuthAttempt = {
    async authorize(redirectTo) {
      try {
        const { data, error } = await client.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo,
            skipBrowserRedirect: true,
            queryParams: { prompt: 'select_account' },
          },
        });
        if (error || !data.url || !data.flowId) throw new Error('OAuth initialization failed.');
        return { url: data.url, flowId: data.flowId };
      } finally {
        await client.auth.dispose();
      }
    },
    async exchange(code, flowId) {
      try {
        const { data, error } = await client.auth.exchangeCodeForSession(code, { flowId });
        if (error || !data.session) throw new Error('OAuth exchange failed.');
        return data.session;
      } finally {
        await client.auth.dispose();
      }
    },
    async clear() {
      await client.auth.dispose();
      for (const key of await store.keys())
        if (key === storageKey || key.startsWith(`${storageKey}-`)) await store.removeItem(key);
    },
  };
  return value;
}
