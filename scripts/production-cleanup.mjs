import { Buffer } from 'node:buffer';
// Server-only. Run through the supplied systemd service (which holds flock).
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { cleanupSubmissions } from './cleanup-submissions.mjs';
import { cleanupAvatars } from './cleanup-avatars.mjs';

export const PRODUCTION_URL = 'https://lfdgjewypbhukjrtwsef.supabase.co';
export const BATCH_SIZE = 100;
const BUCKET_MS = 120_000;
const REQUEST_MS = 8_000;

export function validateConfig(config) {
  if (
    config?.environment !== 'production' ||
    config.supabaseUrl !== PRODUCTION_URL ||
    typeof config.serviceKey !== 'string'
  )
    throw new Error('configuration_rejected');
  const key = config.serviceKey;
  if (key.startsWith('eyJ')) {
    let claims;
    try {
      claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
    } catch {
      throw new Error('configuration_rejected');
    }
    if (
      claims.role !== 'service_role' ||
      claims.ref !== 'lfdgjewypbhukjrtwsef' ||
      !Number.isFinite(claims.exp) ||
      claims.exp <= Date.now() / 1000
    )
      throw new Error('configuration_rejected');
  } else if (!/^sb_secret_[A-Za-z0-9_-]+$/.test(key)) throw new Error('configuration_rejected');
  for (const name of ['photosHeartbeat', 'avatarsHeartbeat']) {
    if (
      typeof config[name] !== 'string' ||
      !/^https:\/\/hc-ping\.com\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(config[name])
    )
      throw new Error('configuration_rejected');
  }
  if (config.photosHeartbeat === config.avatarsHeartbeat) throw new Error('configuration_rejected');
  return config;
}

export function boundedFetch(origin, signal, transport = fetch, requestMs = REQUEST_MS) {
  return (input, options = {}) => {
    const target = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (target.origin !== origin || target.username || target.password)
      throw new Error('destination_rejected');
    return transport(input, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.any([
        signal,
        AbortSignal.timeout(requestMs),
        ...(options.signal ? [options.signal] : []),
      ]),
    });
  };
}

// No automatic write replay: the next scheduled run reclaims durable work using
// the existing DB authority. A lost acknowledgement leaves the same queue intact.
export async function runBucket(adapter, client, batchSize = BATCH_SIZE) {
  try {
    const result = await adapter(client, batchSize);
    if (
      !['claimed', 'removed', 'retry'].every(
        (k) => Number.isSafeInteger(result[k]) && result[k] >= 0 && result[k] <= batchSize,
      ) ||
      result.claimed !== result.removed + result.retry
    )
      throw new Error('invalid_counts');
    const { claimed, removed, retry } = result;
    return {
      status: retry ? 'retry' : claimed === batchSize ? 'capacity' : 'success',
      claimed,
      removed,
      retry,
    };
  } catch {
    // Raw SDK exceptions can contain paths, request headers or provider bodies.
    return { status: 'failed' };
  }
}

export async function sendHeartbeat(url, result, transport = fetch) {
  try {
    const response = await transport(url + (result.status === 'success' ? '' : '/fail'), {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_MS),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    });
    const ok = response.ok;
    await response.body?.cancel();
    return ok;
  } catch {
    return false;
  }
}

export async function runCleanup(
  config,
  {
    clientFactory = (signal) =>
      createClient(config.supabaseUrl, config.serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { fetch: boundedFetch(PRODUCTION_URL, signal) },
      }),
    adapters = [cleanupSubmissions, cleanupAvatars],
    heartbeat = sendHeartbeat,
    log = (value) => console.log(JSON.stringify(value)),
    bucketMs = BUCKET_MS,
  } = {},
) {
  validateConfig(config);
  const results = await Promise.all(
    adapters.map(async (adapter, index) => {
      const bucket = index === 0 ? 'photos' : 'avatars';
      const controller = new AbortController();
      let timeout;
      const deadline = new Promise((resolve) => {
        timeout = setTimeout(() => {
          controller.abort();
          resolve({ status: 'timeout' });
        }, bucketMs);
      });
      let result;
      try {
        result = await Promise.race([
          runBucket(adapter, clientFactory(controller.signal)),
          deadline,
        ]);
      } catch {
        result = { status: 'failed' };
      } finally {
        clearTimeout(timeout);
        controller.abort();
      }
      let notified = false;
      try {
        notified = await heartbeat(config[`${bucket}Heartbeat`], result);
      } catch {
        /* fail closed */
      }
      log({ bucket, ...result, monitoring: notified ? 'sent' : 'failed' });
      return result.status === 'success' && notified;
    }),
  );
  return results.every(Boolean) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    // systemd LoadCredential mounts the root-owned source read-only for this unit.
    // Do not read Expo env files or accept a caller-selected configuration path.
    const directory = process.env.CREDENTIALS_DIRECTORY;
    if (!directory || !directory.startsWith('/run/credentials/'))
      throw new Error('configuration_rejected');
    const config = JSON.parse(readFileSync(`${directory}/cleanup.json`, 'utf8'));
    process.exitCode = await runCleanup(config);
  } catch {
    console.log(JSON.stringify({ status: 'configuration_or_worker_failed' }));
    process.exitCode = 1;
  }
}
