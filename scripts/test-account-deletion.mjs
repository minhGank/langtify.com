// Local-only Auth/DB/Storage lifecycle test. Never reads hosted credentials.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { localApi } from './lib/local-api.mjs';
import { execute } from './lib/local-db.mjs';
import { cleanupSubmissions } from './cleanup-submissions.mjs';
import { cleanupAvatars } from './cleanup-avatars.mjs';
const api = localApi();
const users = [];
const paths = [];
async function rpc(client, name, args) {
  const result = await client.rpc(name, args);
  assert.ifError(result.error);
  return result.data;
}
async function account() {
  const email = `erasure-${randomUUID()}@example.test`,
    password = randomUUID();
  const made = await api.admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ifError(made.error);
  users.push(made.data.user.id);
  const client = api.client();
  assert.ifError((await client.auth.signInWithPassword({ email, password })).error);
  await rpc(client, 'complete_onboarding', {
    p_username: `e_${randomUUID().replaceAll('-', '').slice(0, 20)}`,
    p_reference_language_id: '00000000-0000-4000-8000-000000000001',
    p_target_language_id: '00000000-0000-4000-8000-000000000002',
    p_cefr_level: 'B1',
    p_timezone: 'UTC',
  });
  return { client, email, password, id: made.data.user.id };
}
try {
  const a = await account(),
    b = await account();
  assert.ok((await api.client().rpc('delete_my_account')).error);
  assert.ok((await a.client.rpc('delete_my_account', { user_id: b.id })).error);
  const challenge = await rpc(a.client, 'get_or_create_today_challenge');
  const photo = await rpc(a.client, 'reserve_submission', { assignment_id: challenge.words[0].id });
  const avatar = (await rpc(a.client, 'reserve_profile_avatar', { request_id: randomUUID() }))
    .avatar;
  const bytes = await readFile(new URL('../tests/fixtures/photo.jpg', import.meta.url));
  for (const [bucket, path] of [
    ['challenge-submissions', photo.storage_path],
    ['profile-avatars', avatar.storage_path],
  ]) {
    paths.push([bucket, path]);
    assert.ifError(
      (await a.client.storage.from(bucket).upload(path, bytes, { contentType: 'image/jpeg' }))
        .error,
    );
    assert.ok(
      (await api.admin.storage.from(bucket).remove([path])).error,
      'guard protects pending upload',
    );
  }
  assert.equal(await rpc(a.client, 'delete_my_account'), true);
  assert.equal(await rpc(a.client, 'delete_my_account'), true, 'retry after lost acknowledgement');
  assert.ok((await api.admin.auth.admin.getUserById(a.id)).error);
  assert.ifError((await api.admin.auth.admin.getUserById(b.id)).error);
  assert.ok(
    (await api.client().auth.signInWithPassword({ email: a.email, password: a.password })).error,
  );
  // Real Storage API outage simulation: removals fail but durable jobs survive.
  const failedStorage = {
    rpc: api.admin.rpc.bind(api.admin),
    storage: { from: () => ({ remove: async () => ({ error: new Error('fixture outage') }) }) },
  };
  assert.ok((await cleanupSubmissions(failedStorage)).retry > 0);
  assert.ok((await cleanupAvatars(failedStorage)).retry > 0);
  for (const [bucket, path] of paths)
    assert.ifError((await api.admin.storage.from(bucket).download(path)).error);
  // Release retry backoff for these fixture paths only; do not alter eligibility.
  for (const [bucket, path] of paths) {
    assert.match(path, /^[a-f0-9/-]+\.jpg$/);
    const table = bucket === 'profile-avatars' ? 'avatar_cleanup_queue' : 'photo_cleanup_queue';
    await execute(`update private.${table} set last_attempt_at=null where storage_path='${path}'`);
  }
  assert.equal((await cleanupSubmissions(api.admin)).retry, 0);
  assert.equal((await cleanupAvatars(api.admin)).retry, 0);
  for (const [bucket, path] of paths)
    assert.ok((await api.admin.storage.from(bucket).download(path)).error);
  assert.ifError((await a.client.auth.signOut({ scope: 'local' })).error);
  console.log(
    'PASS: real local Auth erasure, same-token retry, cross-account denial, guarded uploads, failed removal persistence and Storage API cleanup',
  );
} finally {
  for (const id of users) {
    assert.match(id, /^[a-f0-9-]{36}$/);
    await execute(`delete from auth.users where id='${id}'`);
  }
  // Clean fixture objects through Storage API only, never SQL metadata deletion.
  for (const [bucket, path] of paths) await api.admin.storage.from(bucket).remove([path]);
}
