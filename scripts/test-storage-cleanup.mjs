// Local only. Concurrent service admissions, real adapter and migration replay.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { localApi } from './lib/local-api.mjs';
import { execute } from './lib/local-db.mjs';
import { cleanup } from '../supabase/functions/storage-cleanup/worker.ts';
import { cleanupStore } from '../supabase/functions/storage-cleanup/store.ts';
const { admin, client } = localApi();
const ids = Array.from({ length: 12 }, () => randomUUID());
const counts = {
  submissions: { claimed: 0, removed: 0, retry: 0 },
  avatars: { claimed: 0, removed: 0, retry: 0 },
};
try {
  const denied = await client().rpc('begin_storage_cleanup_run', {
    request_id: randomUUID(),
    runner_name: 'edge',
  });
  assert.ok(denied.error);
  const results = await Promise.all(
    ids.map((request_id) =>
      admin.rpc('begin_storage_cleanup_run', { request_id, runner_name: 'edge' }),
    ),
  );
  assert.ok(results.every((result) => !result.error));
  assert.equal(results.filter((result) => result.data).length, 1);
  const winner = ids[results.findIndex((result) => result.data)];
  const before = await execute('select row_to_json(l) from private.storage_cleanup_lease l;');
  await execute(
    await readFile(
      new URL(
        '../supabase/migrations/20261003000000_storage_cleanup_coordination.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  assert.equal(
    await execute('select row_to_json(l) from private.storage_cleanup_lease l;'),
    before,
  );
  assert.equal((await cleanup(cleanupStore(admin), winner)).status, 'skipped');
  const finish = await admin.rpc('finish_storage_cleanup_run', { request_id: winner, counts });
  assert.equal(finish.error, null);
  assert.equal(finish.data, true);
  // Real adapter exercises both existing queues. Local fixture suites verify valid-object guards.
  const run = randomUUID();
  ids.push(run);
  const result = await cleanup(cleanupStore(admin), run);
  assert.equal(result.status, 'success');
  assert.equal(result.submissions.retry, 0);
  assert.equal(result.avatars.retry, 0);
  assert.equal((await cleanup(cleanupStore(admin), run)).status, 'skipped');
  console.log(
    'PASS: 12 concurrent requests admit one owner; anonymous denial, replay preservation, both queues and completed-run deduplication',
  );
} finally {
  await execute(
    `begin; update private.storage_cleanup_lease set run_id=null,expires_at='-infinity' where run_id=any(array[${ids.map((id) => `'${id}'::uuid`).join(',')}]); delete from private.storage_cleanup_runs where id=any(array[${ids.map((id) => `'${id}'::uuid`).join(',')}]); commit;`,
  );
}
