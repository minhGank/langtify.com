// CI-only setup: capture local credentials, mask them in Actions, and probe the
// actual photo handler before integration tests. Never export keys to the app.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

export function validateLocalStatus(value) {
  if (
    !value ||
    value.API_URL !== 'http://127.0.0.1:54321' ||
    typeof value.ANON_KEY !== 'string' ||
    !value.ANON_KEY
  )
    throw new Error('Expected the local Langtify Supabase stack and its anonymous key.');
  return value;
}

export function maskStatus(config, emit) {
  for (const [name, value] of Object.entries(config)) {
    if (typeof value !== 'string' || !value || !/KEY|SECRET|PASSWORD|TOKEN|DB_URL/.test(name))
      continue;
    // Escape Actions workflow-command data, including CR/LF injection.
    const escaped = value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
    emit(`::add-mask::${escaped}`);
  }
}

export async function waitForFunctions(
  config,
  { fetcher = fetch, sleep = delay, now = Date.now, timeout = 90000 } = {},
) {
  const deadline = now() + timeout;
  while (now() < deadline) {
    try {
      const response = await fetcher(`${config.API_URL}/functions/v1/photo-authority`, {
        method: 'POST',
        headers: {
          apikey: config.ANON_KEY,
          Authorization: `Bearer ${config.ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
        signal: AbortSignal.timeout(2000),
      });
      const body = await response.json();
      // A gateway 401 alone is insufficient: require the actual handler's reply.
      if (response.status === 401 && body?.error === 'authentication_required') return;
    } catch {
      // Startup can temporarily refuse connections. No response/token is logged.
    }
    await sleep(1000);
  }
  throw new Error('Local photo-authority did not become ready within the startup deadline.');
}

async function main() {
  const mode = process.argv[2];
  if (!['mask', 'ready'].includes(mode))
    throw new Error('Usage: node scripts/ci-supabase.mjs mask|ready');
  let config;
  try {
    config = validateLocalStatus(
      JSON.parse(
        execFileSync(resolve('node_modules/.bin/supabase'), ['status', '-o', 'json'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 30000,
        }),
      ),
    );
  } catch {
    // execFileSync errors can carry the entire sensitive CLI output.
    throw new Error('Unable to read local Supabase status. Check the local stack startup.');
  }
  if (process.env.GITHUB_ACTIONS === 'true') maskStatus(config, (line) => console.log(line));
  if (mode === 'ready') await waitForFunctions(config);
  console.log(
    mode === 'ready'
      ? 'Local photo authority is ready.'
      : 'Local Supabase status checked without exporting credentials.',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
