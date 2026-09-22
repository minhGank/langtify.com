// Server-only scheduled maintenance. Never import this module into the Expo app.
import { createClient } from '@supabase/supabase-js';
import { pathToFileURL } from 'node:url';
import { cleanupAvatars } from './cleanup-avatars.mjs';

export async function cleanupSubmissions(client, batchSize = 100) {
  const { data: jobs, error } = await client.rpc('claim_photo_cleanup', { batch_size: batchSize });
  if (error) throw new Error('Could not claim photo cleanup jobs.');
  let removed = 0;
  for (const job of jobs) {
    const deleted = await client.storage.from('challenge-submissions').remove([job.storage_path]);
    if (deleted.error) continue; // Durable queue remains for the next scheduled attempt.
    const finished = await client.rpc('finish_photo_cleanup', { object_path: job.storage_path });
    if (!finished.error) removed++;
  }
  return { claimed: jobs.length, removed, retry: jobs.length - removed };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Set server-only SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  const parsed = new URL(url);
  if (
    parsed.protocol !== 'https:' &&
    !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))
  )
    throw new Error('Cleanup requires HTTPS or a local loopback API.');
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await cleanupSubmissions(client);
  const avatars = await cleanupAvatars(client);
  console.log(JSON.stringify({ submissions: result, avatars })); // Counts only; no paths or credentials.
  if (result.retry || avatars.retry) process.exitCode = 1;
}
