import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { localApi } from './lib/local-api.mjs';
import { execute } from './lib/local-db.mjs';
import { cleanupSubmissions } from './cleanup-submissions.mjs';
import { stripJpegMetadata } from '../src/features/photos/jpeg.ts';
const api = localApi(),
  users = [];
async function rpc(client, name, args) {
  const r = await client.rpc(name, args);
  assert.ifError(r.error);
  return r.data;
}
async function account() {
  const email = `push-${randomUUID()}@example.test`,
    password = `Local-${randomUUID()}!`;
  const made = await api.admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ifError(made.error);
  const id = made.data.user.id;
  users.push(id);
  const client = api.client();
  assert.ifError((await client.auth.signInWithPassword({ email, password })).error);
  await rpc(client, 'complete_onboarding', {
    p_username: `p_${randomUUID().replaceAll('-', '').slice(0, 20)}`,
    p_reference_language_id: '00000000-0000-4000-8000-000000000001',
    p_target_language_id: '00000000-0000-4000-8000-000000000002',
    p_cefr_level: 'B1',
    p_timezone: 'UTC',
  });
  return { id, client };
}
const installation = randomUUID(),
  secret = (randomUUID() + randomUUID()).replaceAll('-', ''),
  token = `ExpoPushToken[${randomUUID().replaceAll('-', '')}]`;
const binding = (revision, push = token) => ({
  installation_id: installation,
  installation_secret: secret,
  installation_revision: revision,
  push_token: push,
  device_platform: push ? 'ios' : undefined,
});
async function preferences(client, daily = true, streak = false, enabled = true) {
  return rpc(client, 'save_notification_preferences', {
    notifications_enabled: enabled,
    daily_enabled: daily,
    streak_enabled: streak,
    daily_at: '00:00',
    streak_at: '00:00',
  });
}
async function prepare() {
  return rpc(api.admin, 'claim_notification_attempts', { batch_size: 50 });
}
async function rows(id) {
  return JSON.parse(
    await execute(
      `select coalesce(jsonb_agg(to_jsonb(n) order by kind),'[]') from private.notification_deliveries n where user_id='${id}';`,
    ),
  );
}
async function photo(client, assignment) {
  const s = await rpc(client, 'reserve_submission', { assignment_id: assignment });
  const jpeg = stripJpegMetadata(
    await readFile(new URL('../tests/fixtures/photo.jpg', import.meta.url)),
  );
  assert.ifError(
    (
      await client.storage
        .from('challenge-submissions')
        .upload(s.storage_path, jpeg, { contentType: 'image/jpeg' })
    ).error,
  );
  const finished = await client.functions.invoke('photo-authority', {
    body: { action: 'finalize', submissionId: s.id, visibility: 'private' },
  });
  assert.ifError(finished.error);
  return s;
}
try {
  const a = await account(),
    b = await account();
  const defaults = await rpc(a.client, 'get_notification_preferences');
  assert.equal(defaults.daily_time, '08:00:00');
  assert.equal(defaults.streak_time, '19:00:00');
  assert.equal(defaults.delivery_available, true);
  assert((await a.client.rpc('prepare_due_notifications')).error);
  for (const table of ['notification_preferences']) {
    assert((await a.client.from(table).select('*')).error);
    assert((await a.client.from(table).update({ enabled: true }).eq('user_id', b.id)).error);
  }
  await rpc(a.client, 'sync_push_installation', binding(1));
  await rpc(a.client, 'sync_push_installation', binding(1));
  await preferences(a.client);
  const results = await Promise.all(Array.from({ length: 5 }, prepare));
  assert(results.every((r) => Array.isArray(r.attempts)));
  assert(
    results.every((r) => r.failed === 0),
    'Valid candidates must not fail admission',
  );
  const daily = (await rows(a.id))[0];
  assert.equal(daily.state, 'attempting');
  assert.equal(daily.kind, 'DAILY_WORDS');
  assert.equal(daily.timezone, 'UTC');
  const challenge = await rpc(a.client, 'get_or_create_today_challenge');
  assert.deepEqual(
    daily.words,
    challenge.words.map((w) => w.target_term),
  );
  assert(daily.words.every((w) => daily.body.includes(w)));
  await rpc(a.client, 'replace_daily_challenge_word', {
    active_assignment_id: challenge.words[0].id,
  });
  await preferences(a.client);
  await prepare();
  assert.deepEqual(await rows(a.id), [daily]);
  console.log(
    'PASS: real Auth preferences default to 08:00/19:00; concurrent preparation consumes one attempt with three authoritative words, replacement cannot duplicate, and device delivery is not claimed',
  );

  assert(
    (
      await b.client.rpc('sync_push_installation', {
        ...binding(2),
        installation_secret: 'b'.repeat(64),
      })
    ).error,
  );
  assert(
    (await b.client.rpc('sync_push_installation', { ...binding(1), installation_id: randomUUID() }))
      .error,
  );
  await preferences(b.client, false, false, false);
  await rpc(b.client, 'sync_push_installation', binding(2));
  assert((await a.client.rpc('sync_push_installation', binding(1))).error);
  const raced = await Promise.all([
    a.client.rpc('sync_push_installation', binding(3)),
    b.client.rpc('sync_push_installation', binding(4)),
  ]);
  for (const r of raced) if (r.error) assert.equal(r.error.code, '40001');
  assert.equal(
    await execute(`select user_id from private.push_installations where id='${installation}';`),
    b.id,
  );
  await rpc(api.client(), 'sync_push_installation', binding(5, null));
  assert((await a.client.rpc('sync_push_installation', binding(3))).error);
  assert.equal(
    await execute(
      `select token is null from private.push_installations where id='${installation}';`,
    ),
    't',
  );
  const refreshed = `ExpoPushToken[${randomUUID().replaceAll('-', '')}]`;
  await rpc(a.client, 'sync_push_installation', binding(6, refreshed));
  assert.equal(
    await execute(`select count(*) from private.push_installations where id='${installation}';`),
    '1',
  );
  console.log(
    'PASS: secret/revision ownership rejects token theft, stale account writes and old retries; anonymous capability revocation and token replacement preserve one binding',
  );

  await rpc(b.client, 'sync_push_installation', {
    ...binding(1),
    installation_id: randomUUID(),
    push_token: `ExpoPushToken[${randomUUID().replaceAll('-', '')}]`,
  });
  await preferences(b.client, true, false, false);
  await prepare();
  assert.equal((await rows(b.id)).length, 0);
  await preferences(b.client, false, false, true);
  await prepare();
  assert.equal((await rows(b.id)).length, 0);
  await execute(
    `update auth.users set banned_until=now()+interval '1 day' where id='${b.id}'; update public.notification_preferences set daily_words=true,next_check_at=now() where user_id='${b.id}';`,
  );
  await prepare();
  assert.equal((await rows(b.id)).length, 0);
  await execute(
    `update auth.users set banned_until=null where id='${b.id}'; update private.safety_accounts set restricted=true where user_id='${b.id}'; update public.notification_preferences set next_check_at=now() where user_id='${b.id}';`,
  );
  await prepare();
  assert.equal((await rows(b.id)).length, 1);
  console.log(
    'PASS: disabled preferences and banned accounts are excluded; public restrictions preserve private learning preparation',
  );

  const current = await rpc(a.client, 'get_or_create_today_challenge');
  const yesterday = await photo(a.client, current.words[0].id);
  await execute(
    `update private.word_completions set completed_at=completed_at-interval '1 day',local_date=local_date-1 where submission_id='${yesterday.id}';`,
  );
  await preferences(a.client, false, true);
  await prepare();
  assert((await rows(a.id)).some((r) => r.kind === 'STREAK_AT_RISK' && r.title.includes('1-day')));
  await photo(a.client, current.words[1].id);
  await execute(
    `delete from private.notification_deliveries where user_id='${a.id}' and kind='STREAK_AT_RISK';`,
  );
  await preferences(a.client, false, true);
  await prepare();
  assert(!(await rows(a.id)).some((r) => r.kind === 'STREAK_AT_RISK'));
  console.log(
    'PASS: a surviving yesterday streak prepares a reminder, and one real completed word today suppresses it',
  );

  await execute(`delete from private.notification_deliveries where user_id='${b.id}';`);
  await b.client.auth.signOut({ scope: 'local' });
  await execute(
    `update public.notification_preferences set next_check_at=now() where user_id='${b.id}';`,
  );
  await prepare();
  assert.equal((await rows(b.id)).length, 0);
  await execute(`delete from auth.users where id='${b.id}';`);
  assert.equal(
    await execute(
      `select count(*) from private.push_installations where user_id='${b.id}' or (user_id is null and token is not null);`,
    ),
    '0',
  );
  console.log(
    'PASS: revoked Auth sessions cannot qualify; hard account deletion clears bindings and private preparation records',
  );

  // Only local fixtures are altered to force a catalog failure and prove rollback.
  const c = await account();
  await rpc(c.client, 'sync_push_installation', {
    ...binding(1),
    installation_id: randomUUID(),
    push_token: `ExpoPushToken[${randomUUID().replaceAll('-', '')}]`,
  });
  await preferences(c.client);
  const failure = await execute(
    `begin; update public.vocabulary_concepts set is_active=false; select public.claim_notification_attempts(50); select count(*) from public.daily_challenges where user_id='${c.id}'; rollback;`,
  );
  assert(failure.includes('"failed": 1'));
  assert.equal((await rows(c.id)).length, 0);
  assert.equal(
    await execute(`select count(*) from public.daily_challenges where user_id='${c.id}';`),
    '0',
  );
  await prepare();
  assert.equal((await rows(c.id)).length, 1);
  console.log(
    'PASS: insufficient vocabulary rolls back the entire candidate; retry consumes once without partial challenge or fake delivery',
  );
} finally {
  for (const id of users) await execute(`delete from auth.users where id='${id}';`);
  await cleanupSubmissions(api.admin);
}
