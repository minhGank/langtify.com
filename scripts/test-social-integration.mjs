// Real local Auth/PostgREST/Storage checks plus ordered SQL contention. No hosted
// project, service credentials, signed capabilities or fixture identities logged.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { localApi } from './lib/local-api.mjs';
import { execute, query } from './lib/local-db.mjs';
import { stripJpegMetadata } from '../src/features/photos/jpeg.ts';
import { cleanupSubmissions } from './cleanup-submissions.mjs';

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
  const email = `social-${randomUUID()}@example.test`;
  const password = `Local-${randomUUID()}!`;
  const made = await api.admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ifError(made.error);
  const id = made.data.user.id;
  users.push(id);
  const client = api.client();
  assert.ifError((await client.auth.signInWithPassword({ email, password })).error);
  const username = `soc_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  await rpc(client, 'complete_onboarding', {
    p_username: username,
    p_reference_language_id: '00000000-0000-4000-8000-000000000001',
    p_target_language_id: '00000000-0000-4000-8000-000000000002',
    p_cefr_level: 'B1',
    p_timezone: 'UTC',
  });
  const profile = (await rpc(client, 'get_public_profile')).profile;
  assert.notEqual(profile.id, id);
  return { client, id, publicId: profile.id, username };
}
async function photo(owner, slot = 0, visibility = 'public') {
  const challenge = await rpc(owner.client, 'get_or_create_today_challenge');
  const row = await rpc(owner.client, 'reserve_submission', {
    assignment_id: challenge.words[slot].id,
  });
  assert.ifError(
    (
      await owner.client.storage
        .from('challenge-submissions')
        .upload(row.storage_path, jpeg, { contentType: 'image/jpeg' })
    ).error,
  );
  const result = await owner.client.functions.invoke('photo-authority', {
    body: { action: 'finalize', submissionId: row.id, visibility },
  });
  assert.ifError(result.error);
  return row;
}
const comments = (client, id, args = {}) =>
  rpc(client, 'get_submission_comments', { submission_id: id, ...args });
const create = (client, id, body, requestId = randomUUID()) =>
  rpc(client, 'create_submission_comment', { submission_id: id, body, request_id: requestId });
const follow = (client, profileId, following = true) =>
  rpc(client, 'set_follow', { profile_id: profileId, following });

try {
  await execute(`notify pgrst, 'reload schema';`);
  const owner = await account();
  const author = await account();
  const viewer = await account();
  const moderator = await account();
  await execute(`insert into private.moderators(user_id) values('${moderator.id}');`);
  const post = await photo(owner);
  const otherPublicPost = await photo(owner, 1);
  const privatePost = await photo(owner, 2, 'private');
  const publicProfilePosts = (client, cursor = {}) =>
    rpc(client, 'get_public_profile_submissions', {
      profile_id: owner.publicId,
      page_size: 1,
      ...cursor,
    });
  for (const actor of [owner, viewer]) {
    const first = await publicProfilePosts(actor.client);
    assert.equal(first.profile_id, owner.publicId);
    assert.equal(first.has_more, true);
    assert.equal(first.items.length, 1);
    assert.equal(first.items[0].can_rate, actor !== owner);
    const second = await publicProfilePosts(actor.client, {
      before_time: first.items[0].submitted_at,
      before_id: first.items[0].id,
    });
    assert.equal(second.has_more, false);
    assert.deepEqual(
      new Set([...first.items, ...second.items].map((item) => item.id)),
      new Set([post.id, otherPublicPost.id]),
    );
  }
  const signProfilePosts = (client) =>
    client.functions.invoke('photo-authority', {
      body: {
        action: 'feed-previews',
        targetLanguageId: '00000000-0000-4000-8000-000000000002',
        submissionIds: [post.id, otherPublicPost.id, privatePost.id],
      },
    });
  const signedProfilePosts = await signProfilePosts(viewer.client);
  assert.ifError(signedProfilePosts.error);
  assert.equal(signedProfilePosts.data.items.length, 2);
  assert.equal(
    signedProfilePosts.data.items.some((item) => item.id === privatePost.id),
    false,
  );
  const image = await fetch(api.url + signedProfilePosts.data.items[0].signed_path);
  assert.equal(image.status, 200);
  await image.arrayBuffer();
  console.log(
    'PASS: own and other public profiles paginate only their public photos through existing controlled signing',
  );
  const xpBefore = await execute(
    `select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]') from public.xp_events e where user_id='${owner.id}';`,
  );

  const requested = randomUUID();
  const created = await Promise.all(
    Array.from({ length: 6 }, () => create(author.client, post.id, 'Same intent', requested)),
  );
  assert.equal(new Set(created.map((item) => item.comment_id)).size, 1);
  assert.equal((await comments(viewer.client, post.id)).items.length, 1);
  const commentId = created[0].comment_id;
  await Promise.all([
    rpc(author.client, 'delete_submission_comment', { comment_id: commentId }),
    create(author.client, post.id, 'Same intent', requested),
    create(author.client, post.id, 'Same intent', requested),
  ]);
  assert.equal((await comments(viewer.client, post.id)).items.length, 0);
  assert.equal(
    await execute(
      `select count(*) from public.submission_comments where author_user_id='${author.id}' and request_id='${requested}';`,
    ),
    '1',
  );
  console.log('PASS: concurrent comment retries create one row; deletion cannot be resurrected');

  await Promise.all(Array.from({ length: 6 }, () => follow(author.client, owner.publicId)));
  assert.equal(
    (await rpc(author.client, 'get_public_profile', { profile_id: owner.publicId })).profile
      .follower_count,
    1,
  );
  const block = query(`begin; ${claim(owner.id)}
    select public.block_public_profile('${author.publicId}');
    select 'AUDIT_LOCKED';select pg_sleep(0.5);commit;`);
  assert.equal(await block.ready, true);
  const deniedFollow = author.client.rpc('set_follow', {
    profile_id: owner.publicId,
    following: true,
  });
  const deniedComment = author.client.rpc('create_submission_comment', {
    submission_id: post.id,
    body: 'Blocked race',
    request_id: randomUUID(),
  });
  const [blockResult, followResult, commentResult] = await Promise.all([
    block.result,
    deniedFollow,
    deniedComment,
  ]);
  assert.equal(blockResult.code, 0, blockResult.error);
  assert.equal(followResult.error?.code, '42501');
  assert.equal(commentResult.error?.code, '42501');
  assert.equal((await rpc(owner.client, 'get_public_profile')).profile.follower_count, 0);
  assert.equal(
    (await author.client.rpc('get_public_profile_submissions', { profile_id: owner.publicId }))
      .error?.code,
    '42501',
  );
  const blockedPhotos = await signProfilePosts(author.client);
  assert.ifError(blockedPhotos.error);
  assert.equal(blockedPhotos.data.items.length, 0);
  assert.equal(
    (await rpc(viewer.client, 'get_public_profile', { profile_id: owner.publicId })).profile
      .follower_count,
    0,
  );
  const blocks = await rpc(owner.client, 'get_blocked_users');
  await rpc(owner.client, 'unblock_user', { block_id: blocks.items[0].id });
  assert.equal((await rpc(owner.client, 'get_public_profile')).profile.follower_count, 1);
  console.log(
    'PASS: concurrent follow/block/comment admission serializes; hidden graph counts agree',
  );

  const privateWrite = query(`begin; ${claim(owner.id)}
    select public.set_submission_visibility('${post.id}','private');
    select 'AUDIT_LOCKED';select pg_sleep(0.5);commit;`);
  assert.equal(await privateWrite.ready, true);
  const late = author.client.rpc('create_submission_comment', {
    submission_id: post.id,
    body: 'Must be rejected',
    request_id: randomUUID(),
  });
  const [privateResult, lateResult] = await Promise.all([privateWrite.result, late]);
  assert.equal(privateResult.code, 0, privateResult.error);
  assert.equal(lateResult.error?.code, '42501');
  const nowPrivate = await rpc(viewer.client, 'get_public_profile_submissions', {
    profile_id: owner.publicId,
  });
  assert.deepEqual(
    nowPrivate.items.map((item) => item.id),
    [otherPublicPost.id],
  );
  assert.equal(
    (await viewer.client.rpc('get_submission_comments', { submission_id: post.id })).error?.code,
    '42501',
  );
  await rpc(owner.client, 'set_submission_visibility', {
    submission_id: post.id,
    requested_visibility: 'public',
  });
  console.log('PASS: privacy commit fences concurrent comment writes and later reads');

  const visible = await create(author.client, post.id, 'A reportable example');
  await Promise.all([
    rpc(viewer.client, 'report_submission_comment', {
      comment_id: visible.comment_id,
      reason: 'spam',
    }),
    rpc(viewer.client, 'report_submission_comment', {
      comment_id: visible.comment_id,
      reason: 'spam',
    }),
  ]);
  const reports = await rpc(moderator.client, 'get_moderation_queue');
  const report = reports.items.find((item) => item.username_snapshot === author.username);
  assert(report);
  const intent = randomUUID();
  await Promise.all(
    Array.from({ length: 3 }, () =>
      rpc(moderator.client, 'moderate_report', {
        report_id: report.id,
        action: 'remove_comment',
        request_id: intent,
      }),
    ),
  );
  assert.equal((await comments(viewer.client, post.id)).items.length, 0);
  assert.equal(
    (await rpc(moderator.client, 'get_moderation_history', { report_id: report.id })).items.length,
    1,
  );
  const detail = await rpc(moderator.client, 'get_moderation_report', { report_id: report.id });
  assert.equal(detail.report.comment_snapshot, 'A reportable example');
  assert.equal('reporter_user_id' in detail.report, false);
  const inspected = await moderator.client.functions.invoke('photo-authority', {
    body: { action: 'moderation-preview', reportId: report.id },
  });
  assert.ifError(inspected.error);
  assert.equal(inspected.data.photo, null);
  console.log(
    'PASS: report/removal retries have one audit and no unrelated private-photo capability',
  );

  // Lock contention involving three different users exercises sorted admission
  // against rating/publication/report changes rather than merely testing a PK.
  await Promise.all([
    create(author.client, post.id, 'Parallel discussion'),
    rpc(viewer.client, 'rate_submission', { submission_id: post.id, score: 4 }),
    rpc(owner.client, 'set_submission_visibility', {
      submission_id: post.id,
      requested_visibility: 'public',
    }),
    rpc(moderator.client, 'moderate_report', {
      report_id: report.id,
      action: 'resolve_report',
      request_id: randomUUID(),
    }),
  ]);
  assert.equal((await comments(viewer.client, post.id)).items.length, 1);
  console.log('PASS: comment/rating/publication/moderation contention completes without deadlock');

  for (const table of ['submission_comments', 'user_follows', 'safety_reports']) {
    assert((await viewer.client.from(table).select('*')).error);
  }
  assert(
    (
      await viewer.client.from('submission_comments').insert({
        submission_id: post.id,
        author_user_id: author.id,
        request_id: randomUUID(),
        body: 'Spoofed author',
      })
    ).error,
  );
  assert(
    (
      await viewer.client.from('user_follows').insert({
        follower_user_id: author.id,
        followed_user_id: owner.id,
      })
    ).error,
  );
  assert.equal(
    await execute(
      `select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]') from public.xp_events e where user_id='${owner.id}';`,
    ),
    xpBefore,
  );
  console.log('PASS: direct REST social writes/raw reads denied; social changes preserve XP');

  const contestedName = `same_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const names = await Promise.all([
    author.client.rpc('update_my_profile', { username: contestedName }),
    viewer.client.rpc('update_my_profile', { username: contestedName.toUpperCase() }),
  ]);
  assert.equal(names.filter((result) => result.error === null).length, 1);
  assert.equal(names.filter((result) => result.error?.code === '23505').length, 1);
  assert.equal(
    (await rpc(owner.client, 'search_public_profiles', { prefix: contestedName })).items.length,
    1,
  );
  console.log('PASS: concurrent case-insensitive username claims have exactly one winner');
  for (const action of ['follow', 'comment', 'legacy-block', 'moderation']) {
    const erased = await account();
    if (action === 'moderation')
      await execute(`insert into private.moderators(user_id) values('${erased.id}');`);
    const deletion = query(`begin;
      select 1 from auth.users where id='${erased.id}' for update;
      select 'AUDIT_LOCKED';select pg_sleep(1);
      delete from auth.users where id='${erased.id}';commit;`);
    assert.equal(await deletion.ready, true);
    const pending =
      action === 'follow'
        ? erased.client.rpc('set_follow', { profile_id: owner.publicId, following: true })
        : action === 'comment'
          ? erased.client.rpc('create_submission_comment', {
              submission_id: post.id,
              body: 'Must not survive erasure',
              request_id: randomUUID(),
            })
          : action === 'legacy-block'
            ? erased.client.rpc('block_submission_user', { submission_id: post.id })
            : erased.client.rpc('moderate_report', {
                report_id: report.id,
                action: 'resolve_report',
                request_id: randomUUID(),
              });
    const [deleted, response] = await Promise.all([deletion.result, pending]);
    assert.equal(deleted.code, 0, deleted.error);
    users.splice(users.indexOf(erased.id), 1);
    assert.equal(response.error?.code, '42501', `${action} must reject the erased Auth actor`);
  }
  console.log(
    'PASS: Auth erasure serializes before follow/comment/legacy-block/moderation admission without deadlocks',
  );
} finally {
  // Remove only this local suite's immutable fixtures with trusted SQL. There is
  // no corresponding production API for deleting durable moderation history.
  if (users.length)
    await execute(`begin; alter table public.moderation_audit disable trigger immutable_moderation_audit;
      delete from public.moderation_audit where moderator_user_id in (${users.map((id) => `'${id}'`).join(',')});
      delete from public.safety_reports where reporter_user_id in (${users.map((id) => `'${id}'`).join(',')});
      alter table public.moderation_audit enable trigger immutable_moderation_audit;commit;`);
  for (const id of users.reverse()) {
    const result = await api.admin.auth.admin.deleteUser(id);
    assert.ifError(result.error);
  }
  await cleanupSubmissions(api.admin);
}
