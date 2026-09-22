// Real local Auth/PostgREST/Storage only; no hosted credentials or services.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { localApi } from './lib/local-api.mjs';
import { execute } from './lib/local-db.mjs';
import { reservePriorDailyFixture } from './lib/prior-daily-fixture.mjs';
import { cleanupSubmissions } from './cleanup-submissions.mjs';
import { stripJpegMetadata } from '../src/features/photos/jpeg.ts';

const api = localApi();
const users = [];
const target = '00000000-0000-4000-8000-000000000002';
const reference = '00000000-0000-4000-8000-000000000001';
const jpeg = stripJpegMetadata(
  await readFile(new URL('../tests/fixtures/photo.jpg', import.meta.url)),
);
async function rpc(client, name, args = {}) {
  const response = await client.rpc(name, args);
  assert.ifError(response.error);
  return response.data;
}
async function account() {
  const email = `explore-${randomUUID()}@example.test`;
  const password = `Local-${randomUUID()}!`;
  const made = await api.admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ifError(made.error);
  users.push(made.data.user.id);
  const client = api.client();
  assert.ifError((await client.auth.signInWithPassword({ email, password })).error);
  const username = `ex_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  await rpc(client, 'complete_onboarding', {
    p_username: username,
    p_reference_language_id: reference,
    p_target_language_id: target,
    p_cefr_level: 'B1',
    p_timezone: 'UTC',
  });
  return {
    id: made.data.user.id,
    client,
    username,
    profile: (await rpc(client, 'get_public_profile')).profile,
  };
}
async function photo(actor, assignment, visibility = 'public') {
  const reserved = await rpc(actor.client, 'reserve_submission', { assignment_id: assignment });
  assert.ifError(
    (
      await actor.client.storage
        .from('challenge-submissions')
        .upload(reserved.storage_path, jpeg, { contentType: 'image/jpeg' })
    ).error,
  );
  const response = await actor.client.functions.invoke('photo-authority', {
    body: { action: 'finalize', submissionId: reserved.id, visibility },
  });
  assert.ifError(response.error);
  return response.data.submission;
}
async function examples(actor, conceptId, args = {}) {
  return rpc(actor.client, 'get_concept_submissions', { concept_id: conceptId, ...args });
}
async function direct(actor, id) {
  return rpc(actor.client, 'get_discover_submission', { submission_id: id });
}
async function sign(actor, ids) {
  const result = await actor.client.functions.invoke('photo-authority', {
    body: { action: 'feed-previews', submissionIds: ids, targetLanguageId: target },
  });
  assert.ifError(result.error);
  return result.data;
}
function publicFields(row) {
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
    ].sort(),
  );
}
try {
  const owner = await account();
  const viewer = await account();
  const other = await account();
  const challenge = await rpc(owner.client, 'get_or_create_today_challenge');
  const word = challenge.words.find((word) => word.slot === 'review');
  assert(word);
  const first = await photo(owner, word.id);
  const hidden = await photo(
    owner,
    challenge.words.find((row) => row.slot === 'target').id,
    'private',
  );
  // Seed a second historical challenge for this fixture owner, preserving every
  // preparation/constraint trigger and using the existing selector for other slots.
  const assignment = await execute(`begin;
    select set_config('request.jwt.claim.sub','${owner.id}',true);
    do $$declare challenge_id uuid;begin
      insert into public.daily_challenges(user_id,user_language_profile_id,created_at)
        select user_id,id,statement_timestamp()-interval '1 day' from public.user_language_profiles where user_id='${owner.id}' returning id into challenge_id;
      insert into public.daily_challenge_words(daily_challenge_id,slot,cefr_level,vocabulary_term_id)
        values(challenge_id,'review','${word.cefr_level}','${word.vocabulary_term_id}');
      perform private.assign_challenge_word(challenge_id,'target');
      perform private.assign_challenge_word(challenge_id,'stretch');
    end$$;
    select id from public.daily_challenge_words where daily_challenge_id=(select id from public.daily_challenges where user_id='${owner.id}' and local_challenge_date=current_date-1) and slot='review';
    commit;`);
  const assignmentId = assignment.split('\n').findLast((line) => /^[0-9a-f-]{36}$/.test(line));
  assert(assignmentId);
  await reservePriorDailyFixture(owner.id, assignmentId);
  const second = await photo(owner, assignmentId);
  const conceptId = word.concept_id;
  const term = word.target_term;
  // Search a meaningful token rather than the leading French article.
  const tokens = term.match(/[\p{L}\p{N}]+/gu).filter((token) => token.length >= 2);
  const token = tokens.sort((a, b) => b.length - a.length)[0];
  assert(token);
  const search = await rpc(viewer.client, 'search_vocabulary_terms', { query: token });
  assert.equal(search.viewer_id, viewer.id);
  assert.equal(search.target_language_id, target);
  assert.equal(search.reference_language_id, reference);
  assert(search.items.some((row) => row.concept_id === conceptId));
  for (const row of search.items)
    assert.deepEqual(
      Object.keys(row).sort(),
      ['concept_id', 'target_term', 'reference_term', 'cefr_level'].sort(),
    );
  const detail = await rpc(viewer.client, 'get_explore_concept', { concept_id: conceptId });
  assert.equal(detail.item.target_term, term);
  assert.equal(detail.item.reference_term, word.reference_term);
  assert.equal(detail.item.cefr_level, word.cefr_level);
  assert.equal(
    (await rpc(viewer.client, 'search_vocabulary_terms', { query: 'nonexistentqauniquesearch' }))
      .items.length,
    0,
  );
  assert((await viewer.client.rpc('search_vocabulary_terms', { query: '%%' })).error);
  assert(
    (await viewer.client.rpc('search_vocabulary_terms', { query: token, page_size: 25 })).error,
  );
  assert((await api.client().rpc('search_vocabulary_terms', { query: token })).error);
  console.log(
    'PASS: authenticated token-prefix search, linked translation/CEFR, current language context and bounded input',
  );

  const page1 = await examples(viewer, conceptId, { page_size: 1 });
  assert.equal(page1.items[0].id, second.id);
  assert.equal(page1.has_more, true);
  const page2 = await examples(viewer, conceptId, {
    page_size: 1,
    before_time: page1.items[0].submitted_at,
    before_id: page1.items[0].id,
  });
  assert.equal(page2.items[0].id, first.id);
  page1.items.forEach(publicFields);
  assert.deepEqual((await direct(viewer, hidden.id)).items, []);
  assert.deepEqual((await direct(viewer, randomUUID())).items, []);
  assert.equal((await direct(viewer, first.id)).items[0].can_rate, true);
  assert.equal((await direct(owner, first.id)).items[0].can_rate, false);
  await rpc(viewer.client, 'rate_submission', { submission_id: first.id, score: 4 });
  assert.equal((await direct(viewer, first.id)).items[0].viewer_rating, 4);
  assert.equal((await direct(other, first.id)).items[0].viewer_rating, null);
  assert.equal((await direct(other, first.id)).viewer_id, other.id);
  assert.deepEqual(
    (await viewer.client.from('submissions').select('*').eq('id', first.id)).data,
    [],
  );
  assert.deepEqual((await viewer.client.from('profiles').select('*').eq('id', owner.id)).data, []);
  assert(
    (
      await viewer.client.rpc('get_discover_photo_targets', {
        viewer: owner.id,
        expected_target: target,
        submission_ids: [first.id],
      })
    ).error,
  );
  const signed = await sign(viewer, [first.id, hidden.id]);
  assert.deepEqual(
    signed.items.map((row) => row.id),
    [first.id],
  );
  const url = new URL(api.url + signed.items[0].signed_path);
  const claims = JSON.parse(
    Buffer.from(url.searchParams.get('token').split('.')[1], 'base64url').toString(),
  );
  assert.equal(claims.exp - claims.iat, 60);
  assert.equal((await fetch(url)).status, 200);
  assert(
    (
      await viewer.client.storage
        .from('challenge-submissions')
        .createSignedUrl(first.storage_path, 60)
    ).error,
  );
  console.log(
    'PASS: newest concept keysets, minimal direct-post fields, own-rating denial, viewer isolation and controlled 60-second photo access',
  );

  await rpc(viewer.client, 'set_follow', { profile_id: owner.profile.id, following: true });
  const people = await rpc(viewer.client, 'search_public_profiles', { prefix: owner.username });
  assert.equal(people.items[0].is_following, true);
  assert.equal(people.items[0].is_self, false);
  await rpc(viewer.client, 'block_public_profile', { profile_id: owner.profile.id });
  assert(
    !(await examples(viewer, conceptId)).items.some(
      (row) => row.id === first.id || row.id === second.id,
    ),
  );
  assert.deepEqual((await direct(viewer, first.id)).items, []);
  assert.deepEqual((await sign(viewer, [first.id])).items, []);
  assert.deepEqual(
    (await rpc(viewer.client, 'search_public_profiles', { prefix: owner.username })).items,
    [],
  );
  const blocks = await rpc(viewer.client, 'get_blocked_users');
  await rpc(viewer.client, 'unblock_user', { block_id: blocks.items[0].id });
  await execute(
    `insert into private.submission_moderation(submission_id,removed) values('${first.id}',true);`,
  );
  assert.deepEqual((await direct(viewer, first.id)).items, []);
  const moderated = await examples(viewer, conceptId);
  assert(!moderated.items.some((row) => row.id === first.id));
  assert(moderated.items.some((row) => row.id === second.id));
  await execute(`update private.safety_accounts set restricted=true where user_id='${owner.id}';`);
  assert(
    !(await examples(viewer, conceptId)).items.some(
      (row) => row.id === first.id || row.id === second.id,
    ),
  );
  assert.deepEqual((await sign(viewer, [second.id])).items, []);
  await execute(`update private.safety_accounts set restricted=false where user_id='${owner.id}';`);
  await rpc(owner.client, 'set_submission_visibility', {
    submission_id: second.id,
    requested_visibility: 'private',
  });
  assert(
    !(await examples(viewer, conceptId)).items.some(
      (row) => row.id === first.id || row.id === second.id,
    ),
  );
  assert.deepEqual((await direct(viewer, second.id)).items, []);
  await rpc(owner.client, 'set_submission_visibility', {
    submission_id: second.id,
    requested_visibility: 'public',
  });
  await rpc(owner.client, 'begin_submission_deletion', { submission_id: second.id });
  assert.deepEqual((await direct(viewer, second.id)).items, []);
  assert.deepEqual((await sign(viewer, [second.id])).items, []);
  console.log(
    'PASS: blocks, removed content, restricted owners, private visibility and deletion deny examples, direct entry and renewed signatures',
  );

  await rpc(viewer.client, 'update_learning_preferences', {
    target_language_id: reference,
    reference_language_id: target,
    cefr_level: 'B1',
    timezone: 'UTC',
  });
  const switched = await rpc(viewer.client, 'get_explore_concept', { concept_id: conceptId });
  assert.equal(switched.target_language_id, reference);
  assert.equal(switched.item.target_term, word.reference_term);
  assert(
    !(await examples(viewer, conceptId)).items.some(
      (row) => row.id === first.id || row.id === second.id,
    ),
  );
  assert.deepEqual((await direct(viewer, hidden.id)).items, []);
  await execute(`update private.safety_accounts set restricted=true where user_id='${viewer.id}';`);
  assert((await viewer.client.rpc('search_vocabulary_terms', { query: token })).error);
  assert((await viewer.client.rpc('get_discover_submission', { submission_id: first.id })).error);
  console.log(
    'PASS: persisted target/reference changes and restricted-viewer admission also apply to direct navigation',
  );
} finally {
  for (const id of users) assert.ifError((await api.admin.auth.admin.deleteUser(id)).error);
  await cleanupSubmissions(api.admin);
}
