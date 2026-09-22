// Local Auth/PostgREST/Storage and SQL contention only. Never uses a hosted project.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { localApi } from './lib/local-api.mjs';
import { execute, query } from './lib/local-db.mjs';
import { cleanupSubmissions } from './cleanup-submissions.mjs';
import { stripJpegMetadata } from '../src/features/photos/jpeg.ts';

const api = localApi();
const users = [];
const jpeg = stripJpegMetadata(
  await readFile(new URL('../tests/fixtures/photo.jpg', import.meta.url)),
);
const claim = (id) =>
  `set local role authenticated; select set_config('request.jwt.claim.sub','${id}',true);`;
async function rpc(client, name, args) {
  const result = await client.rpc(name, args);
  assert.ifError(result.error);
  return result.data;
}
async function account() {
  const email = `inbox-${randomUUID()}@example.test`,
    password = `Local-${randomUUID()}!`;
  const made = await api.admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ifError(made.error);
  const id = made.data.user.id;
  users.push(id);
  const client = api.client();
  assert.ifError((await client.auth.signInWithPassword({ email, password })).error);
  const username = `in_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  await rpc(client, 'complete_onboarding', {
    p_username: username,
    p_reference_language_id: '00000000-0000-4000-8000-000000000001',
    p_target_language_id: '00000000-0000-4000-8000-000000000002',
    p_cefr_level: 'B1',
    p_timezone: 'UTC',
  });
  const profile = (await rpc(client, 'get_public_profile')).profile;
  return { id, client, username, publicId: profile.id };
}
const inbox = (actor, args = {}) => rpc(actor.client, 'get_notification_inbox', args);
const summary = (actor) => rpc(actor.client, 'get_notification_summary');
const follow = (actor, target, following = true) =>
  rpc(actor.client, 'set_follow', { profile_id: target.publicId, following });
const connections = (viewer, subject, kind, args = {}) =>
  rpc(viewer.client, 'get_profile_connections', {
    profile_id: subject.publicId,
    list_kind: kind,
    ...args,
  });
const mark = (actor, id, read = true) =>
  rpc(actor.client, 'set_notification_read', { notification_id: id, read });
const resolve = (actor, id) =>
  rpc(actor.client, 'resolve_notification_target', { notification_id: id });
async function unblock(actor) {
  const rows = await rpc(actor.client, 'get_blocked_users');
  for (const row of rows.items) await rpc(actor.client, 'unblock_user', { block_id: row.id });
}
async function photo(actor, slot = 0, visibility = 'public') {
  const challenge = await rpc(actor.client, 'get_or_create_today_challenge');
  const saved = await rpc(actor.client, 'reserve_submission', {
    assignment_id: challenge.words[slot].id,
  });
  assert.ifError(
    (
      await actor.client.storage
        .from('challenge-submissions')
        .upload(saved.storage_path, jpeg, { contentType: 'image/jpeg' })
    ).error,
  );
  const finalized = await actor.client.functions.invoke('photo-authority', {
    body: { action: 'finalize', submissionId: saved.id, visibility },
  });
  assert.ifError(finalized.error);
  return { ...saved, assignmentId: challenge.words[slot].id, challenge };
}
const kinds = (page, kind) => page.items.filter((row) => row.kind === kind);
const state = (post, visibility) => ({ submission_id: post.id, requested_visibility: visibility });

try {
  await execute(`notify pgrst, 'reload schema';`);
  const owner = await account(),
    a = await account(),
    b = await account(),
    other = await account();
  assert.deepEqual((await connections(owner, owner, 'followers')).items, []);
  assert.deepEqual((await connections(owner, owner, 'following')).items, []);
  assert.deepEqual((await inbox(owner)).items, []);
  assert.equal((await summary(owner)).unread_count, 0);
  assert(
    (await owner.client.rpc('set_follow', { profile_id: owner.publicId, following: true })).error,
  );
  assert.equal((await summary(owner)).unread_count, 0);

  const followed = await Promise.all(Array.from({ length: 6 }, () => follow(a, owner)));
  for (const receipt of followed) {
    assert.equal(receipt.ok, true);
    assert.equal(receipt.profile.follower_count, 1);
    assert.equal(receipt.profile.is_following, true);
  }
  let messages = await inbox(owner);
  assert.equal(kinds(messages, 'NEW_FOLLOWER').length, 1);
  const first = kinds(messages, 'NEW_FOLLOWER')[0];
  assert.equal(first.username, a.username);
  assert.equal(first.profile_id, a.publicId);
  assert.equal(first.read_at, null);
  assert.equal((await resolve(owner, first.id)).profile_id, a.publicId);
  const snapshot = messages.read_cursor;
  assert(snapshot);
  await follow(b, owner);
  await rpc(owner.client, 'mark_notifications_read', {
    through_time: snapshot.time,
    through_id: snapshot.id,
  });
  messages = await inbox(owner);
  assert.notEqual(messages.items.find((row) => row.id === first.id).read_at, null);
  assert.equal(messages.unread_count, 1, 'A new event after the read-all snapshot remains unread');
  await mark(owner, first.id, false);
  assert.equal((await summary(owner)).unread_count, 2);
  await Promise.all(Array.from({ length: 6 }, () => mark(owner, first.id)));
  assert.equal((await summary(owner)).unread_count, 1);
  assert(
    (await a.client.rpc('set_notification_read', { notification_id: first.id, read: true })).error,
  );
  assert((await a.client.rpc('resolve_notification_target', { notification_id: first.id })).error);
  assert.equal(kinds(await inbox(a), 'NEW_FOLLOWER').length, 0);
  console.log(
    'PASS: source retries deduplicate follower events; read/unread and snapshot-bounded read-all are recipient-only',
  );

  await follow(owner, b);
  const page1 = await connections(other, owner, 'followers', { page_size: 1 });
  assert.equal(page1.profile.follower_count, 2);
  assert.equal(page1.items.length, 1);
  assert.equal(page1.has_more, true);
  const last = page1.items[0];
  const page2 = await connections(other, owner, 'followers', {
    page_size: 1,
    before_time: last.followed_at,
    before_id: last.id,
  });
  assert.equal(page2.has_more, false);
  assert.deepEqual(
    new Set([...page1.items, ...page2.items].map((row) => row.id)),
    new Set([a.publicId, b.publicId]),
  );
  assert.deepEqual(
    (await connections(owner, owner, 'following')).items.map((row) => row.id),
    [b.publicId],
  );
  const ownRow = (await connections(a, owner, 'followers')).items.find(
    (row) => row.id === a.publicId,
  );
  assert.equal(ownRow.is_self, true);
  assert.equal(ownRow.is_following, false);
  for (const row of [...page1.items, ...page2.items]) {
    assert.deepEqual(Object.keys(row).sort(), [
      'avatar_id',
      'followed_at',
      'id',
      'is_following',
      'is_self',
      'username',
    ]);
    assert(![owner.id, a.id, b.id, other.id].includes(row.id));
  }
  const firstNoticePage = await inbox(owner, { page_size: 1 });
  const noticeCursor = firstNoticePage.items[0];
  const secondNoticePage = await inbox(owner, {
    page_size: 1,
    before_time: noticeCursor.created_at,
    before_id: noticeCursor.id,
  });
  assert.equal(firstNoticePage.has_more, true);
  assert.equal(secondNoticePage.has_more, false);
  assert.notEqual(noticeCursor.id, secondNoticePage.items[0].id);
  await follow(a, owner, false);
  assert.equal((await connections(owner, owner, 'followers')).items.length, 1);
  assert.equal(kinds(await inbox(owner), 'NEW_FOLLOWER').length, 1);
  await follow(a, owner);
  messages = await inbox(owner);
  assert.equal(kinds(messages, 'NEW_FOLLOWER').length, 2);
  assert.notEqual(
    messages.items.find((row) => row.id === first.id).read_at,
    null,
    'Refollow does not reset the original read state',
  );
  console.log(
    'PASS: public lists and inbox paginate without duplicates; list/count state and durable refollow dedup agree',
  );

  await rpc(owner.client, 'block_public_profile', { profile_id: a.publicId });
  assert.equal((await connections(owner, owner, 'followers')).items.length, 1);
  assert.equal(
    kinds(await inbox(owner), 'NEW_FOLLOWER').some((row) => row.id === first.id),
    false,
  );
  assert(
    (await owner.client.rpc('resolve_notification_target', { notification_id: first.id })).error,
  );
  assert(
    (
      await a.client.rpc('get_profile_connections', {
        profile_id: owner.publicId,
        list_kind: 'followers',
      })
    ).error,
  );
  assert.equal(
    (await connections(other, owner, 'followers')).items.length,
    1,
    'Owner blocks hide edges from other viewers too',
  );
  await unblock(owner);
  await rpc(other.client, 'block_public_profile', { profile_id: b.publicId });
  assert.equal(
    (await connections(other, owner, 'followers')).items.length,
    1,
    'Viewer blocks hide rows and counts',
  );
  assert.equal((await connections(other, owner, 'followers')).profile.follower_count, 1);
  await unblock(other);
  console.log('PASS: lists/counts/events/targets honor mutual blocks for viewer and profile owner');

  const post = await photo(owner);
  const ready = kinds(await inbox(owner), 'DAILY_WORDS_READY');
  assert.equal(ready.length, 1);
  assert.equal(ready[0].challenge_id, post.challenge.challenge.id);
  assert.equal((await resolve(owner, ready[0].id)).kind, 'DAILY_WORDS_READY');
  await Promise.all(
    Array.from({ length: 4 }, () => rpc(owner.client, 'get_or_create_today_challenge')),
  );
  await rpc(owner.client, 'replace_daily_challenge_word', {
    active_assignment_id: post.challenge.words[1].id,
  });
  assert.equal(kinds(await inbox(owner), 'DAILY_WORDS_READY').length, 1);
  assert.equal(
    await execute(`select count(*) from private.push_installations where user_id='${owner.id}';`),
    '0',
  );
  console.log(
    'PASS: three authoritative words create one daily inbox event without any push registration; retries/replacement do not create another',
  );

  const xpBefore = await execute(
    `select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]') from public.xp_events e where user_id='${owner.id}';`,
  );
  const vote = (actor, score) =>
    rpc(actor.client, 'rate_submission', { submission_id: post.id, score });
  await Promise.all(Array.from({ length: 6 }, () => vote(a, 4)));
  await vote(a, 5);
  await vote(a, 3);
  let ratings = kinds(await inbox(owner), 'NEW_RATING');
  assert.equal(ratings.length, 1);
  assert.equal(ratings[0].username, null);
  assert.equal(ratings[0].profile_id, null);
  assert.equal(ratings[0].submission_id, post.id);
  assert.equal(ratings[0].assignment_id, post.assignmentId);
  assert.equal((await resolve(owner, ratings[0].id)).assignment_id, post.assignmentId);
  const forbidden = [
    'actor_user_id',
    'rater_user_id',
    'score',
    'email',
    'storage_path',
    'signed_path',
    'signed_url',
    'source_key',
  ];
  for (const key of forbidden) assert.equal(key in ratings[0], false);
  assert((await owner.client.rpc('rate_submission', { submission_id: post.id, score: 5 })).error);
  assert.equal(kinds(await inbox(owner), 'NEW_RATING').length, 1);
  await rpc(owner.client, 'set_submission_visibility', state(post, 'private'));
  assert.equal(kinds(await inbox(owner), 'NEW_RATING').length, 0);
  assert(
    (await owner.client.rpc('resolve_notification_target', { notification_id: ratings[0].id }))
      .error,
  );
  assert((await b.client.rpc('rate_submission', { submission_id: post.id, score: 4 })).error);
  await rpc(owner.client, 'set_submission_visibility', state(post, 'public'));
  await rpc(owner.client, 'block_public_profile', { profile_id: a.publicId });
  assert.equal(kinds(await inbox(owner), 'NEW_RATING').length, 0);
  await unblock(owner);
  assert.equal(kinds(await inbox(owner), 'NEW_RATING').length, 1);
  console.log(
    'PASS: rating alerts are anonymous, first-vote-only and public/eligible-only; self-votes/private targets remain denied',
  );

  const privateWrite = query(
    `begin; ${claim(owner.id)} select public.set_submission_visibility('${post.id}','private');select 'AUDIT_LOCKED';select pg_sleep(0.5);commit;`,
  );
  assert.equal(await privateWrite.ready, true);
  const pendingVote = b.client.rpc('rate_submission', { submission_id: post.id, score: 4 });
  const [visibilityResult, deniedVote] = await Promise.all([privateWrite.result, pendingVote]);
  assert.equal(visibilityResult.code, 0, visibilityResult.error);
  assert.equal(deniedVote.error?.code, '42501');
  assert.equal(kinds(await inbox(owner), 'NEW_RATING').length, 0);
  await rpc(owner.client, 'set_submission_visibility', state(post, 'public'));
  await Promise.all([vote(b, 2), vote(a, 4), mark(owner, first.id, false)]);
  assert.equal(kinds(await inbox(owner), 'NEW_RATING').length, 2);
  console.log(
    'PASS: rating/privacy contention cannot insert an ineligible alert; concurrent inbox reads/writes retain one source event',
  );

  // Trusted local fixture state exercises current restriction/removal projections
  // without granting any client moderation privileges or rewriting prior migrations.
  await execute(`update private.safety_accounts set restricted=true where user_id='${a.id}';`);
  assert.equal(
    (await connections(owner, owner, 'followers')).items.some((row) => row.id === a.publicId),
    false,
  );
  assert.equal(kinds(await inbox(owner), 'NEW_RATING').length, 1);
  assert.equal(
    kinds(await inbox(owner), 'NEW_FOLLOWER').some((row) => row.profile_id === a.publicId),
    false,
  );
  await execute(`update private.safety_accounts set restricted=false where user_id='${a.id}';`);
  await execute(
    `update auth.users set banned_until=clock_timestamp()+interval '1 hour' where id='${a.id}';`,
  );
  assert.equal(
    (await connections(owner, owner, 'followers')).items.some((row) => row.id === a.publicId),
    false,
  );
  assert.equal(kinds(await inbox(owner), 'NEW_RATING').length, 1);
  assert((await a.client.rpc('get_notification_summary')).error);
  await execute(`update auth.users set banned_until=null where id='${a.id}';`);
  await execute(
    `insert into private.submission_moderation(submission_id,removed) values('${post.id}',true) on conflict(submission_id) do update set removed=true;`,
  );
  assert.equal(kinds(await inbox(owner), 'NEW_RATING').length, 0);
  await execute(
    `update private.submission_moderation set removed=false where submission_id='${post.id}';`,
  );
  await execute(`update private.safety_accounts set restricted=true where user_id='${owner.id}';`);
  assert.deepEqual(
    new Set((await inbox(owner)).items.map((row) => row.kind)),
    new Set(['DAILY_WORDS_READY']),
  );
  await execute(`update private.safety_accounts set restricted=false where user_id='${owner.id}';`);
  assert.equal(
    await execute(
      `select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]') from public.xp_events e where user_id='${owner.id}';`,
    ),
    xpBefore,
  );

  for (const actor of [owner, a, other]) {
    assert((await actor.client.from('in_app_notifications').select('*')).error);
    assert(
      (
        await actor.client
          .from('in_app_notifications')
          .insert({ user_id: owner.id, kind: 'NEW_FOLLOWER' })
      ).error,
    );
    assert(
      (
        await actor.client
          .from('in_app_notifications')
          .update({ read_at: new Date().toISOString() })
          .eq('id', first.id)
      ).error,
    );
    assert((await actor.client.from('in_app_notifications').delete().eq('id', first.id)).error);
  }
  assert((await api.client().rpc('get_notification_inbox')).error);
  assert(
    (
      await api
        .client()
        .rpc('get_profile_connections', { profile_id: owner.publicId, list_kind: 'followers' })
    ).error,
  );
  const deleting = await rpc(owner.client, 'begin_submission_deletion', { submission_id: post.id });
  assert.equal(deleting.status, 'deleting');
  assert.equal(kinds(await inbox(owner), 'NEW_RATING').length, 0);
  assert(
    (await owner.client.rpc('resolve_notification_target', { notification_id: ratings[0].id }))
      .error,
  );
  console.log(
    'PASS: moderation/deletion exclude related events; direct REST, anonymous and cross-user mutations are denied; XP remains unchanged',
  );

  const erased = await account();
  const erasure = query(`begin; select 1 from auth.users where id='${erased.id}' for update;
    select 'AUDIT_LOCKED';select pg_sleep(0.75);delete from auth.users where id='${erased.id}';commit;`);
  assert.equal(await erasure.ready, true);
  const racedChallenge = erased.client.rpc('get_or_create_today_challenge');
  const [erasedResult, challengeResult] = await Promise.all([erasure.result, racedChallenge]);
  assert.equal(erasedResult.code, 0, erasedResult.error);
  assert.notEqual(challengeResult.error?.code, '40P01');
  assert.equal(
    await execute(`select count(*) from public.in_app_notifications where user_id='${erased.id}';`),
    '0',
  );
  users.splice(users.indexOf(erased.id), 1);
  console.log(
    'PASS: daily-event generation cannot deadlock account erasure or leave orphan inbox records',
  );
} finally {
  for (const id of users.reverse())
    assert.ifError((await api.admin.auth.admin.deleteUser(id)).error);
  await cleanupSubmissions(api.admin);
}
