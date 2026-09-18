import assert from 'node:assert/strict';
import { test } from 'node:test';
import { maskStatus, validateLocalStatus, waitForFunctions } from './ci-supabase.mjs';

const config = { API_URL: 'http://127.0.0.1:54321', ANON_KEY: 'local-test-fixture' };
test('CI refuses hosted endpoints and incomplete local configuration', () => {
  assert.equal(validateLocalStatus(config), config);
  for (const value of [
    null,
    {},
    { ...config, ANON_KEY: '' },
    { ...config, API_URL: 'https://example.supabase.co' },
  ])
    assert.throws(() => validateLocalStatus(value));
});
test('Actions masking covers local privileged credentials and escapes command injection', () => {
  const output = [];
  maskStatus(
    {
      ...config,
      SERVICE_ROLE_KEY: 'fixture%\n::warning::value\r',
      SECRET_KEY: 'another-fixture',
      DB_URL: 'postgresql://fixture',
      OTHER: 'unrelated',
    },
    (line) => output.push(line),
  );
  assert.equal(output.length, 4);
  assert(output.every((line) => line.startsWith('::add-mask::') && !/[\r\n]/.test(line)));
  assert(output.includes('::add-mask::fixture%25%0A::warning::value%0D'));
  assert(!output.some((line) => line.includes('unrelated')));
});
test('readiness retries startup and gateway errors until the photo handler responds', async () => {
  let calls = 0;
  await waitForFunctions(config, {
    sleep: async () => {},
    fetcher: async (url, init) => {
      assert.equal(url, `${config.API_URL}/functions/v1/photo-authority`);
      assert.equal(init.headers.Authorization, `Bearer ${config.ANON_KEY}`);
      calls++;
      if (calls === 1) throw new Error('connection refused');
      return Response.json(
        calls === 2 ? { message: 'Invalid JWT' } : { error: 'authentication_required' },
        { status: 401 },
      );
    },
  });
  assert.equal(calls, 3);
});
test('an unavailable handler fails within a bounded readiness window', async () => {
  let clock = 0;
  await assert.rejects(
    waitForFunctions(config, {
      now: () => clock,
      timeout: 2000,
      sleep: async (ms) => {
        clock += ms;
      },
      fetcher: async () => Response.json({ error: 'service_unavailable' }, { status: 503 }),
    }),
    /did not become ready/,
  );
});
