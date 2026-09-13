import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import assert from 'node:assert/strict';

export function localApi() {
  // Capture sensitive status output in memory; never print it or write it to the repo.
  const config = JSON.parse(
    execFileSync('npx', ['supabase', 'status', '-o', 'json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
  assert.equal(config.API_URL, 'http://127.0.0.1:54321');
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  return {
    url: config.API_URL,
    admin: createClient(config.API_URL, config.SERVICE_ROLE_KEY ?? config.SECRET_KEY, options),
    client: () => createClient(config.API_URL, config.PUBLISHABLE_KEY ?? config.ANON_KEY, options),
  };
}
