import { Buffer } from 'node:buffer';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanupSubmissions } from '../cleanup-submissions.mjs';
import { cleanupAvatars } from '../cleanup-avatars.mjs';
import {
  validateConfig,
  runCleanup,
  runBucket,
  boundedFetch,
  sendHeartbeat,
  PRODUCTION_URL,
} from '../production-cleanup.mjs';
const config = {
  environment: 'production',
  supabaseUrl: PRODUCTION_URL,
  serviceKey: 'sb_secret_testOnly',
  photosHeartbeat: 'https://hc-ping.com/00000000-0000-4000-8000-000000000001',
  avatarsHeartbeat: 'https://hc-ping.com/00000000-0000-4000-8000-000000000002',
};
const zero = async () => ({ claimed: 0, removed: 0, retry: 0 });
const defaults = { clientFactory: () => ({}), heartbeat: async () => true, log: () => {} };

test('Production configuration fails closed for Dev, local, public, wrong-role and expired keys', () => {
  assert.equal(validateConfig(config), config);
  for (const change of [
    { environment: 'dev' },
    { supabaseUrl: 'https://ssuyyrfncvyqsgkirvpq.supabase.co' },
    { supabaseUrl: 'http://localhost:54321' },
    { serviceKey: '' },
    { serviceKey: 'sb_publishable_test' },
    { photosHeartbeat: config.avatarsHeartbeat },
    { avatarsHeartbeat: 'https://evil.test/id' },
  ])
    assert.throws(() => validateConfig({ ...config, ...change }));
  const jwt = (claims) =>
    'eyJ.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.test';
  for (const claims of [
    { role: 'anon', ref: 'lfdgjewypbhukjrtwsef', exp: 9999999999 },
    { role: 'service_role', ref: 'ssuyyrfncvyqsgkirvpq', exp: 9999999999 },
    { role: 'service_role', ref: 'lfdgjewypbhukjrtwsef', exp: 1 },
  ])
    assert.throws(() => validateConfig({ ...config, serviceKey: jwt(claims) }));
});

test('real adapters retain failed removal/finalization work and retry on next run, in both buckets', async () => {
  for (const adapter of [cleanupSubmissions, cleanupAvatars]) {
    let jobs = ['one', 'two'],
      failRemove = true,
      failFinish = true;
    const client = {
      rpc: async (name, args) => {
        if (name.startsWith('claim_'))
          return {
            data: jobs.slice(0, args.batch_size).map((storage_path) => ({ storage_path })),
            error: null,
          };
        if (failFinish) return { error: { message: 'private provider text' } };
        jobs = jobs.filter((p) => p !== args.object_path);
        return { error: null };
      },
      storage: { from: () => ({ remove: async () => ({ error: failRemove ? {} : null }) }) },
    };
    assert.equal((await runBucket(adapter, client)).retry, 2);
    assert.equal(jobs.length, 2);
    failRemove = false;
    assert.equal((await runBucket(adapter, client)).retry, 2);
    assert.equal(jobs.length, 2);
    failFinish = false;
    assert.deepEqual(await runBucket(adapter, client), {
      status: 'success',
      claimed: 2,
      removed: 2,
      retry: 0,
    });
    assert.equal(jobs.length, 0);
  }
});

test('claim failure cannot prevent other bucket processing; alerts and logs never contain raw errors', async () => {
  const logs = [],
    pings = [];
  let avatar = false;
  assert.equal(
    await runCleanup(config, {
      ...defaults,
      adapters: [
        async () => {
          throw new Error('SECRET/path');
        },
        async () => {
          avatar = true;
          return zero();
        },
      ],
      heartbeat: async (url, r) => {
        pings.push([url, r]);
        return true;
      },
      log: (r) => logs.push(r),
    }),
    1,
  );
  assert.ok(avatar);
  assert.equal(pings.length, 2);
  assert.equal(pings[0][1].status, 'failed');
  assert.ok(!JSON.stringify(logs).includes('SECRET'));
});

test('buckets start concurrently and stalled bucket times out without blocking healthy bucket', async () => {
  const starts = [],
    pings = [];
  let signal;
  assert.equal(
    await runCleanup(config, {
      ...defaults,
      bucketMs: 15,
      clientFactory: (s) => {
        signal ??= s;
        return {};
      },
      adapters: [
        () => {
          starts.push('photo');
          return new Promise(() => {});
        },
        async () => {
          starts.push('avatar');
          return zero();
        },
      ],
      heartbeat: async (url, r) => {
        pings.push(r.status);
        return true;
      },
    }),
    1,
  );
  assert.deepEqual(starts, ['photo', 'avatar']);
  assert.deepEqual(pings, ['success', 'timeout']);
  assert.ok(signal.aborted);
});

test('full batch alerts on capacity pressure even when removals succeed; retries never send success', async () => {
  const results = [];
  const code = await runCleanup(config, {
    ...defaults,
    adapters: [
      async () => ({ claimed: 100, removed: 100, retry: 0 }),
      async () => ({ claimed: 2, removed: 1, retry: 1 }),
    ],
    heartbeat: async (u, r) => {
      results.push(r.status);
      return true;
    },
  });
  assert.equal(code, 1);
  assert.deepEqual(results, ['capacity', 'retry']);
});

test('monitoring failure fails run; malformed counts fail closed', async () => {
  assert.equal(
    await runCleanup(config, { ...defaults, adapters: [zero, zero], heartbeat: async () => false }),
    1,
  );
  assert.equal(
    (await runBucket(async () => ({ claimed: 101, removed: 101, retry: 0 }), {})).status,
    'failed',
  );
  assert.equal(await runCleanup(config, { ...defaults, adapters: [zero, zero] }), 0);
});

test('bounded transport rejects credential redirects/cross-origin and aborts stalled requests', async () => {
  const ctrl = new AbortController();
  let captured;
  const f = boundedFetch(
    PRODUCTION_URL,
    ctrl.signal,
    async (u, o) => {
      captured = o;
      return {};
    },
    10,
  );
  assert.throws(() => f('https://evil.test/path'));
  await f(PRODUCTION_URL + '/rest/v1/rpc/test');
  assert.equal(captured.redirect, 'error');
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(captured.signal.aborted);
  const live = boundedFetch(PRODUCTION_URL, ctrl.signal, async (u, o) => o.signal);
  const s = await live(PRODUCTION_URL);
  ctrl.abort();
  assert.ok(s.aborted);
});

test('heartbeat reports failures, drains bodies and fails on HTTP/network errors', async () => {
  const calls = [];
  let cancelled = false;
  const transport = async (u, o) => {
    calls.push([u, o]);
    return {
      ok: true,
      body: {
        cancel: async () => {
          cancelled = true;
        },
      },
    };
  };
  assert.ok(
    await sendHeartbeat(
      config.photosHeartbeat,
      { status: 'retry', claimed: 1, removed: 0, retry: 1 },
      transport,
    ),
  );
  assert.ok(calls[0][0].endsWith('/fail'));
  assert.equal(calls[0][1].redirect, 'error');
  assert.ok(cancelled);
  assert.equal(
    await sendHeartbeat(config.photosHeartbeat, { status: 'success' }, async () => ({ ok: false })),
    false,
  );
  assert.equal(
    await sendHeartbeat(config.photosHeartbeat, { status: 'success' }, async () => {
      throw new Error('secret');
    }),
    false,
  );
});

test('deployment enforces a shared kernel lock, hard timeout and independent hourly schedule', () => {
  const unit = readFileSync(
    new URL('../../ops/production-cleanup/langtify-cleanup.service', import.meta.url),
    'utf8',
  );
  const timer = readFileSync(
    new URL('../../ops/production-cleanup/langtify-cleanup.timer', import.meta.url),
    'utf8',
  );
  assert.match(
    unit,
    /ExecStart=\/usr\/bin\/flock --nonblock --conflict-exit-code 75 \/var\/lib\/langtify-cleanup\/worker.lock/,
  );
  assert.match(unit, /TimeoutStartSec=300/);
  assert.match(unit, /KillMode=control-group/);
  assert.match(unit, /LoadCredential=cleanup.json:/);
  assert.match(unit, /ProtectSystem=strict/);
  assert.match(timer, /OnCalendar=\*-\*-\* \*:00:00 UTC/);
  assert.match(timer, /Persistent=true/);
});

test('growing backlog alerts until drained below batch capacity', async () => {
  let backlog = 101;
  const client = {
    rpc: async (name, args) =>
      name.startsWith('claim_')
        ? {
            data: Array.from({ length: Math.min(backlog, args.batch_size) }, (_, i) => ({
              storage_path: String(i),
            })),
            error: null,
          }
        : (backlog--, { error: null }),
    storage: { from: () => ({ remove: async () => ({ error: null }) }) },
  };
  assert.equal((await runBucket(cleanupSubmissions, client)).status, 'capacity');
  backlog += 200;
  assert.equal((await runBucket(cleanupSubmissions, client)).status, 'capacity');
  assert.equal((await runBucket(cleanupSubmissions, client)).status, 'capacity');
  assert.equal((await runBucket(cleanupSubmissions, client)).status, 'success');
});

test(
  'Linux kernel denies overlapping workers and releases the lock after a crash',
  { skip: process.platform !== 'linux' },
  async () => {
    const { execFileSync } = await import('node:child_process');
    execFileSync('/bin/sh', ['scripts/tests/cleanup-lock.sh'], { timeout: 10000, stdio: 'pipe' });
  },
);
