import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../../src/types/database.ts';
import { schedulerHandler } from './handler.ts';
import { notificationStore } from './store.ts';
import { expoTransport } from './expo.ts';
import { runNotificationJob } from './worker.ts';
const url = Deno.env.get('SUPABASE_URL'),
  key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  expoKey = Deno.env.get('EXPO_ACCESS_TOKEN');
const ready = Boolean(url && key && expoKey?.trim() && !/[\r\n]/.test(expoKey));
Deno.serve(
  schedulerHandler(
    Deno.env.get('NOTIFICATION_JOB_SECRET'),
    async () => {
      if (!url || !key || !expoKey) throw new Error('Scheduler unconfigured');
      const client = createClient<Database>(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      return await runNotificationJob(notificationStore(client), expoTransport(expoKey));
    },
    ready,
  ),
);
