import { boundedFetch } from '@/lib/http';
import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, processLock } from '@supabase/supabase-js';
import { Platform } from 'react-native';

import { publicConfig } from '@/lib/env';
import { guardedSessionStorage, browserSessionStorage } from '@/lib/auth-session-storage';
import type { Database } from '@/types/database';

export const supabase = publicConfig.config
  ? createClient<Database>(publicConfig.config.url, publicConfig.config.key, {
      global: { fetch: boundedFetch },
      auth: {
        storage: guardedSessionStorage(
          Platform.OS === 'web' ? browserSessionStorage() : AsyncStorage,
        ),
        ...(Platform.OS !== 'web' ? { lock: processLock } : {}),
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null;

export function requireSupabase() {
  if (!supabase) throw new Error('Supabase configuration is missing.');
  return supabase;
}
