import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { localApi } from './lib/local-api.mjs';
import { execute, query } from './lib/local-db.mjs';
import { cleanupSubmissions } from './cleanup-submissions.mjs';
import { stripJpegMetadata } from '../src/features/photos/jpeg.ts';

const api = localApi();
const users = [],
  paths = new Set();
const bucket = 'challenge-submissions';
const jpeg = stripJpegMetadata(
  await readFile(new URL('../tests/fixtures/photo.jpg', import.meta.url)),
);
async function preview(client, id) {
  const result = await client.functions.invoke('photo-authority', {
    body: { action: 'preview', submissionId: id },
  });
  assert.ifError(result.error);
  return result.data.signedPath ? api.url + result.data.signedPath : null;
}
async function rpc(client, name, args) {
  if (name === 'finalize_submission') {
    const finished = await client.functions.invoke('photo-authority', {
      body: {
        action: 'finalize',
        submissionId: args.submission_id,
        visibility: args.requested_visibility ?? 'private',
      },
    });
    if (finished.error)
      throw new Error(
        `Verification failed: ${JSON.stringify(await finished.error.context.json())}`,
      );
    return finished.data.submission;
  }
  const result = await client.rpc(name, args);
  assert.ifError(result.error);
  return result.data;
}
async function account() {
  const email = `photo-${randomUUID()}@example.test`,
    password = `Local-${randomUUID()}!`;
  const made = await api.admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ifError(made.error);
  users.push(made.data.user.id);
  const client = api.client();
  assert.ifError((await client.auth.signInWithPassword({ email, password })).error);
  await rpc(client, 'complete_onboarding', {
    p_username: `p_${randomUUID().replaceAll('-', '').slice(0, 20)}`,
    p_reference_language_id: '00000000-0000-4000-8000-000000000001',
    p_target_language_id: '00000000-0000-4000-8000-000000000002',
    p_cefr_level: 'B1',
    p_timezone: 'UTC',
  });
  return { client, email, password, id: made.data.user.id };
}
async function reserve(client, id) {
  const s = await rpc(client, 'reserve_submission', { assignment_id: id });
  paths.add(s.storage_path);
  return s;
}
async function upload(client, s) {
  assert.ifError(
    (
      await client.storage
        .from(bucket)
        .upload(s.storage_path, jpeg, { contentType: 'image/jpeg', upsert: false })
    ).error,
  );
}
try {
  const a = await account(),
    b = await account();
  const challenge = await rpc(a.client, 'get_or_create_today_challenge');
  const assignment = challenge.words[0].id;
  const reservations = await Promise.all([
    reserve(a.client, assignment),
    reserve(a.client, assignment),
  ]);
  const s = reservations[0];
  assert.equal(s.id, reservations[1].id);
  assert.equal(s.visibility, 'private');
  assert((await b.client.rpc('reserve_submission', { assignment_id: assignment })).error);
  assert((await a.client.rpc('finalize_submission', { submission_id: s.id })).error);
  assert(
    (
      await a.client
        .from('submissions')
        .insert({ daily_challenge_word_id: assignment, status: 'completed' })
    ).error,
  );
  console.log(
    'PASS: real authenticated reservation is private, concurrent/idempotent, and rejects wrong-owner/direct completion',
  );

  assert(
    (
      await b.client.storage
        .from(bucket)
        .upload(s.storage_path, jpeg, { contentType: 'image/jpeg' })
    ).error,
  );
  assert(
    (
      await a.client.storage
        .from(bucket)
        .upload(`${a.id}/${randomUUID()}.jpg`, jpeg, { contentType: 'image/jpeg' })
    ).error,
  );
  assert.equal(await preview(a.client, s.id), null);
  assert(
    (await a.client.storage.from(bucket).upload(s.storage_path, jpeg, { contentType: 'image/png' }))
      .error,
  );
  assert(
    (
      await a.client.storage
        .from(bucket)
        .upload(s.storage_path, Buffer.alloc(5242881), { contentType: 'image/jpeg' })
    ).error,
  );
  assert(
    (
      await a.client.storage
        .from(bucket)
        .upload(s.storage_path, jpeg, { contentType: 'image/jpeg', metadata: { gps: 'forbidden' } })
    ).error,
  );
  await upload(a.client, s);
  assert(
    (
      await a.client.storage
        .from(bucket)
        .upload(s.storage_path, jpeg, { contentType: 'image/jpeg', upsert: true })
    ).error,
  );
  assert((await b.client.storage.from(bucket).download(s.storage_path)).error);
  assert((await b.client.storage.from(bucket).createSignedUrl(s.storage_path, 60)).error);
  assert((await api.client().storage.from(bucket).download(s.storage_path)).error);
  const publicRead = await fetch(`${api.url}/storage/v1/object/public/${bucket}/${s.storage_path}`);
  assert.notEqual(publicRead.status, 200);
  console.log(
    'PASS: actual private Storage denies cross-user/anonymous reads, invented paths and overwrite',
  );

  // Simulate process restart after a successful upload but before finalization.
  const restored = api.client();
  assert.ifError(
    (await restored.auth.signInWithPassword({ email: a.email, password: a.password })).error,
  );
  const recovered = await rpc(restored, 'get_assignment_photo', { assignment_id: assignment });
  assert.equal(recovered.submission.id, s.id);
  assert.equal(recovered.submission.status, 'pending');
  const signedPreview = await preview(restored, s.id);
  assert.equal((await fetch(signedPreview)).status, 200);
  const finalizations = await Promise.all([
    rpc(restored, 'finalize_submission', { submission_id: s.id }),
    rpc(a.client, 'finalize_submission', { submission_id: s.id }),
  ]);
  finalizations.forEach((value) => assert.equal(value.id, s.id));
  assert.equal(finalizations[0].status, 'completed');
  assert(
    (await a.client.rpc('replace_daily_challenge_word', { active_assignment_id: assignment }))
      .error,
  );
  assert.equal(
    (await rpc(restored, 'get_or_create_today_challenge')).words[0].submission.status,
    'completed',
  );
  await a.client.storage.from(bucket).remove([s.storage_path]);
  assert.ifError((await a.client.storage.from(bucket).download(s.storage_path)).error);
  console.log(
    'PASS: uploaded photo survives restart; concurrent finalization completes once and blocks replacement/direct image deletion',
  );

  await rpc(a.client, 'set_submission_visibility', {
    submission_id: s.id,
    requested_visibility: 'public',
  });
  assert(
    (
      await b.client.rpc('set_submission_visibility', {
        submission_id: s.id,
        requested_visibility: 'private',
      })
    ).error,
  );
  assert.equal((await b.client.from('submissions').select('*').eq('id', s.id)).data.length, 0);
  assert((await b.client.storage.from(bucket).download(s.storage_path)).error);
  await b.client.storage.from(bucket).remove([s.storage_path]);
  assert.ifError((await a.client.storage.from(bucket).download(s.storage_path)).error);
  console.log(
    'PASS: public visibility preserves private Storage and all owner-only mutation rules',
  );

  await rpc(a.client, 'begin_submission_deletion', { submission_id: s.id });
  assert((await a.client.rpc('finish_submission_deletion', { submission_id: s.id })).error);
  const cleanup = await cleanupSubmissions(api.admin);
  assert(cleanup.removed >= 1);
  assert.equal(cleanup.retry, 0);
  assert.equal(
    (await rpc(a.client, 'finish_submission_deletion', { submission_id: s.id })).status,
    'deleted',
  );
  assert((await a.client.storage.from(bucket).download(s.storage_path)).error);
  assert.equal((await rpc(a.client, 'get_or_create_today_challenge')).words[0].submission, null);
  const next = await reserve(a.client, assignment);
  assert.notEqual(next.id, s.id);
  console.log(
    'PASS: interrupted deletion is repaired by cleanup; image disappears, completion clears, and a new photo is allowed',
  );

  await upload(a.client, next);
  await execute(`begin; alter table public.submissions disable trigger prepare_submission;
    update public.submissions set expires_at=clock_timestamp()-interval '1 second' where id='${next.id}';
    alter table public.submissions enable trigger prepare_submission; commit;`);
  assert((await a.client.rpc('finalize_submission', { submission_id: next.id })).error);
  const expired = await cleanupSubmissions(api.admin);
  assert(expired.removed >= 1);
  assert((await api.admin.storage.from(bucket).download(next.storage_path)).error);
  console.log(
    'PASS: abandoned expired upload is deleted through the Storage API and its reservation retired',
  );

  // Replacement and reserve compete under the same profile lock; one state wins.
  const secondAssignment = challenge.words[1].id;
  const held =
    query(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${a.id}',true);
    select public.reserve_submission('${secondAssignment}'); select 'AUDIT_LOCKED'; select pg_sleep(1); commit;`);
  assert.equal(await held.ready, true);
  const replace = await a.client.rpc('replace_daily_challenge_word', {
    active_assignment_id: secondAssignment,
  });
  assert(replace.error);
  assert.match(replace.error.message, /assignment_has_submission/);
  assert.equal((await held.result).code, 0);
  console.log(
    'PASS: concurrent reserve versus replacement cannot detach an upload from its active assignment',
  );

  const historicalId = randomUUID();
  await execute(`begin; insert into public.daily_challenges(id,user_id,user_language_profile_id,created_at)
    select '${historicalId}',user_id,id,clock_timestamp()-interval '1 day' from public.user_language_profiles where user_id='${a.id}';
    select private.assign_challenge_word('${historicalId}','review');
    select private.assign_challenge_word('${historicalId}','target');
    select private.assign_challenge_word('${historicalId}','stretch'); commit;`);
  const historicalAssignment = await execute(
    `select id from public.daily_challenge_words where daily_challenge_id='${historicalId}' and slot='review';`,
  );
  const unfinished = await reserve(a.client, historicalAssignment);
  const recoveries = await a.client
    .from('submissions')
    .select('id,daily_challenge_word_id,target_term')
    .in('status', ['pending', 'deleting']);
  assert.ifError(recoveries.error);
  assert(recoveries.data.some((row) => row.id === unfinished.id));
  const recoveredOlder = await rpc(a.client, 'get_assignment_photo', {
    assignment_id: historicalAssignment,
  });
  assert.notEqual(
    recoveredOlder.challenge.local_challenge_date,
    challenge.challenge.local_challenge_date,
  );
  assert.equal(recoveredOlder.submission.id, unfinished.id);
  console.log(
    'PASS: owner can discover and resume an unfinished earlier-date assignment independently of Today',
  );

  const cascade = await reserve(a.client, assignment);
  await upload(a.client, cascade);
  await rpc(a.client, 'finalize_submission', { submission_id: cascade.id });
  await execute(`delete from auth.users where id='${a.id}';`);
  const cascadeClean = await cleanupSubmissions(api.admin);
  assert(cascadeClean.removed >= 1);
  assert((await api.admin.storage.from(bucket).download(cascade.storage_path)).error);
  console.log('PASS: account cascade retains cleanup work until the physical object is removed');

  // Even a pre-authorized upload must not recreate a path after cascade/deletion.
  assert(
    (
      await api.admin.storage
        .from(bucket)
        .upload(s.storage_path, jpeg, { contentType: 'image/jpeg' })
    ).error,
  );
  assert((await api.admin.storage.from(bucket).download(s.storage_path)).error);
  console.log('PASS: commit-time guard rejects late objects after account cleanup');
} finally {
  for (const id of users) await execute(`delete from auth.users where id='${id}';`);
  await cleanupSubmissions(api.admin);
}
