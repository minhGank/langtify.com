import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { localApi } from './lib/local-api.mjs';
import { execute } from './lib/local-db.mjs';
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
  const email = `discover-${randomUUID()}@example.test`,
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
try {
  const a = await account(),
    b = await account();
  const challenge = await rpc(a.client, 'get_or_create_today_challenge');
  const first = await photo(a.client, challenge.words[0].id),
    second = await photo(a.client, challenge.words[1].id);
  await visibility(a.client, first.id, 'public');
  let page = await feed(b.client);
  assert(page.items.some((r) => r.id === first.id));
  assert(!page.items.some((r) => r.id === second.id));
  page.items.forEach((r) => publicFields(r));
  assert.equal(page.viewer_id, b.id);
  assert.equal(page.target_language_id, target);
  assert((await feed(a.client)).items.some((r) => r.id === first.id));
  assert.deepEqual(
    (await b.client.from('submissions').select('*').in('id', [first.id, second.id])).data,
    [],
  );
  assert.deepEqual((await b.client.from('profiles').select('*').eq('id', a.id)).data, []);
  assert(
    (
      await b.client.rpc('set_submission_visibility', {
        submission_id: first.id,
        requested_visibility: 'private',
      })
    ).error,
  );
  assert(
    (
      await b.client.rpc('get_discover_photo_targets', {
        viewer: a.id,
        expected_target: target,
        submission_ids: [first.id],
      })
    ).error,
  );
  assert((await api.client().rpc('get_discover_feed')).error);
  console.log(
    'PASS: public-only feed, owner inclusion, minimal projection, raw RLS and mutation/anonymous denial',
  );
  const batch = await signs(b.client, [first.id, second.id, randomUUID()]);
  assert.deepEqual(
    batch.items.map((r) => r.id),
    [first.id],
  );
  publicFields(batch.items[0], true);
  const path = batch.items[0].signed_path;
  assert.equal((await fetch(api.url + path)).status, 200);
  const claims = JSON.parse(
    Buffer.from(
      new URL(api.url + path).searchParams.get('token').split('.')[1],
      'base64url',
    ).toString(),
  );
  assert.equal(claims.exp - claims.iat, 60);
  assert.deepEqual(await ownerPreviews(b.client, [first.id, second.id]), [
    { id: first.id, signedPath: null },
    { id: second.id, signedPath: null },
  ]);
  assert((await b.client.storage.from(bucket).download(first.storage_path)).error);
  const direct = await b.client.storage.from(bucket).createSignedUrl(first.storage_path, 3600);
  assert(direct.error);
  // Audit: mixed maximum-size batches and UUID case cannot widen authority.
  const maximum = await signs(b.client, [
    first.id.toUpperCase(),
    second.id,
    ...Array.from({ length: 22 }, () => randomUUID()),
  ]);
  assert.deepEqual(
    maximum.items.map((row) => row.id),
    [first.id],
  );
  assert(
    (
      await b.client.functions.invoke('photo-authority', {
        body: {
          action: 'feed-previews',
          submissionIds: Array.from({ length: 25 }, () => randomUUID()),
          targetLanguageId: target,
        },
      })
    ).error,
  );
  const pending = await rpc(a.client, 'reserve_submission', {
    assignment_id: challenge.words[2].id,
  });
  assert.deepEqual((await signs(b.client, [pending.id])).items, []);
  assert(!(await feed(b.client)).items.some((row) => row.id === pending.id));
  assert((await b.client.rpc('begin_submission_deletion', { submission_id: first.id })).error);
  assert(
    (await b.client.from('submissions').update({ visibility: 'private' }).eq('id', first.id)).error,
  );
  // Cross-user Storage removal is filtered by RLS, even for public photos.
  const removed = await b.client.storage.from(bucket).remove([first.storage_path]);
  assert(removed.error || removed.data.length === 0);
  assert.equal((await fetch(api.url + path)).status, 200);
  console.log(
    'PASS: maximum mixed batch, uppercase IDs, pending exclusion and cross-user REST/Storage mutation denial',
  );
  const manipulated = await signs(b.client, [first.id], {
    userId: a.id,
    storage_path: second.storage_path,
    expiresIn: 86400,
    download: true,
  });
  const uri = new URL(api.url + manipulated.items[0].signed_path);
  assert(uri.pathname.endsWith(first.storage_path));
  assert.equal(uri.searchParams.size, 1);
  const manipulatedClaims = JSON.parse(
    Buffer.from(uri.searchParams.get('token').split('.')[1], 'base64url').toString(),
  );
  // Each capability's TTL is relative to its own issue time, not an earlier
  // signing request that may have completed several seconds before this one.
  assert.equal(manipulatedClaims.exp - manipulatedClaims.iat, 60);
  for (const submissionIds of [
    [],
    Array(25).fill(first.id),
    [first.id, first.id.toUpperCase()],
    ['../evil'],
    [123],
  ]) {
    assert(
      (
        await b.client.functions.invoke('photo-authority', {
          body: { action: 'feed-previews', submissionIds, targetLanguageId: target },
        })
      ).error,
    );
  }
  assert(
    (
      await b.client.functions.invoke('photo-authority', {
        body: {
          action: 'feed-previews',
          submissionIds: [first.id],
          targetLanguageId: '00000000-0000-4000-8000-000000000001',
        },
      })
    ).error,
  );
  assert(
    (
      await api.client().functions.invoke('photo-authority', {
        body: { action: 'feed-previews', submissionIds: [first.id], targetLanguageId: target },
      })
    ).error,
  );
  console.log(
    'PASS: bounded batch signs only eligible IDs; private, arbitrary path, TTL, identity, target and anonymous bypasses fail',
  );
  await visibility(a.client, first.id, 'private');
  assert(!(await feed(b.client)).items.some((r) => r.id === first.id));
  assert.deepEqual((await signs(b.client, [first.id])).items, []);
  assert.equal((await fetch(api.url + path)).status, 200); // Existing capability retains its short expiry.
  await visibility(a.client, first.id, 'public');
  await visibility(a.client, second.id, 'public');
  await execute(`begin; alter table public.submissions disable trigger prepare_submission;
 update public.submissions set submitted_at='2026-09-13T12:00:00.123456Z' where id in('${first.id}','${second.id}');
 alter table public.submissions enable trigger prepare_submission; commit;`);
  const ids = [first.id, second.id].sort().reverse();
  // Bound cursor to fixture timestamp so this also works with unrelated local photos.
  const initial = await feed(b.client, {
    before_time: '2026-09-13T12:00:00.123457Z',
    before_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    page_size: 1,
  });
  assert.equal(initial.items[0].id, ids[0]);
  const next = await feed(b.client, {
    before_time: initial.items[0].submitted_at,
    before_id: initial.items[0].id,
    page_size: 1,
  });
  assert.equal(next.items[0].id, ids[1]);
  assert.equal(new Set([...initial.items, ...next.items].map((r) => r.id)).size, 2);
  console.log('PASS: visibility transitions and exact microsecond/UUID keyset pagination');
  await execute(
    `update public.user_language_profiles set target_language_id='00000000-0000-4000-8000-000000000001',reference_language_id='${target}' where user_id='${b.id}';`,
  );
  assert(!(await feed(b.client)).items.some((r) => [first.id, second.id].includes(r.id)));
  assert(
    (
      await b.client.functions.invoke('photo-authority', {
        body: { action: 'feed-previews', submissionIds: [first.id], targetLanguageId: target },
      })
    ).error,
  );
  await execute(
    `update public.user_language_profiles set target_language_id='${target}',reference_language_id='00000000-0000-4000-8000-000000000001' where user_id='${b.id}';`,
  );
  const ownChallenge = await rpc(b.client, 'get_or_create_today_challenge');
  const own = await photo(b.client, ownChallenge.words[0].id);
  await visibility(b.client, own.id, 'public');
  assert((await feed(b.client)).items.some((r) => r.id === own.id));
  await rpc(a.client, 'begin_submission_deletion', { submission_id: first.id });
  assert(!(await feed(b.client)).items.some((r) => r.id === first.id));
  assert.deepEqual((await signs(b.client, [first.id])).items, []);
  await erase(a.client, first);
  assert.deepEqual((await signs(b.client, [first.id])).items, []);
  console.log(
    'PASS: settings changes invalidate old signing context; own photos appear; deleting/deleted photos are excluded',
  );
  // Concurrent reads can observe before or after visibility commit, but never private unrelated rows.
  await Promise.all([
    visibility(a.client, second.id, 'private'),
    ...Array.from({ length: 4 }, async () => {
      const result = await signs(b.client, [first.id, second.id]);
      assert(result.items.every((r) => r.id === second.id));
    }),
  ]);
  assert.deepEqual((await signs(b.client, [second.id])).items, []);
  await visibility(a.client, second.id, 'public');
  const expiring = (await signs(b.client, [second.id])).items[0].signed_path;
  const expires = JSON.parse(
    Buffer.from(
      new URL(api.url + expiring).searchParams.get('token').split('.')[1],
      'base64url',
    ).toString(),
  ).exp;
  console.log(
    'PASS: concurrent visibility/signing responses obey eligibility snapshots; waiting for real 60-second expiry',
  );
  while (Date.now() < (expires + 2) * 1000)
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(30000, (expires + 2) * 1000 - Date.now())),
    );
  assert.notEqual((await fetch(api.url + expiring)).status, 200);
  assert.equal(
    (await fetch(api.url + (await signs(b.client, [second.id])).items[0].signed_path)).status,
    200,
  );
  console.log(
    'PASS: valid public object URL expires on server and authenticated renewal restores access',
  );
} finally {
  for (const id of users) await execute(`delete from auth.users where id='${id}';`);
  await cleanupSubmissions(api.admin);
}
