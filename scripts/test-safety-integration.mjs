import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
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
  const email = `safety-${randomUUID()}@example.test`,
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
const claim = (id) =>
  `set local role authenticated; select set_config('request.jwt.claim.sub','${id}',true);`;
async function rate(client, id) {
  return rpc(client, 'rate_submission', { submission_id: id, score: 4 });
}
async function report(client, id, kind = 'submission') {
  return rpc(client, 'report_public_content', {
    submission_id: id,
    target_kind: kind,
    reason: 'privacy',
    details: 'Please review',
  });
}
async function moderate(client, id, action, requestId = randomUUID()) {
  return rpc(client, 'moderate_report', {
    report_id: id,
    action,
    request_id: requestId,
    reason: 'Local safety verification',
  });
}
async function preview(client, reportId, extras = {}) {
  return client.functions.invoke('photo-authority', {
    body: { action: 'moderation-preview', reportId, ...extras },
  });
}
async function denied(request) {
  assert((await request).error, 'Expected backend denial');
}
try {
  const a = await account(),
    b = await account(),
    mod = await account();
  const ac = await rpc(a.client, 'get_or_create_today_challenge'),
    bc = await rpc(b.client, 'get_or_create_today_challenge');
  const ap = await photo(a.client, ac.words[0].id),
    bp = await photo(b.client, bc.words[0].id);
  await visibility(a.client, ap.id, 'public');
  await visibility(b.client, bp.id, 'public');
  const ledger = await execute(
    'select jsonb_agg(to_jsonb(e) order by id) from public.xp_events e;',
  );
  await Promise.all(Array.from({ length: 8 }, () => report(b.client, ap.id)));
  await report(b.client, ap.id, 'user');
  assert.equal(await execute('select count(*) from public.safety_reports;'), '2');
  for (const table of ['safety_reports', 'user_blocks', 'moderation_audit']) {
    await denied(a.client.from(table).select('*'));
    await denied(b.client.from(table).insert({ reporter_user_id: a.id }));
    await denied(b.client.from(table).update({ status: 'resolved' }).neq('id', randomUUID()));
    await denied(b.client.from(table).delete().neq('id', randomUUID()));
  }
  await denied(
    b.client.rpc('report_public_content', {
      submission_id: ap.id,
      target_kind: 'submission',
      reason: 'other',
      reporter_user_id: a.id,
    }),
  );
  await denied(
    b.client.rpc('report_public_content', {
      submission_id: ap.id,
      target_kind: 'submission',
      reason: 'invented',
    }),
  );
  await denied(
    b.client.rpc('report_public_content', {
      submission_id: ap.id,
      target_kind: 'submission',
      reason: 'other',
      details: 'x'.repeat(501),
    }),
  );
  await denied(a.client.rpc('block_submission_user', { submission_id: ap.id }));
  await denied(
    a.client.rpc('report_public_content', {
      submission_id: ap.id,
      target_kind: 'user',
      reason: 'other',
    }),
  );
  await denied(api.client().rpc('get_moderation_queue'));
  await denied(b.client.rpc('get_moderation_queue'));
  await b.client.auth.updateUser({ data: { is_admin: true, moderator: true } });
  assert.equal((await rpc(b.client, 'get_safety_access')).moderator, false);
  await denied(b.client.rpc('get_moderation_queue'));
  console.log(
    'PASS: concurrent reports create one open case; Auth-derived identity, bounded reasons/details, self/anonymous denial and raw REST privacy hold',
  );

  await execute(`insert into private.moderators(user_id) values('${mod.id}');`);
  const cases = await rpc(mod.client, 'get_moderation_queue');
  assert.equal(cases.items.length, 2);
  const submissionCase = cases.items.find((r) => r.target_kind === 'submission').id;
  const userCase = cases.items.find((r) => r.target_kind === 'user').id;
  const detail = await rpc(mod.client, 'get_moderation_report', { report_id: submissionCase });
  assert(!('reporter_user_id' in detail.report));
  assert(!JSON.stringify(cases).includes(b.id));
  await denied(preview(b.client, submissionCase));
  await denied(
    b.client.rpc('get_moderation_photo_target', { viewer: mod.id, report_id: submissionCase }),
  );
  const viewed = await preview(mod.client, submissionCase, {
    ttl: 31536000,
    path: bp.storage_path,
    viewer: b.id,
  });
  assert.ifError(viewed.error);
  assert.equal(viewed.data.photo.id, ap.id);
  const capability = new URL(viewed.data.photo.signed_path, api.url);
  const claims = JSON.parse(
    Buffer.from(capability.searchParams.get('token').split('.')[1], 'base64url').toString(),
  );
  assert.equal(claims.exp - claims.iat, 60);
  assert.equal((await fetch(capability)).status, 200);
  await visibility(b.client, bp.id, 'private');
  const unreported = await preview(mod.client, bp.id, { path: bp.storage_path });
  assert.ifError(unreported.error);
  assert.equal(unreported.data.photo, null);
  assert.equal((await ownerPreviews(mod.client, [bp.id]))[0].signedPath, null);
  await denied(mod.client.storage.from(bucket).createSignedUrl(bp.storage_path, 60));
  await visibility(b.client, bp.id, 'public');
  console.log(
    'PASS: only backend-provisioned moderators read cases and report-scoped verified photos; spoofed role/path/viewer/TTL inputs grant no authority',
  );

  await rate(b.client, ap.id);
  await Promise.all(
    Array.from({ length: 8 }, () =>
      rpc(b.client, 'block_submission_user', { submission_id: ap.id }),
    ),
  );
  let blocks = await rpc(b.client, 'get_blocked_users');
  assert.equal(blocks.items.length, 1);
  assert.deepEqual(Object.keys(blocks.items[0]).sort(), ['id', 'username']);
  assert(!(await feed(a.client)).items.some((r) => r.id === bp.id));
  assert(!(await feed(b.client)).items.some((r) => r.id === ap.id));
  assert.equal((await signs(b.client, [ap.id])).items.length, 0);
  assert.equal((await signs(a.client, [bp.id])).items.length, 0);
  await denied(a.client.rpc('rate_submission', { submission_id: bp.id, score: 5 }));
  await denied(b.client.rpc('rate_submission', { submission_id: ap.id, score: 5 }));
  await rpc(a.client, 'unblock_user', { block_id: blocks.items[0].id });
  assert.equal((await rpc(b.client, 'get_blocked_users')).items.length, 1);
  assert((await ownerPreviews(a.client, [ap.id]))[0].signedPath);
  assert.equal((await rpc(a.client, 'get_my_vocabulary')).total_concepts, 1);
  const oldBlock = blocks.items[0].id;
  const unblocking = query(
    `begin; ${claim(b.id)} select public.unblock_user('${oldBlock}'); select 'AUDIT_LOCKED'; select pg_sleep(1); commit;`,
  );
  assert.equal(await unblocking.ready, true);
  const reblock = rpc(b.client, 'block_submission_user', { submission_id: ap.id });
  assert.equal((await unblocking.result).code, 0);
  await reblock;
  blocks = await rpc(b.client, 'get_blocked_users');
  assert.equal(blocks.items.length, 1);
  assert.notEqual(blocks.items[0].id, oldBlock);
  await rpc(b.client, 'unblock_user', { block_id: oldBlock });
  assert.equal((await rpc(b.client, 'get_blocked_users')).items.length, 1);
  await rpc(b.client, 'unblock_user', { block_id: blocks.items[0].id });
  assert((await feed(b.client)).items.some((r) => r.id === ap.id));
  console.log(
    'PASS: mutual block excludes feed/signing/rating while private learning survives; concurrent unblock/reblock and stale block IDs preserve the final relationship',
  );

  const blockFirst = query(
    `begin; ${claim(b.id)} select public.block_submission_user('${ap.id}'); select 'AUDIT_LOCKED'; select pg_sleep(1); commit;`,
  );
  assert.equal(await blockFirst.ready, true);
  const waitingVote = a.client.rpc('rate_submission', { submission_id: bp.id, score: 5 });
  const [blockResult, voteResult] = await Promise.all([blockFirst.result, waitingVote]);
  assert.equal(blockResult.code, 0);
  assert(voteResult.error);
  blocks = await rpc(b.client, 'get_blocked_users');
  await rpc(b.client, 'unblock_user', { block_id: blocks.items[0].id });
  const voteFirst = query(
    `begin; ${claim(b.id)} select public.rate_submission('${ap.id}',3); select 'AUDIT_LOCKED'; select pg_sleep(1); commit;`,
  );
  assert.equal(await voteFirst.ready, true);
  const blockAfter = rpc(b.client, 'block_submission_user', { submission_id: ap.id });
  assert.equal((await voteFirst.result).code, 0);
  await blockAfter;
  assert.equal(
    await execute(`select count(*) from public.submission_ratings where submission_id='${ap.id}';`),
    '1',
  );
  blocks = await rpc(b.client, 'get_blocked_users');
  await rpc(b.client, 'unblock_user', { block_id: blocks.items[0].id });
  console.log(
    'PASS: rating and blocking serialize in both transaction orders without duplicate or post-block votes',
  );

  const removed = query(
    `begin; ${claim(mod.id)} select public.moderate_report('${submissionCase}','remove_submission','${randomUUID()}'); select 'AUDIT_LOCKED'; select pg_sleep(1); commit;`,
  );
  assert.equal(await removed.ready, true);
  const republish = visibility(a.client, ap.id, 'public');
  const lateVote = b.client.rpc('rate_submission', { submission_id: ap.id, score: 5 });
  const [removeResult, , rejected] = await Promise.all([removed.result, republish, lateVote]);
  assert.equal(removeResult.code, 0);
  assert(rejected.error);
  assert(!(await feed(b.client)).items.some((r) => r.id === ap.id));
  assert.equal((await signs(b.client, [ap.id])).items.length, 0);
  await visibility(a.client, ap.id, 'private');
  assert((await preview(mod.client, submissionCase)).data.photo);
  await moderate(mod.client, submissionCase, 'restore_submission');
  assert(!(await feed(b.client)).items.some((r) => r.id === ap.id));
  await visibility(a.client, ap.id, 'public');
  assert((await feed(b.client)).items.some((r) => r.id === ap.id));
  console.log(
    'PASS: removal wins against publication/rating; moderator private-case review works and restoration preserves owner visibility',
  );

  const suspension = query(
    `begin; ${claim(mod.id)} select public.moderate_report('${userCase}','suspend_user','${randomUUID()}'); select 'AUDIT_LOCKED'; select pg_sleep(1); commit;`,
  );
  assert.equal(await suspension.ready, true);
  const publishDuring = a.client.rpc('set_submission_visibility', {
    submission_id: ap.id,
    requested_visibility: 'public',
  });
  const [suspended, publication] = await Promise.all([suspension.result, publishDuring]);
  assert.equal(suspended.code, 0);
  assert(publication.error);
  await denied(a.client.rpc('get_discover_feed'));
  await denied(a.client.rpc('rate_submission', { submission_id: bp.id, score: 5 }));
  await denied(b.client.rpc('rate_submission', { submission_id: ap.id, score: 5 }));
  await denied(
    a.client.rpc('report_public_content', {
      submission_id: bp.id,
      target_kind: 'user',
      reason: 'other',
    }),
  );
  await denied(signsRaw(a.client, [bp.id]));
  assert.equal((await rpc(a.client, 'get_my_vocabulary')).total_concepts, 1);
  assert((await ownerPreviews(a.client, [ap.id]))[0].signedPath);
  await moderate(mod.client, userCase, 'restore_user');
  const requestId = randomUUID();
  await Promise.all(
    Array.from({ length: 6 }, () =>
      moderate(mod.client, submissionCase, 'remove_submission', requestId),
    ),
  );
  assert.equal(
    await execute(`select count(*) from public.moderation_audit where request_id='${requestId}';`),
    '1',
  );
  await moderate(mod.client, submissionCase, 'restore_submission');
  await moderate(mod.client, submissionCase, 'remove_submission', requestId);
  assert((await feed(b.client)).items.some((r) => r.id === ap.id));
  assert.equal(
    await execute('select jsonb_agg(to_jsonb(e) order by id) from public.xp_events e;'),
    ledger,
  );
  await moderate(mod.client, submissionCase, 'resolve_report');
  await moderate(mod.client, userCase, 'dismiss_report');
  assert.equal((await rpc(mod.client, 'get_moderation_queue')).items.length, 0);
  assert.equal(
    (await rpc(mod.client, 'get_moderation_queue', { report_status: 'resolved' })).items.length,
    1,
  );
  assert.equal(
    (await rpc(mod.client, 'get_moderation_queue', { report_status: 'dismissed' })).items.length,
    1,
  );
  console.log(
    'PASS: suspension overrides active JWT publication/rating/signing; restore, concurrent audit idempotency and resolution preserve XP exactly',
  );

  const stale = query(
    `begin isolation level repeatable read; ${claim(b.id)} select public.get_discover_feed(); select 'AUDIT_LOCKED'; select pg_sleep(1); select public.rate_submission('${ap.id}',2); commit;`,
  );
  assert.equal(await stale.ready, true);
  await moderate(mod.client, submissionCase, 'remove_submission');
  const staleResult = await stale.result;
  assert.notEqual(staleResult.code, 0);
  assert.match(staleResult.error, /40001/);
  await moderate(mod.client, submissionCase, 'restore_submission');
  const [overlappingSigns] = await Promise.all([
    signs(b.client, [ap.id]),
    moderate(mod.client, submissionCase, 'remove_submission'),
  ]);
  assert(overlappingSigns.items.length <= 1);
  if (overlappingSigns.items.length) assert.equal(overlappingSigns.items[0].id, ap.id);
  assert.equal((await signs(b.client, [ap.id])).items.length, 0);
  console.log(
    'PASS: concurrent signing/removal respects eligible read snapshots and every later renewal excludes the removed photo',
  );
  await execute(`delete from private.moderators where user_id='${mod.id}';`);
  await denied(mod.client.rpc('get_moderation_queue'));
  await denied(preview(mod.client, submissionCase));
  console.log(
    'PASS: stale snapshots cannot bypass moderation and operational role revocation denies an existing moderator session',
  );
  // Revocation must serialize with admission, not merely be checked before a wait.
  await execute(`insert into private.moderators(user_id) values('${mod.id}');`);
  const admittedId = randomUUID();
  const admitted = query(
    `begin; ${claim(mod.id)} select public.moderate_report('${submissionCase}','restore_submission','${admittedId}'); select 'AUDIT_LOCKED'; select pg_sleep(1); commit;`,
  );
  assert.equal(await admitted.ready, true);
  const revokeAfter = execute(`delete from private.moderators where user_id='${mod.id}';`);
  assert.equal((await admitted.result).code, 0);
  await revokeAfter;
  await denied(
    mod.client.rpc('moderate_report', {
      report_id: submissionCase,
      action: 'remove_submission',
      request_id: randomUUID(),
    }),
  );
  assert.equal(
    await execute(`select count(*) from public.moderation_audit where request_id='${admittedId}';`),
    '1',
  );
  await execute(`insert into private.moderators(user_id) values('${mod.id}');`);
  const revokedFirst = query(
    `begin; delete from private.moderators where user_id='${mod.id}'; select 'AUDIT_LOCKED'; select pg_sleep(1); commit;`,
  );
  assert.equal(await revokedFirst.ready, true);
  const refusedId = randomUUID();
  const waitingAction = mod.client.rpc('moderate_report', {
    report_id: submissionCase,
    action: 'remove_submission',
    request_id: refusedId,
  });
  const [revokedResult, refusedAction] = await Promise.all([revokedFirst.result, waitingAction]);
  assert.equal(revokedResult.code, 0);
  assert.equal(refusedAction.error?.code, '42501');
  assert.equal(
    await execute(`select count(*) from public.moderation_audit where request_id='${refusedId}';`),
    '0',
  );
  await execute(`insert into private.moderators(user_id) values('${mod.id}');`);
  console.log(
    'PASS: role revocation and moderator admission serialize in both orders; denied writes leave no audit or state mutation',
  );

  for (let round = 0; round < 3; round++) {
    const outcomes = await Promise.all([
      a.client.rpc('rate_submission', { submission_id: bp.id, score: 3 }),
      b.client.rpc('rate_submission', { submission_id: ap.id, score: 4 }),
      mod.client.rpc('moderate_report', {
        report_id: submissionCase,
        action: 'remove_submission',
        request_id: randomUUID(),
      }),
      a.client.rpc('set_submission_visibility', {
        submission_id: ap.id,
        requested_visibility: 'public',
      }),
    ]);
    for (const outcome of outcomes) {
      if (outcome.error) assert.equal(outcome.error.code, '42501');
    }
    assert(!(await feed(b.client)).items.some((r) => r.id === ap.id));
    await moderate(mod.client, submissionCase, 'restore_submission');
  }
  assert.equal(
    await execute('select jsonb_agg(to_jsonb(e) order by id) from public.xp_events e;'),
    ledger,
  );
  console.log(
    'PASS: reciprocal ratings, moderation and publication complete without deadlocks or learning-history changes',
  );

  console.log('Waiting for actual moderator preview expiry.');
  await new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, claims.exp * 1000 - Date.now() + 1200)),
  );
  assert.notEqual((await fetch(capability)).status, 200);
  console.log(
    'PASS: moderator photo capability expires on the Storage server at its fixed lifetime',
  );

  const deleting = query(
    `begin; ${claim(a.id)} select public.begin_submission_deletion('${ap.id}'); select 'AUDIT_LOCKED'; select pg_sleep(1); commit;`,
  );
  assert.equal(await deleting.ready, true);
  const deletionRaceId = randomUUID();
  const restoreDuringDelete = mod.client.rpc('moderate_report', {
    report_id: submissionCase,
    action: 'restore_submission',
    request_id: deletionRaceId,
  });
  const [deleteResult, deniedRestore] = await Promise.all([deleting.result, restoreDuringDelete]);
  assert.equal(deleteResult.code, 0);
  assert.equal(deniedRestore.error?.code, '42501');
  assert.equal((await preview(mod.client, submissionCase)).data.photo, null);
  assert.equal(
    await execute(
      `select count(*) from public.moderation_audit where request_id='${deletionRaceId}';`,
    ),
    '0',
  );
  // Deletion intent alone must not change XP; retirement retains existing reversal authority.
  assert.equal(
    await execute('select jsonb_agg(to_jsonb(e) order by id) from public.xp_events e;'),
    ledger,
  );
  assert.ifError((await a.client.storage.from(bucket).remove([ap.storage_path])).error);
  await rpc(a.client, 'finish_submission_deletion', { submission_id: ap.id });
  assert.equal((await preview(mod.client, submissionCase)).data.photo, null);
  assert.equal((await signs(b.client, [ap.id])).items.length, 0);
  assert.equal((await rpc(a.client, 'get_my_progress')).total_xp, 0);
  console.log(
    'PASS: owner deletion wins against moderator restoration, removes preview eligibility and alone reconciles completion/XP',
  );

  const pending = await rpc(a.client, 'reserve_submission', { assignment_id: ac.words[1].id });
  assert.ifError(
    (
      await a.client.storage
        .from(bucket)
        .upload(pending.storage_path, jpeg, { contentType: 'image/jpeg' })
    ).error,
  );
  await moderate(mod.client, userCase, 'suspend_user');
  await denied(
    a.client.functions.invoke('photo-authority', {
      body: { action: 'finalize', submissionId: pending.id, visibility: 'public' },
    }),
  );
  assert.equal((await rpc(a.client, 'get_my_progress')).total_xp, 0);
  assert.equal(
    await execute(`select status from public.submissions where id='${pending.id}';`),
    'pending',
  );
  const privateFinish = await a.client.functions.invoke('photo-authority', {
    body: { action: 'finalize', submissionId: pending.id, visibility: 'private' },
  });
  assert.ifError(privateFinish.error);
  assert.equal(privateFinish.data.submission.visibility, 'private');
  assert.equal((await rpc(a.client, 'get_my_progress')).total_xp, 10);
  await moderate(mod.client, userCase, 'restore_user');
  assert.equal((await rpc(a.client, 'get_my_progress')).total_xp, 10);
  console.log(
    'PASS: restricted active sessions cannot publicly finalize; private finalization remains valid and restoration never awards XP',
  );
  const historyBeforeDeletion = await execute(
    `select jsonb_agg(to_jsonb(e) order by id) from public.moderation_audit e;`,
  );
  const reportsBeforeDeletion = await execute(
    `select jsonb_agg(to_jsonb(r) order by id) from public.safety_reports r;`,
  );
  await execute(`delete from auth.users where id='${a.id}';`);
  assert.equal(
    await execute(`select jsonb_agg(to_jsonb(e) order by id) from public.moderation_audit e;`),
    historyBeforeDeletion,
  );
  assert.equal(
    await execute(`select jsonb_agg(to_jsonb(r) order by id) from public.safety_reports r;`),
    reportsBeforeDeletion,
  );
  assert.equal(
    (await rpc(mod.client, 'get_moderation_report', { report_id: userCase })).user_exists,
    false,
  );
  assert.equal((await preview(mod.client, submissionCase)).data.photo, null);
  await moderate(mod.client, userCase, 'resolve_report');
  console.log(
    'PASS: hard target deletion preserves every report/audit snapshot and permits case resolution without stale photo access',
  );
} finally {
  // These are this suite's durable case/audit fixtures only. Delete immutable
  // audit fixtures with a local admin transaction; production has no delete API.
  if (users.length)
    await execute(`begin; alter table public.moderation_audit disable trigger immutable_moderation_audit;
    delete from public.moderation_audit where moderator_user_id in (${users.map((id) => `'${id}'`).join(',')});
    delete from public.safety_reports where reporter_user_id in (${users.map((id) => `'${id}'`).join(',')});
    alter table public.moderation_audit enable trigger immutable_moderation_audit; commit;`);
  for (const id of users) await execute(`delete from auth.users where id='${id}';`);
  await cleanupSubmissions(api.admin);
}
function signsRaw(client, ids) {
  return client.functions.invoke('photo-authority', {
    body: { action: 'feed-previews', submissionIds: ids, targetLanguageId: target },
  });
}
