import { cleanup, type Result, type Store } from './worker.ts';
import { handler } from './handler.ts';
function assert(value: unknown, message = 'Assertion failed'): asserts value {
  if (!value) throw new Error(message);
}
const id = '00000000-0000-4000-8000-000000000001';
function fixture() {
  const calls: string[] = [];
  let recorded: { counts: Result; uncertain: boolean } | undefined;
  const store: Store = {
    begin: () => Promise.resolve(true),
    claim: (kind) => Promise.resolve([kind + '-one', kind + '-two']),
    remove: (kind, path) => {
      calls.push(`remove:${kind}:${path}`);
      return Promise.resolve();
    },
    finish: (kind, path) => {
      calls.push(`finish:${kind}:${path}`);
      return Promise.resolve();
    },
    complete: (_id, counts, uncertain) => {
      recorded = { counts, uncertain };
      return Promise.resolve(true);
    },
  };
  return { store, calls, recorded: () => recorded };
}
Deno.test('both queues use remove then finish; results contain counts only', async () => {
  const f = fixture();
  const result = await cleanup(f.store, id);
  assert(
    result.status === 'success' && result.submissions.removed === 2 && result.avatars.removed === 2,
  );
  assert(!JSON.stringify(result).includes('-one'));
  assert(
    f.calls.indexOf('remove:submissions:submissions-one') <
      f.calls.indexOf('finish:submissions:submissions-one'),
  );
});
Deno.test('busy/replayed runs never claim or remove', async () => {
  const f = fixture();
  f.store.begin = () => Promise.resolve(false);
  assert((await cleanup(f.store, id)).status === 'skipped');
  assert(f.calls.length === 0);
});
Deno.test(
  'failed removal cannot finalize; queue remains retryable and lease retained',
  async () => {
    const f = fixture();
    f.store.remove = () => Promise.reject(new Error('sensitive path'));
    const result = await cleanup(f.store, id);
    assert(result.submissions.retry === 2 && result.avatars.retry === 2);
    assert(f.calls.length === 0 && f.recorded()?.uncertain);
  },
);
Deno.test('lost finalize acknowledgement remains retryable', async () => {
  const f = fixture();
  f.store.finish = () => Promise.reject(new Error('network'));
  assert((await cleanup(f.store, id)).status === 'retry');
  assert(f.recorded()?.uncertain);
});
Deno.test('deadline bounds dispatch and retains durable queued work', async () => {
  const f = fixture();
  let ticks = 0;
  const result = await cleanup(f.store, id, () => (ticks++ === 0 ? 0 : 100_000));
  assert(result.status === 'retry' && f.calls.length === 0 && f.recorded()?.uncertain);
});
Deno.test('failed durable result write is not reported as success', async () => {
  const f = fixture();
  f.store.complete = () => Promise.resolve(false);
  let failed = false;
  try {
    await cleanup(f.store, id);
  } catch {
    failed = true;
  }
  assert(failed);
});
Deno.test('at most four removals run concurrently', async () => {
  const f = fixture();
  let active = 0;
  let maximum = 0;
  f.store.claim = () => Promise.resolve(Array.from({ length: 20 }, (_, i) => String(i)));
  f.store.remove = async () => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
  };
  await cleanup(f.store, id);
  assert(maximum === 4);
});
Deno.test(
  'endpoint rejects anonymous, wrong secret, extra path and malformed requests without work',
  async () => {
    let calls = 0;
    const secret = 'a'.repeat(64);
    const serve = handler(secret, () => {
      calls++;
      return Promise.resolve({
        status: 'success',
        submissions: { claimed: 0, removed: 0, retry: 0 },
        avatars: { claimed: 0, removed: 0, retry: 0 },
      });
    });
    const request = (body: unknown, key = secret) =>
      new Request('http://localhost', {
        method: 'POST',
        headers: { 'x-cleanup-job-key': key },
        body: JSON.stringify(body),
      });
    assert((await serve(request({ requestId: id }, 'bad'))).status === 401);
    assert((await serve(request({ requestId: id, path: 'arbitrary' }))).status === 400);
    assert((await serve(request({ requestId: 'x'.repeat(400) }))).status === 400);
    assert(calls === 0);
    assert((await serve(request({ requestId: id }))).status === 200);
  },
);
Deno.test('exceptions never expose paths or keys', async () => {
  const serve = handler('a'.repeat(64), () => {
    throw new Error('secret/path');
  });
  const response = await serve(
    new Request('http://localhost', {
      method: 'POST',
      headers: { 'x-cleanup-job-key': 'a'.repeat(64) },
      body: JSON.stringify({ requestId: id }),
    }),
  );
  assert(response.status === 503 && !(await response.text()).includes('secret'));
});
