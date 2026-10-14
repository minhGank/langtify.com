import { createClient } from '@supabase/supabase-js';
import { authMutation } from '@/features/auth/oauth/runtime';
import { publicConfig } from '@/lib/env';
import { boundedFetch } from '@/lib/http';
import { requireSupabase } from '@/lib/supabase';
import { authSessionId } from '@/lib/auth-session-storage';
import type { Database } from '@/types/database';

export async function deleteAccount(token: string, userId: string) {
  const config = publicConfig.config;
  if (!config) throw new Error('Account deletion unavailable.');
  // Serialize against login/logout and fence the current account before dispatch.
  return authMutation(async () => {
    const auth = requireSupabase().auth;
    const current = await auth.getSession();
    if (
      !authSessionId(token) ||
      current.error ||
      current.data.session?.user.id !== userId ||
      authSessionId(current.data.session.access_token) !== authSessionId(token)
    ) {
      throw new Error('Account changed.');
    }
    const client = createClient<Database>(config.url, config.key, {
      global: { fetch: boundedFetch },
      accessToken: async () => token,
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const result = await client.rpc('delete_my_account');
    if (result.error || result.data !== true) throw new Error('Deletion could not be confirmed.');
    const latest = await auth.getSession();
    if (latest.error) throw new Error('Local sign-out could not be confirmed.');
    if (
      latest.data.session?.user.id === userId &&
      authSessionId(latest.data.session.access_token) === authSessionId(token)
    ) {
      const signedOut = await auth.signOut({ scope: 'local' });
      if (signedOut.error) throw new Error('Local sign-out could not be confirmed.');
    }
  });
}
