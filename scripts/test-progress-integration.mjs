import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { localApi } from './lib/local-api.mjs';
import { execute, query } from './lib/local-db.mjs';
import { stripJpegMetadata } from '../src/features/photos/jpeg.ts';

const api = localApi(),
  paths = new Set();
const bucket = 'challenge-submissions';
const jpeg = stripJpegMetadata(
  await readFile(new URL('../tests/fixtures/photo.jpg', import.meta.url)),
);
const email = `xp-${randomUUID()}@example.test`,
  password = `Local-${randomUUID()}!`;
const made = await api.admin.auth.admin.createUser({ email, password, email_confirm: true });
assert.ifError(made.error);
const user = made.data.user.id;
let outsiderId;
const claim = `set local role authenticated; select set_config('request.jwt.claim.sub','${user}',true);`;
async function rpc(client, name, args) {
  const result = await client.rpc(name, args);
  assert.ifError(result.error);
  return result.data;
}
async function reserve(client, assignment) {
  const s = await rpc(client, 'reserve_submission', { assignment_id: assignment });
  paths.add(s.storage_path);
  assert.ifError(
    (await client.storage.from(bucket).upload(s.storage_path, jpeg, { contentType: 'image/jpeg' }))
      .error,
  );
  return s;
}
async function finalize(client, s) {
  const result = await client.functions.invoke('photo-authority', {
    body: { action: 'finalize', submissionId: s.id, visibility: 'private' },
  });
  assert.ifError(result.error);
  assert.equal(result.data.submission.status, 'completed');
}
async function erase(client, s) {
  await rpc(client, 'begin_submission_deletion', { submission_id: s.id });
  assert.ifError((await client.storage.from(bucket).remove([s.storage_path])).error);
  await rpc(client, 'finish_submission_deletion', { submission_id: s.id });
}
try {
  const a = api.client(),
    b = api.client();
  for (const client of [a, b])
    assert.ifError((await client.auth.signInWithPassword({ email, password })).error);
  await rpc(a, 'complete_onboarding', {
    p_username: `x_${randomUUID().replaceAll('-', '').slice(0, 20)}`,
    p_reference_language_id: '00000000-0000-4000-8000-000000000001',
    p_target_language_id: '00000000-0000-4000-8000-000000000002',
    p_cefr_level: 'B1',
    p_timezone: 'UTC',
  });
  // Seed two historical days using real verified photos. Only the isolated test
  // owner's backend facts are shifted; no production clock/function is replaced.
  for (const days of [2, 1]) {
    const challenge =
      await execute(`begin; select set_config('request.jwt.claim.sub','${user}',true);
      insert into public.daily_challenges(user_id,user_language_profile_id,created_at) select user_id,id,clock_timestamp()-interval '${days} days' from public.user_language_profiles where user_id='${user}';
      select private.assign_challenge_word(id,slot) from public.daily_challenges cross join unnest(array['review','target','stretch']) slot where user_id='${user}' and local_challenge_date=(clock_timestamp() at time zone 'UTC')::date-${days}; commit;
      select w.id from public.daily_challenge_words w join public.daily_challenges c on c.id=w.daily_challenge_id where c.user_id='${user}' and c.local_challenge_date=(clock_timestamp() at time zone 'UTC')::date-${days} and w.slot='review';`);
    const assignment = challenge.trim().split('\n').at(-1);
    const s = await reserve(a, assignment);
    await finalize(a, s);
    await execute(`begin; update private.word_completions set completed_at=completed_at-interval '${days} days',local_date=local_date-${days} where submission_id='${s.id}';
      delete from private.qualified_days_seen where user_id='${user}';
      insert into private.qualified_days_seen(user_id,local_date) select distinct user_id,local_date from private.word_completions where user_id='${user}'; commit;`);
  }
  const challenge = await rpc(a, 'get_or_create_today_challenge');
  const photos = await Promise.all(challenge.words.map((w) => reserve(a, w.id)));
  await Promise.all([
    finalize(a, photos[0]),
    finalize(b, photos[1]),
    finalize(a, photos[2]),
    finalize(b, photos[2]),
  ]);
  const progress = await rpc(a, 'get_my_progress', { challenge_id: challenge.challenge.id });
  assert.equal(progress.total_xp, 70);
  assert.equal(progress.current_streak, 3);
  assert.equal(progress.completed_words, 3);
  assert.equal(
    await execute(
      `select count(*) from public.xp_events where user_id='${user}' and event_type='STREAK_MILESTONE';`,
    ),
    '1',
  );
  assert.equal(
    await execute(
      `select count(*) from public.xp_events where user_id='${user}' and event_type='DAILY_CHALLENGE_BONUS';`,
    ),
    '1',
  );
  console.log(
    'PASS: two Auth sessions concurrently finalize three real photos with one full bonus, one milestone and idempotent retry',
  );
  await erase(a, photos[0]);
  assert.equal((await rpc(b, 'get_my_progress')).total_xp, 50);
  const next = await reserve(b, challenge.words[0].id);
  // Hold actual owner locks after finalization while a second device deletes.
  // The trusted function has already attested this valid uploaded JPEG.
  await finalize(b, next);
  const first = query(
    `begin; ${claim} select public.finalize_submission('${next.id}'); select 'AUDIT_LOCKED'; select pg_sleep(1); commit;`,
  );
  assert.equal(await first.ready, true);
  const deletion = erase(a, next);
  assert.equal((await first.result).code, 0);
  await deletion;
  assert.equal((await rpc(a, 'get_my_progress')).total_xp, 50);
  console.log(
    'PASS: deletion concurrent with finalization/retry reconciles word and full bonus without stale credit',
  );
  const restored = await reserve(a, challenge.words[0].id);
  await finalize(a, restored);
  assert.equal((await rpc(a, 'get_my_progress')).total_xp, 70);
  // Stronger-isolation writers cannot reconcile from an old snapshot. Both
  // deletions have no objects left; one finishes via the cleanup worker path.
  for (const s of [restored, photos[1]]) {
    await rpc(a, 'begin_submission_deletion', { submission_id: s.id });
    assert.ifError((await a.storage.from(bucket).remove([s.storage_path])).error);
  }
  const owner = query(
    `begin; ${claim} select public.finish_submission_deletion('${restored.id}'); select 'AUDIT_LOCKED'; select pg_sleep(1); commit;`,
  );
  assert.equal(await owner.ready, true);
  const worker = query(
    `begin isolation level repeatable read; select count(*) from private.word_completions where user_id='${user}'; select public.finish_photo_cleanup('${photos[1].storage_path}'); commit;`,
  );
  assert.equal((await owner.result).code, 0);
  const conflicted = await worker.result;
  assert.notEqual(conflicted.code, 0);
  assert.match(conflicted.error, /40001/);
  await execute(`select public.finish_photo_cleanup('${photos[1].storage_path}');`);
  assert.equal((await rpc(a, 'get_my_progress')).total_xp, 40);
  console.log(
    'PASS: stale REPEATABLE READ cleanup aborts and retry reconciles against committed progress',
  );
  await erase(a, photos[2]);
  assert.equal((await rpc(a, 'get_my_progress')).total_xp, 20);
  assert.equal((await rpc(a, 'get_my_progress')).current_streak, 2);
  assert.equal(
    await execute(
      `select sum(amount) from public.xp_events where user_id='${user}' and event_type='STREAK_MILESTONE';`,
    ),
    '0',
  );
  console.log(
    'PASS: deleting the final qualifying word revokes the milestone and retains historical two-day streak',
  );
  const retry = await reserve(b, challenge.words[2].id);
  await finalize(b, retry);
  await finalize(a, retry);
  assert.equal((await rpc(a, 'get_my_progress')).total_xp, 40);
  assert.equal(
    await execute(
      `select count(*) from (select source_key,source_revision from public.xp_events where user_id='${user}' group by 1,2 having count(*)>1) duplicates;`,
    ),
    '0',
  );
  assert((await a.from('xp_events').insert({ user_id: user, amount: 200 })).error);
  const ownEvents = await a.from('xp_events').select('amount');
  assert.ifError(ownEvents.error);
  assert.equal(
    ownEvents.data.reduce((sum, event) => sum + event.amount, 0),
    40,
  );
  console.log(
    'PASS: deletion/resubmission and repeated RPC calls cannot farm net XP; Auth REST mutations denied',
  );
  // Two possible orderings of retiring the day's last word versus a different
  // first finalization must converge on exactly one day's milestone credit.
  let active = retry;
  for (const deleteFirst of [true, false]) {
    const assignment = challenge.words.find(
      (word) => word.id !== active.daily_challenge_word_id,
    ).id;
    const pending = await reserve(a, assignment);
    await rpc(a, 'begin_submission_deletion', { submission_id: active.id });
    assert.ifError((await a.storage.from(bucket).remove([active.storage_path])).error);
    if (deleteFirst) {
      const held = query(
        `begin; ${claim} select public.finish_submission_deletion('${active.id}'); select 'AUDIT_LOCKED'; select pg_sleep(1); commit;`,
      );
      assert.equal(await held.ready, true);
      const completing = finalize(b, pending);
      assert.equal((await held.result).code, 0);
      await completing;
    } else {
      const held = query(
        `begin; ${claim} select 1 from public.profiles where id='${user}' for update; select 'AUDIT_LOCKED'; select pg_sleep(1); commit;`,
      );
      assert.equal(await held.ready, true);
      const completing = finalize(b, pending);
      assert.equal((await held.result).code, 0);
      await completing;
      await rpc(a, 'finish_submission_deletion', { submission_id: active.id });
    }
    assert.equal((await rpc(a, 'get_my_progress')).total_xp, 40);
    assert.equal((await rpc(b, 'get_my_progress')).current_streak, 3);
    assert.equal(
      await execute(
        `select sum(amount) from public.xp_events where user_id='${user}' and event_type='STREAK_MILESTONE';`,
      ),
      '10',
    );
    active = pending;
  }
  console.log(
    'PASS: last-word deletion before/after a different finalization converges on one milestone and 40 XP',
  );

  const outsiderEmail = `xp-outsider-${randomUUID()}@example.test`,
    outsiderPassword = `Local-${randomUUID()}!`;
  const outsider = await api.admin.auth.admin.createUser({
    email: outsiderEmail,
    password: outsiderPassword,
    email_confirm: true,
  });
  assert.ifError(outsider.error);
  outsiderId = outsider.data.user.id;
  const other = api.client();
  assert.ifError(
    (await other.auth.signInWithPassword({ email: outsiderEmail, password: outsiderPassword }))
      .error,
  );
  await rpc(other, 'complete_onboarding', {
    p_username: `z_${randomUUID().replaceAll('-', '').slice(0, 20)}`,
    p_reference_language_id: '00000000-0000-4000-8000-000000000001',
    p_target_language_id: '00000000-0000-4000-8000-000000000002',
    p_cefr_level: 'B1',
    p_timezone: 'UTC',
  });
  const foreignHistory = await other.from('xp_events').select('*').eq('user_id', user);
  assert.ifError(foreignHistory.error);
  assert.deepEqual(foreignHistory.data, []);
  assert((await other.rpc('get_my_progress', { challenge_id: challenge.challenge.id })).error);
  assert((await other.rpc('get_submission_xp', { submission_id: active.id })).error);
  assert((await other.rpc('finalize_submission', { submission_id: active.id })).error);
  assert((await other.rpc('finish_submission_deletion', { submission_id: active.id })).error);
  assert((await api.client().from('xp_events').select('*')).error);
  const own = await a.from('xp_events').select('*').limit(1);
  assert.ifError(own.error);
  assert((await a.from('xp_events').insert({ ...own.data[0], id: randomUUID() })).error);
  assert((await a.from('xp_events').update({ amount: 200 }).eq('user_id', user)).error);
  assert((await a.from('xp_events').delete().eq('user_id', user)).error);
  assert((await a.rpc('get_my_progress', { user_id: outsiderId, xp: 1000 })).error);
  assert((await a.rpc('reconcile_progress', { owner_id: user, cause_id: active.id })).error);
  assert.equal((await rpc(other, 'get_my_progress')).total_xp, 0);
  assert.equal((await rpc(a, 'get_my_progress')).total_xp, 40);
  console.log(
    'PASS: actual Auth REST denies cross-user ledger/summary/receipt access, mutations and caller-supplied XP',
  );
} finally {
  if (outsiderId) assert.ifError((await api.admin.auth.admin.deleteUser(outsiderId)).error);
  assert.ifError((await api.admin.auth.admin.deleteUser(user)).error);
  if (paths.size) assert.ifError((await api.admin.storage.from(bucket).remove([...paths])).error);
  await execute(`delete from private.photo_cleanup_queue where storage_path like '${user}/%';`);
}
