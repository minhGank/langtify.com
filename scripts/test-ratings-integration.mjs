import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { localApi } from './lib/local-api.mjs';
import { execute, query } from './lib/local-db.mjs';
import { cleanupSubmissions } from './cleanup-submissions.mjs';
import { stripJpegMetadata } from '../src/features/photos/jpeg.ts';

const api = localApi(),
  users = [];
const bucket = 'challenge-submissions';
const jpeg = stripJpegMetadata(
  await readFile(new URL('../tests/fixtures/photo.jpg', import.meta.url)),
);
async function rpc(client, name, args) {
  const result = await client.rpc(name, args);
  assert.ifError(result.error);
  return result.data;
}
async function account() {
  const email = `ratings-${randomUUID()}@example.test`,
    password = `Local-${randomUUID()}!`;
  const made = await api.admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ifError(made.error);
  const id = made.data.user.id;
  users.push(id);
  const client = api.client();
  assert.ifError((await client.auth.signInWithPassword({ email, password })).error);
  await rpc(client, 'complete_onboarding', {
    p_username: `v_${randomUUID().replaceAll('-', '').slice(0, 20)}`,
    p_reference_language_id: '00000000-0000-4000-8000-000000000001',
    p_target_language_id: '00000000-0000-4000-8000-000000000002',
    p_cefr_level: 'B1',
    p_timezone: 'UTC',
  });
  return { client, id, email, password };
}
async function photo(client, assignment) {
  const row = await rpc(client, 'reserve_submission', { assignment_id: assignment });
  assert.ifError(
    (
      await client.storage
        .from(bucket)
        .upload(row.storage_path, jpeg, { contentType: 'image/jpeg' })
    ).error,
  );
  const result = await client.functions.invoke('photo-authority', {
    body: { action: 'finalize', submissionId: row.id, visibility: 'private' },
  });
  assert.ifError(result.error);
  return result.data.submission;
}
async function ownerPreviews(client, ids) {
  const result = await client.functions.invoke('photo-authority', {
    body: { action: 'previews', submissionIds: ids },
  });
  assert.ifError(result.error);
  return result.data.previews;
}
async function erase(client, s) {
  await rpc(client, 'begin_submission_deletion', { submission_id: s.id });
  assert.ifError((await client.storage.from(bucket).remove([s.storage_path])).error);
  await rpc(client, 'finish_submission_deletion', { submission_id: s.id });
}

const target = '00000000-0000-4000-8000-000000000002';
async function feed(client, args) {
  return rpc(client, 'get_discover_feed', args);
}
async function signs(client, ids, extras = {}) {
  const result = await client.functions.invoke('photo-authority', {
    body: { action: 'feed-previews', submissionIds: ids, targetLanguageId: target, ...extras },
  });
  assert.ifError(result.error);
  return result.data;
}
async function visibility(client, id, value) {
  await rpc(client, 'set_submission_visibility', {
    submission_id: id,
    requested_visibility: value,
  });
}
function publicFields(row, signed = false) {
  assert.deepEqual(
    Object.keys(row).sort(),
    [
      'id',
      'target_term',
      'reference_term',
      'cefr_level',
      'username',
      'submitted_at',
      'average_rating',
      'rating_count',
      'viewer_rating',
      'can_rate',
      ...(signed ? ['signed_path'] : []),
    ].sort(),
  );
}

async function rate(client, id, score) {
  return (await rpc(client, 'rate_submission', { submission_id: id, score })).item;
}
const claim = (user) =>
  `set local role authenticated; select set_config('request.jwt.claim.sub','${user}',true);`;
try {
  const a = await account(),
    b = await account(),
    c = await account();
  const challenge = await rpc(a.client, 'get_or_create_today_challenge');
  const first = await photo(a.client, challenge.words[0].id);
  assert((await b.client.rpc('rate_submission', { submission_id: first.id, score: 3 })).error);
  await visibility(a.client, first.id, 'public');
  const xpBefore = await execute(
    `select jsonb_agg(to_jsonb(e) order by id) from public.xp_events e where user_id='${a.id}';`,
  );
  for (const score of [1, 2, 3, 4, 5]) {
    const value = await rate(b.client, first.id, score);
    assert.equal(value.viewer_rating, score);
    assert.equal(value.average_rating, score);
    assert.equal(value.rating_count, 1);
  }
  for (const score of [0, 6, 1.5, null])
    assert((await b.client.rpc('rate_submission', { submission_id: first.id, score })).error);
  assert((await api.client().rpc('rate_submission', { submission_id: first.id, score: 3 })).error);
  assert((await a.client.rpc('rate_submission', { submission_id: first.id, score: 3 })).error);
  assert(
    (
      await b.client.rpc('rate_submission', {
        submission_id: first.id,
        score: 3,
        rater_user_id: c.id,
      })
    ).error,
  );
  assert(
    (
      await b.client
        .from('submission_ratings')
        .insert({ submission_id: first.id, rater_user_id: c.id, score: 5 })
    ).error,
  );
  assert(
    (await b.client.from('submission_ratings').update({ score: 5 }).eq('submission_id', first.id))
      .error,
  );
  assert((await b.client.from('submission_ratings').delete().eq('submission_id', first.id)).error);
  assert((await b.client.from('submission_ratings').select('*')).error);
  console.log(
    'PASS: real Auth scores 1–5, exact bounds, self/private/anonymous denial, spoofing and direct REST manipulation denial',
  );
  await Promise.all(Array.from({ length: 8 }, () => rate(b.client, first.id, 5)));
  assert.equal((await rate(b.client, first.id, 5)).rating_count, 1);
  assert.equal(
    await execute(
      `select jsonb_agg(to_jsonb(e) order by id) from public.xp_events e where user_id='${a.id}';`,
    ),
    xpBefore,
  );
  const second = await photo(a.client, challenge.words[1].id);
  await visibility(a.client, second.id, 'public');
  await Promise.all([rate(b.client, second.id, 3), rate(c.client, second.id, 5)]);
  const ownerFeed = await feed(a.client);
  const summary = ownerFeed.items.find((r) => r.id === second.id);
  publicFields(summary);
  assert.equal(summary.average_rating, 4);
  assert.equal(summary.rating_count, 2);
  assert.equal(summary.viewer_rating, null);
  assert.equal(summary.can_rate, false);
  assert.equal((await signs(b.client, [second.id])).items[0].viewer_rating, 3);
  assert.equal((await signs(c.client, [second.id])).items[0].viewer_rating, 5);
  assert.deepEqual(await ownerPreviews(b.client, [second.id]), [
    { id: second.id, signedPath: null },
  ]);
  console.log(
    'PASS: duplicate retries and simultaneous first votes yield one row each; feed and batch signing expose only current-viewer summary',
  );
  const device = api.client();
  assert.ifError(
    (await device.auth.signInWithPassword({ email: b.email, password: b.password })).error,
  );
  await Promise.all([
    rate(b.client, first.id, 2),
    rate(device, first.id, 4),
    rate(b.client, first.id, 1),
  ]);
  const settled = (await feed(b.client)).items.find((r) => r.id === first.id);
  assert([1, 2, 4].includes(settled.viewer_rating));
  assert.equal(settled.rating_count, 1);
  assert.equal(
    (await feed(device)).items.find((r) => r.id === first.id).viewer_rating,
    settled.viewer_rating,
  );
  assert.equal((await rate(device, first.id, 5)).viewer_rating, 5);
  const idsBeforeVotes = ownerFeed.items.map((row) => row.id);
  assert.deepEqual(
    (await feed(a.client)).items.map((row) => row.id),
    idsBeforeVotes,
  );
  console.log(
    'PASS: competing devices converge to one current vote and an explicit subsequent update wins',
  );
  // Hold the actual vote transaction: privacy must wait, then hide the durable vote.
  const vote = query(
    `begin; ${claim(b.id)} select public.rate_submission('${first.id}',3); select 'AUDIT_LOCKED'; select pg_sleep(1); commit;`,
  );
  assert.equal(await vote.ready, true);
  const hide = visibility(a.client, first.id, 'private');
  assert.equal((await vote.result).code, 0);
  await hide;
  assert(!(await feed(b.client)).items.some((r) => r.id === first.id));
  assert((await b.client.rpc('rate_submission', { submission_id: first.id, score: 4 })).error);
  await visibility(a.client, first.id, 'public');
  assert.equal((await feed(b.client)).items.find((r) => r.id === first.id).viewer_rating, 3);
  // In the opposite order the waiting mutation revalidates and refuses private content.
  const privacy = query(
    `begin; ${claim(a.id)} select public.set_submission_visibility('${first.id}','private'); select 'AUDIT_LOCKED'; select pg_sleep(1); commit;`,
  );
  assert.equal(await privacy.ready, true);
  const waiting = b.client.rpc('rate_submission', { submission_id: first.id, score: 5 });
  const [hidden, rejected] = await Promise.all([privacy.result, waiting]);
  assert.equal(hidden.code, 0);
  assert(rejected.error);
  await visibility(a.client, first.id, 'public');
  assert.equal((await feed(b.client)).items.find((r) => r.id === first.id).viewer_rating, 3);
  console.log(
    'PASS: visibility/vote races serialize in both orders; hiding preserves votes and republishing restores them',
  );
  // Establish an old transaction snapshot before hiding; a stale eligibility
  // snapshot must never permit a vote after a committed submission update.
  const stale = query(
    `begin isolation level repeatable read; ${claim(b.id)}
    select public.get_discover_feed(); select 'AUDIT_LOCKED'; select pg_sleep(1);
    select public.rate_submission('${first.id}',1); commit;`,
  );
  assert.equal(await stale.ready, true);
  await visibility(a.client, first.id, 'private');
  const staleResult = await stale.result;
  assert.notEqual(staleResult.code, 0);
  assert.match(staleResult.error, /40001/);
  await visibility(a.client, first.id, 'public');
  assert.equal((await feed(b.client)).items.find((row) => row.id === first.id).viewer_rating, 3);
  console.log(
    'PASS: stale REPEATABLE READ vote aborts after visibility changes; votes preserve feed order',
  );
  // Capture the ledger after the second photo: ratings alone must not change it.
  const ledger = await execute(
    `select jsonb_agg(to_jsonb(e) order by id) from public.xp_events e where user_id='${a.id}';`,
  );
  await rate(c.client, second.id, 2);
  assert.equal(
    await execute(
      `select jsonb_agg(to_jsonb(e) order by id) from public.xp_events e where user_id='${a.id}';`,
    ),
    ledger,
  );
  const deletion = query(
    `begin; ${claim(a.id)} select public.begin_submission_deletion('${first.id}'); select 'AUDIT_LOCKED'; select pg_sleep(1); commit;`,
  );
  assert.equal(await deletion.ready, true);
  const late = b.client.rpc('rate_submission', { submission_id: first.id, score: 5 });
  const [deleted, denied] = await Promise.all([deletion.result, late]);
  assert.equal(deleted.code, 0);
  assert(denied.error);
  await erase(a.client, first);
  assert((await b.client.rpc('rate_submission', { submission_id: first.id, score: 4 })).error);
  assert.equal(
    await execute(
      `select count(*) from public.submission_ratings where submission_id='${first.id}';`,
    ),
    '1',
  );
  const replacement = await photo(a.client, challenge.words[0].id);
  await visibility(a.client, replacement.id, 'public');
  assert.equal((await feed(b.client)).items.find((r) => r.id === replacement.id).rating_count, 0);
  console.log(
    'PASS: deletion racing a vote rejects new intent, retains retired history, and resubmission starts unrated; ratings leave XP unchanged',
  );
  await execute(`delete from auth.users where id='${c.id}';`);
  const afterCascade = (await feed(b.client)).items.find((r) => r.id === second.id);
  assert.equal(afterCascade.rating_count, 1);
  assert.equal(afterCascade.average_rating, 3);
  await execute(`delete from auth.users where id='${a.id}';`);
  assert.equal(
    await execute(
      `select count(*) from public.submission_ratings where submission_id in('${first.id}','${second.id}','${replacement.id}');`,
    ),
    '0',
  );
  console.log(
    'PASS: permanent rater and owner deletion cascade votes with no stale aggregate cache',
  );
} finally {
  for (const id of users) await execute(`delete from auth.users where id='${id}';`);
  await cleanupSubmissions(api.admin);
}
