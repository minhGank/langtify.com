import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { localApi } from './lib/local-api.mjs';
import { execute } from './lib/local-db.mjs';
import { reservePriorDailyFixture } from './lib/prior-daily-fixture.mjs';
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
  const email = `history-${randomUUID()}@example.test`,
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
  return { client, id };
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
async function previews(client, ids) {
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
try {
  const a = await account(),
    b = await account();
  assert.equal((await rpc(a.client, 'get_my_vocabulary')).total_concepts, 0);
  const challenge = await rpc(a.client, 'get_or_create_today_challenge');
  const review = challenge.words.find((w) => w.slot === 'review');
  const first = await photo(a.client, review.id);
  let history = await rpc(a.client, 'get_my_vocabulary');
  assert.equal(history.total_concepts, 1);
  assert.equal(history.items[0].id, first.id);
  const second = await photo(a.client, challenge.words.find((w) => w.slot === 'target').id);
  history = await rpc(a.client, 'get_my_vocabulary');
  assert.equal(history.total_concepts, 2);
  console.log('PASS: real verified private photos appear as distinct concepts');

  // A second historical assignment of the same concept. Use normal snapshot
  // triggers; only fixture creation is privileged, all photos use real APIs.
  const output = await execute(`begin;
    select set_config('request.jwt.claim.sub','${a.id}',true);
    insert into public.daily_challenges(user_id,user_language_profile_id,created_at)
      select user_id,id,clock_timestamp()-interval '2 days' from public.user_language_profiles where user_id='${a.id}';
    insert into public.daily_challenge_words(daily_challenge_id,slot,cefr_level,vocabulary_term_id)
      select c.id,'review','A2','${first.vocabulary_term_id}' from public.daily_challenges c where c.user_id='${a.id}' and c.id<>'${challenge.challenge.id}';
    select private.assign_challenge_word(c.id,slot) from public.daily_challenges c cross join unnest(array['target','stretch']) slot where c.user_id='${a.id}' and c.id<>'${challenge.challenge.id}';
    commit;
    select w.id from public.daily_challenge_words w join public.daily_challenges c on c.id=w.daily_challenge_id where c.user_id='${a.id}' and c.id<>'${challenge.challenge.id}' and w.slot='review';`);
  const repeatedAssignment = output.split('\n').at(-1);
  await reservePriorDailyFixture(a.id, repeatedAssignment);
  const repeated = await photo(a.client, repeatedAssignment);
  history = await rpc(a.client, 'get_my_vocabulary');
  assert.equal(history.total_concepts, 2);
  assert.equal(history.items[0].id, repeated.id);
  assert.equal(history.items[0].capture_count, 2);
  const detail = await rpc(a.client, 'get_my_vocabulary', {
    requested_concept: first.concept_id,
    page_size: 1,
  });
  assert.equal(detail.items.length, 1);
  assert.equal(detail.items[0].id, repeated.id);
  assert.equal(detail.has_more, true);
  const older = await rpc(a.client, 'get_my_vocabulary', {
    requested_concept: first.concept_id,
    page_size: 1,
    before_time: detail.items[0].submitted_at,
    before_id: detail.items[0].id,
  });
  assert.equal(older.items[0].id, first.id);
  assert.equal(older.has_more, false);
  assert.equal(older.concept.id, repeated.id);
  const mainFirst = await rpc(a.client, 'get_my_vocabulary', { page_size: 1 });
  const mainNext = await rpc(a.client, 'get_my_vocabulary', {
    page_size: 1,
    before_time: mainFirst.items[0].submitted_at,
    before_id: mainFirst.items[0].id,
  });
  assert.equal(mainNext.items[0].id, second.id);
  for (const search_text of [first.target_term.toUpperCase(), first.reference_term.toUpperCase()]) {
    const found = await rpc(a.client, 'get_my_vocabulary', { search_text });
    assert(found.items.some((r) => r.concept_id === first.concept_id));
  }
  assert.equal(
    (await rpc(a.client, 'get_my_vocabulary', { requested_level: 'A2' })).items.length,
    1,
  );
  assert.equal(
    (await rpc(a.client, 'get_my_vocabulary', { requested_level: 'C2' })).items.length,
    0,
  );
  console.log(
    'PASS: repeated concepts retain newest image and all captures; both searches, CEFR and keyset pages work',
  );

  const bChallenge = await rpc(b.client, 'get_or_create_today_challenge');
  const foreignPhoto = await photo(b.client, bChallenge.words[0].id);
  const pending = await rpc(a.client, 'reserve_submission', {
    assignment_id: challenge.words.find((w) => w.slot === 'stretch').id,
  });
  assert.ifError(
    (
      await a.client.storage
        .from(bucket)
        .upload(pending.storage_path, jpeg, { contentType: 'image/jpeg' })
    ).error,
  );
  const mixedIds = [
    first.id,
    second.id,
    foreignPhoto.id,
    pending.id,
    ...Array.from({ length: 20 }, () => randomUUID()),
  ];
  const mixed = await previews(a.client, mixedIds);
  assert.equal(mixed.length, 24);
  assert(mixed[0].signedPath && mixed[1].signedPath);
  assert(mixed.slice(2).every((row) => row.signedPath === null));
  assert.equal((await previews(a.client, [first.id.toUpperCase()]))[0].signedPath !== null, true);
  assert(
    (
      await a.client.functions.invoke('photo-authority', {
        body: { action: 'previews', submissionIds: [first.id, first.id.toUpperCase()] },
      })
    ).error,
  );
  await rpc(a.client, 'begin_submission_deletion', { submission_id: pending.id });
  assert.equal((await previews(a.client, [pending.id]))[0].signedPath, null);
  await erase(a.client, pending);
  const direct = await a.client.storage.from(bucket).createSignedUrls([first.storage_path], 3600);
  assert(direct.error || direct.data.every((row) => !row.signedUrl));
  assert(
    (
      await api.client().functions.invoke('photo-authority', {
        body: { action: 'previews', submissionIds: [first.id] },
      })
    ).error,
  );
  const malicious = await a.client.functions.invoke('photo-authority', {
    body: {
      action: 'previews',
      submissionIds: [first.id],
      userId: b.id,
      storage_path: foreignPhoto.storage_path,
      expiresIn: 86400,
      download: true,
    },
  });
  assert.ifError(malicious.error);
  const maliciousUri = new URL(api.url + malicious.data.previews[0].signedPath);
  assert.equal(maliciousUri.searchParams.size, 1);
  const fixedClaims = JSON.parse(
    Buffer.from(maliciousUri.searchParams.get('token').split('.')[1], 'base64url').toString(),
  );
  assert.equal(fixedClaims.exp - fixedClaims.iat, 60);
  assert(maliciousUri.pathname.endsWith(first.storage_path));
  console.log(
    'PASS: max-size mixed batches hide foreign/pending/deleting IDs, UUID case aliases normalize, and direct/TTL/path signing bypasses fail',
  );

  const signed = await previews(a.client, [first.id, second.id, repeated.id]);
  assert.equal(signed.length, 3);
  for (const s of signed) {
    assert.equal((await fetch(api.url + s.signedPath)).status, 200);
    const token = new URL(api.url + s.signedPath).searchParams.get('token');
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    assert.equal(claims.exp - claims.iat, 60);
  }
  await rpc(a.client, 'set_submission_visibility', {
    submission_id: repeated.id,
    requested_visibility: 'public',
  });
  assert.equal((await rpc(a.client, 'get_my_vocabulary')).items[0].visibility, 'public');
  assert.deepEqual(
    (await rpc(b.client, 'get_my_vocabulary')).items.map((row) => row.id),
    [foreignPhoto.id],
  );
  assert(
    (await rpc(b.client, 'get_my_vocabulary', { requested_concept: first.concept_id })).items.every(
      (row) => row.id === foreignPhoto.id,
    ),
  );
  assert.deepEqual(await previews(b.client, [first.id, repeated.id]), [
    { id: first.id, signedPath: null },
    { id: repeated.id, signedPath: null },
  ]);
  assert((await api.client().rpc('get_my_vocabulary')).error);
  for (const submissionIds of [
    [],
    Array(25).fill(first.id),
    [first.id, first.id],
    ['../evil'],
    [123],
  ])
    assert(
      (
        await a.client.functions.invoke('photo-authority', {
          body: { action: 'previews', submissionIds },
        })
      ).error,
    );
  console.log(
    'PASS: batch photos preserve owner-only access, public visibility privacy, anonymous denial and bounded UUID input',
  );

  await erase(a.client, repeated);
  history = await rpc(a.client, 'get_my_vocabulary');
  const surviving = history.items.find((r) => r.concept_id === first.concept_id);
  assert.equal(surviving.id, first.id);
  assert.equal(surviving.capture_count, 1);
  assert.equal((await previews(a.client, [repeated.id]))[0].signedPath, null);
  await erase(a.client, first);
  history = await rpc(a.client, 'get_my_vocabulary');
  assert.equal(history.total_concepts, 1);
  assert.equal(
    (await rpc(a.client, 'get_my_vocabulary', { requested_concept: first.concept_id })).concept,
    null,
  );
  console.log(
    'PASS: completed deletion removes a capture, restores prior image, then removes the final concept',
  );

  // A read racing finalization/deletion must be wholly before or after commit.
  const last = challenge.words.find((w) => w.slot === 'stretch');
  const racing = await Promise.all([
    photo(a.client, last.id),
    ...Array.from({ length: 4 }, () => rpc(a.client, 'get_my_vocabulary')),
  ]);
  for (const value of racing.slice(1)) {
    assert([1, 2].includes(value.total_concepts));
    assert.equal(value.items.length, value.total_concepts);
  }
  await Promise.all([
    erase(a.client, racing[0]),
    ...Array.from({ length: 4 }, async () => {
      const page = await rpc(a.client, 'get_my_vocabulary');
      assert([1, 2].includes(page.total_concepts));
      assert.equal(page.items.length, page.total_concepts);
    }),
  ]);
  assert.equal((await rpc(a.client, 'get_my_vocabulary')).total_concepts, 1);
  console.log('PASS: concurrent lifecycle/history reads see consistent bounded database snapshots');
  // Keep the second object valid: prove expiry, not a 404 caused by deletion.
  const expiringPath = signed.find((row) => row.id === second.id).signedPath;
  const expiryToken = new URL(api.url + expiringPath).searchParams.get('token');
  const expires = JSON.parse(Buffer.from(expiryToken.split('.')[1], 'base64url').toString()).exp;
  console.log('Waiting for the batch preview server-expiry assertion.');
  while (Date.now() < (expires + 2) * 1000) {
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(30000, (expires + 2) * 1000 - Date.now())),
    );
  }
  assert.notEqual((await fetch(api.url + expiringPath)).status, 200);
  const renewed = await previews(a.client, [second.id]);
  assert.equal((await fetch(api.url + renewed[0].signedPath)).status, 200);
  console.log(
    'PASS: batch preview actually expires for an existing valid object, and owner reload restores access',
  );
} finally {
  for (const id of users) await execute(`delete from auth.users where id='${id}';`);
  await cleanupSubmissions(api.admin);
}
