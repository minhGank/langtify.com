// Real local Auth/PostgREST/Storage plus ordered contention. No hosted project,
// fixture credentials, object paths or signed capabilities are printed.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { localApi } from './lib/local-api.mjs';
import { execute, query } from './lib/local-db.mjs';
import { reservePriorDailyFixture } from './lib/prior-daily-fixture.mjs';
import { cleanupSubmissions } from './cleanup-submissions.mjs';
import { stripJpegMetadata } from '../src/features/photos/jpeg.ts';

const api = localApi();
const users = [];
const target = '00000000-0000-4000-8000-000000000002';
const reference = '00000000-0000-4000-8000-000000000001';
const bucket = 'challenge-submissions';
const jpeg = stripJpegMetadata(
  await readFile(new URL('../tests/fixtures/photo.jpg', import.meta.url)),
);
const claim = (id) =>
  `set local role authenticated; select set_config('request.jwt.claim.sub','${id}',true);`;
async function rpc(client, name, args = {}) {
  const response = await client.rpc(name, args);
  assert.ifError(response.error);
  return response.data;
}
async function account(timezone = 'UTC') {
  const email = `past-${randomUUID()}@example.test`;
  const password = `Local-${randomUUID()}!`;
  const made = await api.admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ifError(made.error);
  const id = made.data.user.id;
  users.push(id);
  const client = api.client();
  assert.ifError((await client.auth.signInWithPassword({ email, password })).error);
  await rpc(client, 'complete_onboarding', {
    p_username: `past_${randomUUID().replaceAll('-', '').slice(0, 18)}`,
    p_reference_language_id: reference,
    p_target_language_id: target,
    p_cefr_level: 'B1',
    p_timezone: timezone,
  });
  return { id, client, email, password };
}
async function seedChallenge(actor, dateSql) {
  const id = randomUUID();
  // Seed assignment history only; every reserve/upload/finalize uses real Auth
  // and the actual Storage/byte-verification functions. Snapshot triggers stay on.
  await execute(`begin;
    select set_config('request.jwt.claim.sub','${actor.id}',true);
    insert into public.daily_challenges(id,user_id,user_language_profile_id,created_at)
      select '${id}',user_id,id,((${dateSql})::date+time '12:00') at time zone timezone
      from public.user_language_profiles where user_id='${actor.id}';
    select private.assign_challenge_word('${id}',slot)
      from unnest(array['review','target','stretch']) slot;
    commit;`);
  const words = JSON.parse(
    await execute(`select jsonb_agg(to_jsonb(w) order by slot)
      from public.daily_challenge_words w where daily_challenge_id='${id}';`),
  );
  return { id, words };
}
const reserve = (client, assignment) =>
  rpc(client, 'reserve_historical_submission', { assignment_id: assignment });
async function upload(client, row, bytes = jpeg) {
  const response = await client.storage
    .from(bucket)
    .upload(row.storage_path, bytes, { contentType: 'image/jpeg', upsert: false });
  assert.ifError(response.error);
}
async function finalize(client, row, visibility = 'private') {
  const response = await client.functions.invoke('photo-authority', {
    body: { action: 'finalize', submissionId: row.id, visibility },
  });
  assert.ifError(response.error);
  assert.equal(response.data.submission.id, row.id);
  assert.equal(response.data.submission.status, 'completed');
  assert.equal(response.data.submission.capture_kind, 'historical');
  return response.data.submission;
}
async function erase(client, row) {
  await rpc(client, 'begin_submission_deletion', { submission_id: row.id });
  assert.ifError((await client.storage.from(bucket).remove([row.storage_path])).error);
  return rpc(client, 'finish_submission_deletion', { submission_id: row.id });
}
const progress = (client, challenge) =>
  rpc(client, 'get_my_progress', challenge ? { challenge_id: challenge } : {});
function noDailyCredit(value, xp) {
  assert.equal(value.total_xp, xp);
  assert.equal(value.completed_words, 0);
  assert.equal(value.current_streak, 0);
  assert.equal(value.longest_streak, 0);
  assert.equal(value.total_words_completed, 0);
  assert.equal(value.total_challenges_completed, 0);
}
const direct = (client, submission) =>
  rpc(client, 'get_discover_submission', { submission_id: submission });
async function sign(client, ids) {
  const response = await client.functions.invoke('photo-authority', {
    body: { action: 'feed-previews', submissionIds: ids, targetLanguageId: target },
  });
  assert.ifError(response.error);
  return response.data.items;
}

try {
  const owner = await account();
  const viewer = await account();
  const secondDevice = api.client();
  assert.ifError(
    (await secondDevice.auth.signInWithPassword({ email: owner.email, password: owner.password }))
      .error,
  );
  const today = await rpc(owner.client, 'get_or_create_today_challenge');
  const older = await seedChallenge(owner, 'current_date-2');
  const recent = await seedChallenge(owner, 'current_date-1');
  const word = older.words[0];
  assert.equal((await rpc(owner.client, 'get_my_past_words')).items.length, 6);
  assert.deepEqual((await rpc(viewer.client, 'get_my_past_words')).items, []);
  for (const assignment of [today.words[0].id, randomUUID(), word.vocabulary_term_id])
    assert(
      (await owner.client.rpc('reserve_historical_submission', { assignment_id: assignment }))
        .error,
    );
  assert(
    (await viewer.client.rpc('reserve_historical_submission', { assignment_id: word.id })).error,
  );
  assert((await owner.client.rpc('reserve_submission', { assignment_id: word.id })).error);
  assert((await api.client().rpc('get_my_past_words')).error);
  assert((await owner.client.rpc('get_my_past_words', { user_id: viewer.id })).error);
  assert((await owner.client.rpc('get_my_past_words', { page_size: 101 })).error);
  assert((await owner.client.rpc('get_my_past_words', { requested_level: 'D1' })).error);
  console.log(
    'PASS: only owned previously assigned words enter historical capture; current/catalog/foreign IDs and invented identity are denied',
  );

  const reservations = await Promise.all([
    reserve(owner.client, word.id),
    reserve(secondDevice, word.id),
    reserve(owner.client, word.id),
    secondDevice.rpc('reserve_submission', { assignment_id: word.id }),
  ]);
  assert(reservations.pop().error);
  const first = reservations[0];
  assert.equal(new Set(reservations.map((row) => row.id)).size, 1);
  assert.equal(first.capture_kind, 'historical');
  assert.equal(first.visibility, 'private');
  assert((await owner.client.rpc('finalize_submission', { submission_id: first.id })).error);
  assert(
    (await owner.client.from('submissions').update({ capture_kind: 'daily' }).eq('id', first.id))
      .error,
  );
  assert(
    (
      await viewer.client.storage
        .from(bucket)
        .upload(first.storage_path, jpeg, { contentType: 'image/jpeg' })
    ).error,
  );
  assert(
    (
      await owner.client.storage
        .from(bucket)
        .upload(`${owner.id}/${randomUUID()}.jpg`, jpeg, { contentType: 'image/jpeg' })
    ).error,
  );
  assert(
    (
      await owner.client.storage
        .from(bucket)
        .upload(first.storage_path, jpeg, { contentType: 'image/png' })
    ).error,
  );
  assert(
    (
      await owner.client.storage.from(bucket).upload(first.storage_path, jpeg, {
        contentType: 'image/jpeg',
        metadata: { gps: 'forbidden' },
      })
    ).error,
  );
  const missingBytes = await owner.client.functions.invoke('photo-authority', {
    body: { action: 'finalize', submissionId: first.id, visibility: 'private' },
  });
  assert(missingBytes.error);
  noDailyCredit(await progress(owner.client), 0);
  await upload(owner.client, first);
  const recovered = await rpc(secondDevice, 'get_assignment_photo', { assignment_id: word.id });
  assert.equal(recovered.submission.id, first.id);
  assert.equal(recovered.submission.capture_kind, 'historical');
  await Promise.all([
    finalize(owner.client, first),
    finalize(secondDevice, first),
    finalize(owner.client, first),
  ]);
  // A lost acknowledgement is reconciled by the durable reservation identity.
  assert.equal((await reserve(secondDevice, word.id)).id, first.id);
  await finalize(secondDevice, first);
  noDailyCredit(await progress(owner.client), 10);
  noDailyCredit(await progress(owner.client, older.id), 10);
  const receipt = await rpc(owner.client, 'get_submission_xp', { submission_id: first.id });
  assert.equal(receipt.word_xp, 10);
  assert.equal(receipt.challenge_bonus_xp, 0);
  assert.equal(receipt.milestone_xp, 0);
  assert.equal(receipt.total_awarded_xp, 10);
  assert.equal(
    await execute(`select count(*) from public.xp_events where user_id='${owner.id}';`),
    '1',
  );
  assert.equal(
    await execute(`select count(*) from private.word_completions where user_id='${owner.id}';`),
    '0',
  );
  assert.equal(
    await execute(`select count(*) from private.qualified_days_seen where user_id='${owner.id}';`),
    '0',
  );
  console.log(
    'PASS: concurrent two-device reservation/finalization, upload recovery and acknowledgement retries award one +10 source without any daily/streak fact',
  );

  const completed = [first];
  for (const assigned of older.words.slice(1)) {
    const row = await reserve(secondDevice, assigned.id);
    await upload(secondDevice, row);
    completed.push(row);
  }
  await Promise.all([
    finalize(owner.client, completed[1], 'public'),
    finalize(secondDevice, completed[2], 'public'),
    finalize(secondDevice, completed[1], 'public'),
  ]);
  noDailyCredit(await progress(owner.client, older.id), 30);
  noDailyCredit(await progress(owner.client, today.challenge.id), 30);
  assert.equal(
    await execute(
      `select count(*) from public.xp_events where user_id='${owner.id}' and event_type<>'WORD_COMPLETED';`,
    ),
    '0',
  );
  assert.equal(
    (await rpc(owner.client, 'get_or_create_today_challenge')).words.filter(
      (row) => row.submission?.status === 'completed',
    ).length,
    0,
  );
  const dictionary = await rpc(owner.client, 'get_my_vocabulary');
  assert.equal(dictionary.total_concepts, 3);
  assert.deepEqual(
    dictionary.items.map((row) => row.id).sort(),
    completed.map((row) => row.id).sort(),
  );
  const concept = await rpc(owner.client, 'get_my_vocabulary', {
    requested_concept: word.concept_id,
  });
  assert.equal(concept.items[0].id, first.id);
  console.log(
    'PASS: three old-word captures earn 30 total, retain dictionary history and never complete an old/current day or qualify a streak',
  );

  const all = await rpc(owner.client, 'get_my_past_words');
  assert.equal(all.items.length, 6);
  assert(all.items.slice(0, 3).every((row) => row.has_capture === false));
  assert(all.items.slice(3).every((row) => row.has_capture === true));
  const paged = [];
  let cursor = {};
  for (let page = 0; page < 8; page += 1) {
    const result = await rpc(owner.client, 'get_my_past_words', { ...cursor, page_size: 1 });
    paged.push(...result.items);
    if (!result.has_more) break;
    assert.equal(result.items.length, 1);
    const last = result.items[0];
    cursor = {
      before_captured: last.has_capture,
      before_date: last.challenge_date,
      before_id: last.assignment_id,
    };
  }
  assert.equal(paged.length, 6);
  assert.equal(new Set(paged.map((row) => row.assignment_id)).size, 6);
  assert.deepEqual(
    paged.map((row) => row.assignment_id),
    all.items.map((row) => row.assignment_id),
  );
  for (const search_text of [word.target_term.toUpperCase(), word.reference_term.toUpperCase()]) {
    const found = await rpc(owner.client, 'get_my_past_words', { search_text });
    assert(found.items.some((row) => row.assignment_id === word.id));
  }
  assert(
    (
      await rpc(owner.client, 'get_my_past_words', { requested_level: word.cefr_level })
    ).items.every((row) => row.cefr_level === word.cefr_level),
  );
  assert.equal(
    (await rpc(owner.client, 'get_my_past_words', { search_text: '%%' })).items.length,
    0,
  );
  assert.equal(
    (await rpc(owner.client, 'get_my_past_words', { requested_level: 'C2' })).items.length,
    0,
  );
  console.log(
    'PASS: missing-first chronological keysets cross the captured boundary without duplicates; snapshot search, CEFR and empty states remain bounded',
  );

  const publicPhoto = completed[1];
  assert.equal((await direct(viewer.client, publicPhoto.id)).items.length, 1);
  assert.equal((await direct(viewer.client, first.id)).items.length, 0);
  assert(
    (await owner.client.rpc('rate_submission', { submission_id: publicPhoto.id, score: 5 })).error,
  );
  await rpc(viewer.client, 'rate_submission', { submission_id: publicPhoto.id, score: 4 });
  const comment = await rpc(viewer.client, 'create_submission_comment', {
    submission_id: publicPhoto.id,
    body: 'A clear word example',
    request_id: randomUUID(),
  });
  assert.equal(
    (await rpc(owner.client, 'get_submission_comments', { submission_id: publicPhoto.id })).items[0]
      .id,
    comment.comment_id,
  );
  const signed = await sign(viewer.client, [publicPhoto.id, first.id]);
  assert.deepEqual(
    signed.map((row) => row.id),
    [publicPhoto.id],
  );
  const url = new URL(api.url + signed[0].signed_path);
  const claims = JSON.parse(
    Buffer.from(url.searchParams.get('token').split('.')[1], 'base64url').toString(),
  );
  assert.equal(claims.exp - claims.iat, 60);
  assert.equal((await fetch(url)).status, 200);
  assert((await viewer.client.storage.from(bucket).download(first.storage_path)).error);
  assert(
    (await viewer.client.storage.from(bucket).createSignedUrl(publicPhoto.storage_path, 3600))
      .error,
  );
  assert.deepEqual(
    (await viewer.client.from('submissions').select('*').eq('user_id', owner.id)).data,
    [],
  );
  assert.deepEqual(
    (await viewer.client.from('xp_events').select('*').eq('user_id', owner.id)).data,
    [],
  );
  assert((await owner.client.from('xp_events').insert({ user_id: owner.id, amount: 10 })).error);
  await rpc(viewer.client, 'block_submission_user', { submission_id: publicPhoto.id });
  assert.equal((await direct(viewer.client, publicPhoto.id)).items.length, 0);
  assert.deepEqual(await sign(viewer.client, [publicPhoto.id]), []);
  assert(
    (await viewer.client.rpc('rate_submission', { submission_id: publicPhoto.id, score: 5 })).error,
  );
  assert(
    (await viewer.client.rpc('get_submission_comments', { submission_id: publicPhoto.id })).error,
  );
  const blocks = await rpc(viewer.client, 'get_blocked_users');
  await rpc(viewer.client, 'unblock_user', { block_id: blocks.items[0].id });
  await execute(
    `insert into private.submission_moderation(submission_id,removed) values('${publicPhoto.id}',true);`,
  );
  assert.equal((await direct(viewer.client, publicPhoto.id)).items.length, 0);
  assert.deepEqual(await sign(viewer.client, [publicPhoto.id]), []);
  await rpc(owner.client, 'set_submission_visibility', {
    submission_id: publicPhoto.id,
    requested_visibility: 'private',
  });
  await rpc(owner.client, 'set_submission_visibility', {
    submission_id: publicPhoto.id,
    requested_visibility: 'public',
  });
  assert.equal((await direct(viewer.client, publicPhoto.id)).items.length, 0);
  await execute(
    `update private.submission_moderation set removed=false where submission_id='${publicPhoto.id}';`,
  );
  assert.equal((await direct(viewer.client, publicPhoto.id)).items.length, 1);
  noDailyCredit(await progress(owner.client), 30);
  console.log(
    'PASS: historical public photos reuse ratings/comments/private signing, blocks and moderation; social changes cannot mutate learning XP',
  );

  const held = query(`begin; ${claim(owner.id)}
    select public.finalize_submission('${first.id}');
    select 'AUDIT_LOCKED';select pg_sleep(0.5);commit;`);
  assert.equal(await held.ready, true);
  const deletion = erase(secondDevice, first);
  const lockedResult = await held.result;
  assert.equal(lockedResult.code, 0, lockedResult.error);
  await deletion;
  noDailyCredit(await progress(owner.client), 20);
  assert.equal((await direct(viewer.client, first.id)).items.length, 0);
  assert.equal(
    (await rpc(owner.client, 'get_my_vocabulary', { requested_concept: word.concept_id })).concept,
    null,
  );
  assert.equal(
    (await rpc(owner.client, 'get_my_past_words')).items.find(
      (row) => row.assignment_id === word.id,
    ).has_capture,
    false,
  );
  for (let cycle = 0; cycle < 2; cycle += 1) {
    const next = await reserve(secondDevice, word.id);
    await upload(secondDevice, next);
    await Promise.all([finalize(owner.client, next), finalize(secondDevice, next)]);
    noDailyCredit(await progress(owner.client), 30);
    assert((await owner.client.rpc('reserve_submission', { assignment_id: word.id })).error);
    await erase(owner.client, next);
    noDailyCredit(await progress(owner.client), 20);
  }
  const restored = await reserve(owner.client, word.id);
  await upload(owner.client, restored);
  await finalize(owner.client, restored);
  noDailyCredit(await progress(owner.client), 30);
  assert.equal(
    await execute(
      `select sum(amount) from public.xp_events where user_id='${owner.id}' and source_key='word:${word.id}';`,
    ),
    '10',
  );
  assert.equal(
    await execute(
      `select count(*) from (select source_key,source_revision from public.xp_events where user_id='${owner.id}' group by 1,2 having count(*)>1) duplicates;`,
    ),
    '0',
  );
  console.log(
    'PASS: finalization/deletion contention and repeated delete/resubmit cycles retain one net +10 assignment entitlement and immutable signed reversals',
  );

  const interrupted = await reserve(owner.client, recent.words[0].id);
  await upload(owner.client, interrupted, Buffer.from('not a JPEG'));
  const invalidImage = await owner.client.functions.invoke('photo-authority', {
    body: { action: 'finalize', submissionId: interrupted.id, visibility: 'public' },
  });
  assert(invalidImage.error);
  noDailyCredit(await progress(owner.client), 30);
  await rpc(owner.client, 'begin_submission_deletion', { submission_id: interrupted.id });
  const cleaned = await cleanupSubmissions(api.admin);
  assert.equal(cleaned.retry, 0);
  assert((await api.admin.storage.from(bucket).download(interrupted.storage_path)).error);
  const retry = await reserve(secondDevice, recent.words[0].id);
  await upload(secondDevice, retry);
  assert(
    (
      await viewer.client.functions.invoke('photo-authority', {
        body: { action: 'finalize', submissionId: retry.id, visibility: 'public' },
      })
    ).error,
  );
  await finalize(secondDevice, retry);
  noDailyCredit(await progress(owner.client), 40);
  console.log(
    'PASS: spoofed JPEG bytes and wrong-account finalization earn nothing; cleanup retires interrupted attempts and explicit retry safely restores capture',
  );

  const legacy = await seedChallenge(owner, 'current_date-3');
  const legacyWord = legacy.words[0];
  await reservePriorDailyFixture(owner.id, legacyWord.id);
  const daily = await rpc(owner.client, 'reserve_submission', { assignment_id: legacyWord.id });
  assert.equal(daily.capture_kind, 'daily');
  assert(
    (await owner.client.rpc('reserve_historical_submission', { assignment_id: legacyWord.id }))
      .error,
  );
  await upload(owner.client, daily);
  const lateDaily = await owner.client.functions.invoke('photo-authority', {
    body: { action: 'finalize', submissionId: daily.id, visibility: 'private' },
  });
  assert.ifError(lateDaily.error);
  assert.equal((await progress(owner.client)).current_streak, 1);
  assert.equal((await progress(owner.client)).total_xp, 50);
  assert(
    (await secondDevice.rpc('reserve_historical_submission', { assignment_id: legacyWord.id }))
      .error,
  );
  await erase(owner.client, daily);
  noDailyCredit(await progress(owner.client), 40);
  const reclaimed = await reserve(secondDevice, legacyWord.id);
  await upload(secondDevice, reclaimed);
  await finalize(secondDevice, reclaimed);
  noDailyCredit(await progress(owner.client), 50);
  assert.equal(
    await execute(
      `select sum(amount) from public.xp_events where user_id='${owner.id}' and source_key='word:${legacyWord.id}';`,
    ),
    '10',
  );
  console.log(
    'PASS: grandfathered daily recovery remains daily; its active entitlement fences historical capture, and deletion restores only the same +10 word source without repairing the daily/streak fact',
  );

  const traveler = await account('Pacific/Kiritimati');
  const acrossDateLine = await seedChallenge(
    traveler,
    "(clock_timestamp() at time zone 'Pacific/Pago_Pago')::date",
  );
  const traveling = await reserve(traveler.client, acrossDateLine.words[0].id);
  await upload(traveler.client, traveling);
  await rpc(traveler.client, 'update_learning_preferences', {
    target_language_id: target,
    reference_language_id: reference,
    cefr_level: 'B1',
    timezone: 'Pacific/Pago_Pago',
  });
  assert(
    (
      await traveler.client.rpc('reserve_historical_submission', {
        assignment_id: acrossDateLine.words[1].id,
      })
    ).error,
  );
  assert.equal((await reserve(traveler.client, acrossDateLine.words[0].id)).id, traveling.id);
  await finalize(traveler.client, traveling);
  noDailyCredit(await progress(traveler.client), 10);
  const admitted = await rpc(traveler.client, 'get_assignment_photo', {
    assignment_id: acrossDateLine.words[0].id,
  });
  assert.equal(admitted.submission.capture_kind, 'historical');
  assert.equal(
    await execute(`select count(*) from private.word_completions where user_id='${traveler.id}';`),
    '0',
  );
  console.log(
    'PASS: saved IANA date changes fence new historical uploads while an admitted upload retains historical-only recovery semantics across the date boundary',
  );
} finally {
  for (const id of users) assert.ifError((await api.admin.auth.admin.deleteUser(id)).error);
  await cleanupSubmissions(api.admin);
}
