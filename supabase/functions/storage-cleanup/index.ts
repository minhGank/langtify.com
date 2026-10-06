import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../../src/types/database.ts';
import { handler } from './handler.ts';
import { cleanup } from './worker.ts';
import { cleanupStore } from './store.ts';
const url = Deno.env.get('SUPABASE_URL');
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
Deno.serve(
  handler(
    Deno.env.get('STORAGE_CLEANUP_JOB_SECRET'),
    async (id) => {
      if (!url || !key) throw new Error('Unconfigured');
      // Timeout covers response bodies as well as headers; SDK receives the aborted signal.
      const client = createClient<Database>(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          fetch: (input, init) =>
            fetch(input, {
              ...init,
              signal: init?.signal
                ? AbortSignal.any([init.signal, AbortSignal.timeout(8_000)])
                : AbortSignal.timeout(8_000),
            }),
        },
      });
      return await cleanup(cleanupStore(client), id);
    },
    Boolean(url && key),
  ),
);
