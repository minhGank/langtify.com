// Real local Auth/Postgres with an instrumented loopback provider. Never sends
// developer/test-user tokens to Expo and never supports a production endpoint override.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { stripJpegMetadata } from '../src/features/photos/jpeg.ts';
import { cleanupSubmissions } from './cleanup-submissions.mjs';
import { localApi } from './lib/local-api.mjs';
import { execute } from './lib/local-db.mjs';
import { notificationLockAudit } from './lib/notification-lock-audit.mjs';
import { notificationStore } from '../supabase/functions/notification-scheduler/store.ts';
import { expoTransport } from '../supabase/functions/notification-scheduler/expo.ts';
import { runNotificationJob } from '../supabase/functions/notification-scheduler/worker.ts';
const api = localApi(),
  users = [],
  counts = new Map(),
  bodies = new Map(),
  modes = new Map(),
  gates = new Map(),
  receipts = new Map();
let receiptMode = 'ok',
  receiptReads = 0;
const server = createServer(async (request, response) => {
  let source = '';
  for await (const chunk of request) source += chunk;
  const value = JSON.parse(source);
  response.setHeader('Content-Type', 'application/json');
  if (request.url.endsWith('/send')) {
    assert.equal(value.length, 1);
    const message = value[0],
      key = `${message.data.userId}:${message.data.type}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    bodies.set(message.data.userId, message);
    const gate = gates.get(message.data.userId);
    if (gate) {
      gate.entered();
      await gate.release;
    }
    const mode = modes.get(message.data.userId);
    if (mode === 'network') {
      request.socket.destroy();
      return;
    }
    if (['400', '429', '500'].includes(mode)) {
      response.writeHead(Number(mode));
      response.end('{}');
      return;
    }
    if (mode === 'malformed') {
      response.end('{');
      return;
    }
    if (mode === 'timeout') {
      setTimeout(() => response.end('{}'), 2200);
      return;
    }
    if (mode === 'invalid') {
      response.end(
        JSON.stringify({ data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] }),
      );
      return;
    }
    const ticket = randomUUID();
    receipts.set(ticket, { status: 'ok' });
    response.end(JSON.stringify({ data: [{ status: 'ok', id: ticket }] }));
  } else {
    assert(request.url.endsWith('/getReceipts'));
    receiptReads++;
    if (receiptMode === 'failed') {
      response.writeHead(503);
      response.end('{}');
      return;
    }
    response.end(
      JSON.stringify({
        data:
          receiptMode === 'missing'
            ? {}
            : Object.fromEntries(
                value.ids.filter((id) => receipts.has(id)).map((id) => [id, receipts.get(id)]),
              ),
      }),
    );
  }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
assert(address && typeof address === 'object');
const provider = expoTransport(
  'local-test-only',
  (url, init) => fetch(`http://127.0.0.1:${address.port}${new URL(url).pathname}`, init),
  2000,
);
const store = notificationStore(api.admin);
const run = () => runNotificationJob(store, provider);
async function rpc(client, name, args) {
  const r = await client.rpc(name, args);
  assert.ifError(r.error);
  return r.data;
}
async function account() {
  const email = `sender-${randomUUID()}@example.test`,
    password = `Local-${randomUUID()}!`;
  const made = await api.admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ifError(made.error);
  const id = made.data.user.id;
  users.push(id);
  const client = api.client();
  assert.ifError((await client.auth.signInWithPassword({ email, password })).error);
  await rpc(client, 'complete_onboarding', {
    p_username: `s_${randomUUID().replaceAll('-', '').slice(0, 20)}`,
    p_reference_language_id: '00000000-0000-4000-8000-000000000001',
    p_target_language_id: '00000000-0000-4000-8000-000000000002',
    p_cefr_level: 'B1',
    p_timezone: 'UTC',
  });
  await rpc(client, 'save_notification_preferences', {
    notifications_enabled: true,
    daily_enabled: true,
    streak_enabled: false,
    daily_at: '00:00',
    streak_at: '00:00',
  });
  const binding = {
    installation_id: randomUUID(),
    installation_secret: randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''),
    installation_revision: 1,
    push_token: `ExpoPushToken[${randomUUID().replaceAll('-', '')}]`,
    device_platform: 'ios',
  };
  await rpc(client, 'sync_push_installation', binding);
  return { id, client, binding };
}
async function completePhoto(client, assignment) {
  const submission = await rpc(client, 'reserve_submission', { assignment_id: assignment });
  const jpeg = stripJpegMetadata(
    await readFile(new URL('../tests/fixtures/photo.jpg', import.meta.url)),
  );
  assert.ifError(
    (
      await client.storage
        .from('challenge-submissions')
        .upload(submission.storage_path, jpeg, { contentType: 'image/jpeg' })
    ).error,
  );
  assert.ifError(
    (
      await client.functions.invoke('photo-authority', {
        body: { action: 'finalize', submissionId: submission.id, visibility: 'private' },
      })
    ).error,
  );
  return submission;
}
async function streakUser() {
  const user = await account();
  const challenge = await rpc(user.client, 'get_or_create_today_challenge');
  const first = await completePhoto(user.client, challenge.words[0].id);
  // Local fixture only: give this user one surviving qualification yesterday.
  await execute(
    `update private.word_completions set completed_at=completed_at-interval '1 day',local_date=local_date-1 where submission_id='${first.id}';`,
  );
  await rpc(user.client, 'save_notification_preferences', {
    notifications_enabled: true,
    daily_enabled: false,
    streak_enabled: true,
    daily_at: '00:00',
    streak_at: '00:00',
  });
  return { ...user, challenge };
}
async function row(user) {
  return JSON.parse(
    await execute(
      `select to_jsonb(n) from private.notification_deliveries n where user_id='${user.id}' and kind='DAILY_WORDS';`,
    ),
  );
}
async function due(user) {
  await execute(
    `update public.notification_preferences set next_check_at=now() where user_id='${user.id}';`,
  );
}
async function receiptDue(user) {
  await execute(
    `update private.notification_deliveries set next_receipt_at=now() where user_id='${user.id}' and state='ticket_accepted';`,
  );
}
async function bound(user) {
  return await execute(
    `select coalesce(token,'') from private.push_installations where id='${user.binding.installation_id}';`,
  );
}
function sendCount(user) {
  return counts.get(`${user.id}:DAILY_WORDS`) ?? 0;
}
try {
  const a = await account(),
    b = await account();
  // A second device: exactly one most-recent eligible registration is selected.
  a.binding = {
    ...a.binding,
    installation_id: randomUUID(),
    push_token: `ExpoPushToken[${randomUUID().replaceAll('-', '')}]`,
  };
  await rpc(a.client, 'sync_push_installation', a.binding);
  const results = await Promise.all(Array.from({ length: 5 }, run));
  assert(results.every((r) => r.preparationFailures === 0 && r.recordFailures === 0));
  assert.equal(sendCount(a), 1);
  assert.equal(sendCount(b), 1);
  assert.equal(bodies.get(a.id).to, a.binding.push_token);
  const first = await row(a),
    challenge = await rpc(a.client, 'get_or_create_today_challenge');
  assert.equal(first.state, 'ticket_accepted');
  assert.deepEqual(
    first.words,
    challenge.words.map((word) => word.target_term),
  );
  assert(first.words.every((word) => bodies.get(a.id).body.includes(word)));
  assert.equal(bodies.get(a.id).data.userId, a.id);
  assert.equal(bodies.get(a.id).data.type, 'DAILY_WORDS');
  assert.equal(bodies.get(a.id).data.route, undefined);
  await rpc(a.client, 'replace_daily_challenge_word', {
    active_assignment_id: challenge.words[0].id,
  });
  await due(a);
  await run();
  assert.equal(sendCount(a), 1);
  assert.deepEqual((await row(a)).words, first.words);
  console.log(
    'PASS: concurrent real workers perform one HTTP send per user/type/day, choose one current device, snapshot three real words and never resend after replacement',
  );

  await receiptDue(a);
  await receiptDue(b);
  const leased = await Promise.all([store.receipts(), store.receipts()]);
  assert.equal(leased.flat().length, 2);
  assert.equal(new Set(leased.flat().map((r) => r.id)).size, 2);
  await Promise.all(
    leased
      .flat()
      .flatMap((target) => [
        store.receipt(target, { status: 'ok' }),
        store.receipt(target, { status: 'ok' }),
      ]),
  );
  assert.equal((await row(a)).state, 'provider_accepted');
  assert.equal(
    await execute(
      `select count(*) from private.notification_attempt_events where notification_id='${first.id}';`,
    ),
    '3',
  );
  await store.result(first.id, { state: 'uncertain', error: 'NetworkError' });
  assert.equal((await row(a)).state, 'provider_accepted');
  console.log(
    'PASS: concurrent receipt leases/results are idempotent; provider acceptance records history without claiming device delivery or allowing stale downgrade',
  );

  for (const mode of ['network', 'timeout', '400', '429', '500', 'malformed']) {
    const user = await account();
    modes.set(user.id, mode);
    await run();
    assert.equal(
      (await row(user)).state,
      ['network', 'timeout', '500', 'malformed'].includes(mode) ? 'uncertain' : 'send_rejected',
    );
    await due(user);
    await run();
    await run();
    assert.equal(sendCount(user), 1);
  }
  console.log(
    'PASS: socket loss, HTTP timeout, 400/429/500 and malformed acknowledgements receive no resend across repeated jobs',
  );

  const invalid = await account();
  modes.set(invalid.id, 'invalid');
  await run();
  assert.equal(await bound(invalid), '');
  invalid.binding = {
    ...invalid.binding,
    installation_revision: 2,
    push_token: `ExpoPushToken[${randomUUID().replaceAll('-', '')}]`,
  };
  await rpc(invalid.client, 'sync_push_installation', invalid.binding);
  await run();
  assert.equal(await bound(invalid), invalid.binding.push_token);
  assert.equal(sendCount(invalid), 1);
  console.log(
    'PASS: definite invalid ticket clears the exact binding; future registration replaces it without reopening the consumed daily attempt',
  );

  const receiptInvalid = await account();
  await run();
  let current = await row(receiptInvalid);
  receipts.set(current.ticket_id, { status: 'error', details: { error: 'DeviceNotRegistered' } });
  await receiptDue(receiptInvalid);
  await run();
  assert.equal(await bound(receiptInvalid), '');
  assert.equal((await row(receiptInvalid)).state, 'provider_rejected');
  const switched = await account();
  await run();
  current = await row(switched);
  await rpc(b.client, 'sync_push_installation', { ...switched.binding, installation_revision: 2 });
  receipts.set(current.ticket_id, { status: 'error', details: { error: 'DeviceNotRegistered' } });
  await receiptDue(switched);
  await run();
  assert.equal(await bound(switched), switched.binding.push_token);
  assert.equal(
    await execute(
      `select user_id from private.push_installations where id='${switched.binding.installation_id}';`,
    ),
    b.id,
  );
  console.log(
    'PASS: invalid receipts revoke only the attempted binding; an old account receipt cannot clear a newer account registration',
  );

  const crashed = await account();
  const claim = await store.claim();
  assert(claim.attempts.some((r) => r.userId === crashed.id));
  await execute(
    `update private.notification_deliveries set attempt_started_at=now()-interval '11 minutes' where user_id='${crashed.id}';`,
  );
  await due(crashed);
  await run();
  assert.equal((await row(crashed)).state, 'uncertain');
  assert.equal(sendCount(crashed), 0);
  const lost = await account();
  const countsBefore = await runNotificationJob(
    { ...store, result: () => Promise.reject(new Error('lost DB acknowledgement')) },
    provider,
  );
  assert(countsBefore.recordFailures > 0);
  assert.equal((await row(lost)).state, 'attempting');
  await due(lost);
  await run();
  assert.equal(sendCount(lost), 1);
  console.log(
    'PASS: crash after claim and result-persistence loss consume the attempt permanently; recovery records uncertainty rather than sending again',
  );

  const pending = await account();
  await run();
  receiptMode = 'failed';
  await receiptDue(pending);
  await run();
  assert.equal((await row(pending)).state, 'ticket_accepted');
  receiptMode = 'missing';
  await receiptDue(pending);
  await run();
  assert.equal((await row(pending)).state, 'ticket_accepted');
  receiptMode = 'ok';
  await receiptDue(pending);
  await run();
  assert.equal((await row(pending)).state, 'provider_accepted');
  assert.equal(sendCount(pending), 1);
  const expired = await account();
  await run();
  const beforeReads = receiptReads;
  await execute(
    `update private.notification_deliveries set attempt_started_at=now()-interval '25 hours',next_receipt_at=now() where user_id='${expired.id}';`,
  );
  await run();
  assert.equal((await row(expired)).state, 'receipt_unavailable');
  assert.equal(receiptReads, beforeReads);
  assert.equal(sendCount(expired), 1);
  console.log(
    'PASS: receipt outages/missing receipts retry only reads, while 24-hour expiry is terminal and never causes a resend',
  );

  for (const change of ['preferences', 'signout', 'switch']) {
    const user = await account();
    const claimed = await store.claim();
    assert(claimed.attempts.some((a) => a.userId === user.id));
    if (change === 'preferences')
      await rpc(user.client, 'save_notification_preferences', {
        notifications_enabled: false,
        daily_enabled: true,
        streak_enabled: false,
        daily_at: '00:00',
        streak_at: '00:00',
      });
    else if (change === 'signout') await user.client.auth.signOut({ scope: 'local' });
    else
      await rpc(b.client, 'sync_push_installation', { ...user.binding, installation_revision: 2 });
    await runNotificationJob({ ...store, claim: () => Promise.resolve(claimed) }, provider);
    assert.equal(sendCount(user), 0);
    assert.equal((await row(user)).error_code, 'EligibilityChanged');
  }
  const admitted = await account();
  const claimed = await store.claim();
  const value = claimed.attempts.find((a) => a.userId === admitted.id);
  assert(value);
  const authorizations = await Promise.all([store.authorize(value.id), store.authorize(value.id)]);
  assert.equal(authorizations.filter(Boolean).length, 1);
  console.log(
    'PASS: pre-send authorization is one-use and suppresses calls after preference changes, sign-out and account switch',
  );

  const replayed = await account();
  const replayClaim = await store.claim();
  await Promise.all(
    Array.from({ length: 5 }, () =>
      runNotificationJob({ ...store, claim: () => Promise.resolve(replayClaim) }, provider),
    ),
  );
  assert.equal(sendCount(replayed), 1);
  assert.equal((await row(replayed)).state, 'ticket_accepted');
  console.log(
    'PASS: five workers replaying the same claim issue one HTTP call; losing authorizations cannot overwrite its accepted result',
  );

  const lateInvalid = await account();
  let entered, release;
  const reachedProvider = new Promise((resolve) => {
    entered = resolve;
  });
  gates.set(lateInvalid.id, {
    entered,
    release: new Promise((resolve) => {
      release = resolve;
    }),
  });
  modes.set(lateInvalid.id, 'invalid');
  const inFlight = run();
  await reachedProvider;
  try {
    lateInvalid.binding = {
      ...lateInvalid.binding,
      installation_revision: 2,
      push_token: `ExpoPushToken[${randomUUID().replaceAll('-', '')}]`,
    };
    await rpc(lateInvalid.client, 'sync_push_installation', lateInvalid.binding);
  } finally {
    release();
  }
  await inFlight;
  assert.equal(await bound(lateInvalid), lateInvalid.binding.push_token);
  await due(lateInvalid);
  await run();
  assert.equal(sendCount(lateInvalid), 1);
  console.log(
    'PASS: token replacement concurrent with an in-flight invalid-token ticket preserves the newer token and never reopens the daily attempt',
  );

  const lockFirst = await account();
  const lockClaim = await store.claim();
  const lockAttempt = lockClaim.attempts.find((a) => a.userId === lockFirst.id);
  assert(lockAttempt);
  const lockSecond = await account();
  await notificationLockAudit(lockFirst, lockSecond, lockAttempt);
  console.log(
    'PASS: batched scheduling, cross-account registration and simultaneous send admission complete without a lock-order deadlock',
  );

  const streak = await streakUser();
  await run();
  await due(streak);
  await run();
  assert.equal(counts.get(`${streak.id}:STREAK_AT_RISK`), 1);
  assert.equal(bodies.get(streak.id).body, 'Complete 1 word before today ends.');
  assert.equal(bodies.get(streak.id).data.type, 'STREAK_AT_RISK');
  const completed = await streakUser();
  const streakClaim = await store.claim();
  assert(
    streakClaim.attempts.some((a) => a.userId === completed.id && a.type === 'STREAK_AT_RISK'),
  );
  await completePhoto(completed.client, completed.challenge.words[1].id);
  await runNotificationJob({ ...store, claim: () => Promise.resolve(streakClaim) }, provider);
  assert.equal(counts.get(`${completed.id}:STREAK_AT_RISK`) ?? 0, 0);
  assert.equal(
    await execute(
      `select error_code from private.notification_deliveries where user_id='${completed.id}' and kind='STREAK_AT_RISK';`,
    ),
    'EligibilityChanged',
  );
  console.log(
    'PASS: an eligible streak reminder sends once; a real word completed between claim and send suppresses the provider call',
  );

  for (const [name, args] of [
    ['claim_notification_attempts', {}],
    ['authorize_notification_attempt', { notification_id: first.id }],
    ['claim_notification_receipts', {}],
    [
      'record_notification_result',
      { notification_id: first.id, result_status: 'uncertain', provider_error: 'NetworkError' },
    ],
    [
      'record_notification_receipt',
      { notification_id: first.id, provider_ticket: first.ticket_id, receipt_status: 'ok' },
    ],
  ])
    assert((await b.client.rpc(name, args)).error);
  assert((await b.client.schema('private').from('notification_deliveries').select('*')).error);
  assert(
    (
      await b.client
        .schema('private')
        .from('notification_attempt_events')
        .insert({ notification_id: first.id, state: 'provider_accepted' })
    ).error,
  );
  console.log(
    'PASS: actual Auth REST denies send authority, outcome forgery and cross-user private attempt history',
  );
} finally {
  for (const id of users) await execute(`delete from auth.users where id='${id}';`);
  await cleanupSubmissions(api.admin);
  server.closeAllConnections();
  server.close();
  await once(server, 'close');
}
