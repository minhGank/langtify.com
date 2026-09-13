// Adversarial real Auth/Storage/function tests. Local temporary accounts only.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { localApi } from './lib/local-api.mjs';
import { execute } from './lib/local-db.mjs';
import { cleanupSubmissions } from './cleanup-submissions.mjs';
import { stripJpegMetadata } from '../src/features/photos/jpeg.ts';

const api = localApi(),
  users = [],
  bucket = 'challenge-submissions';
const jpeg = stripJpegMetadata(
  await readFile(new URL('../tests/fixtures/photo.jpg', import.meta.url)),
);
async function rpc(client, name, args) {
  const result = await client.rpc(name, args);
  assert.ifError(result.error);
  return result.data;
}
async function account() {
  const email = `photo-audit-${randomUUID()}@example.test`,
    password = `Test-${randomUUID()}!`;
  const result = await api.admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ifError(result.error);
  users.push(result.data.user.id);
  const client = api.client();
  assert.ifError((await client.auth.signInWithPassword({ email, password })).error);
  await rpc(client, 'complete_onboarding', {
    p_username: `audit_${randomUUID().replaceAll('-', '').slice(0, 20)}`,
    p_reference_language_id: '00000000-0000-4000-8000-000000000001',
    p_target_language_id: '00000000-0000-4000-8000-000000000002',
    p_cefr_level: 'B1',
    p_timezone: 'UTC',
  });
  return { client, id: result.data.user.id };
}
async function invoke(client, action, s, extra = {}) {
  return client.functions.invoke('photo-authority', {
    body: { action, submissionId: s.id, visibility: 'private', ...extra },
  });
}
async function upload(client, s, bytes = jpeg) {
  return client.storage
    .from(bucket)
    .upload(s.storage_path, bytes, { contentType: 'image/jpeg', cacheControl: '0' });
}
async function discard(client, s) {
  await rpc(client, 'begin_submission_deletion', { submission_id: s.id });
  assert.ifError((await client.storage.from(bucket).remove([s.storage_path])).error);
  await rpc(client, 'finish_submission_deletion', { submission_id: s.id });
}
// Inspect only this disposable fixture's files in the local file-backed Storage
// container; never print paths/tokens or inspect another project's backing store.
function physicalFileCount(id) {
  return Number(
    execFileSync(
      'docker',
      [
        'exec',
        'supabase_storage_langtify',
        'node',
        '-e',
        `const fs=require('node:fs'),path=require('node:path');
    const root=process.env.FILE_STORAGE_BACKEND_PATH;
    if(process.env.STORAGE_BACKEND!=='file'||!root)process.exit(2);
    console.log(fs.readdirSync(root,{recursive:true}).filter(name=>name.includes(process.argv[1])&&fs.statSync(path.join(root,name)).isFile()).length);`,
        id,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ),
  );
}
async function waitForFiles(id, predicate) {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (predicate(physicalFileCount(id))) return;
    await delay(100);
  }
  throw new Error('Timed out waiting for interrupted-upload physical file state');
}
async function interruptUpload(client, s) {
  const session = await client.auth.getSession();
  // Kong buffers incomplete public HTTP bodies locally. Connect to the same
  // authenticated Storage route inside its container to exercise a real partial
  // backing-file write. Pass the temporary user JWT on stdin, never argv/logs.
  execFileSync(
    'docker',
    [
      'exec',
      '-i',
      'supabase_storage_langtify',
      'node',
      '-e',
      `
    (async()=>{
      const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
      let input='';for await(const chunk of process.stdin)input+=chunk;
      const fixture=JSON.parse(input),root=process.env.FILE_STORAGE_BACKEND_PATH;
      if(process.env.STORAGE_BACKEND!=='file'||!root)throw new Error('File backend required');
      const count=()=>fs.readdirSync(root,{recursive:true}).filter(name=>name.includes(fixture.id)&&fs.statSync(path.join(root,name)).isFile()).length;
      const wait=async predicate=>{for(let i=0;i<200;i++){if(predicate(count()))return;await new Promise(resolve=>setTimeout(resolve,25));}throw new Error('Partial-file state timeout');};
      const request=http.request('http://127.0.0.1:'+(process.env.PORT||5000)+'/object/challenge-submissions/'+fixture.path,{
        method:'POST',headers:{Authorization:'Bearer '+fixture.token,'Content-Type':'image/jpeg','Transfer-Encoding':'chunked','x-upsert':'false'},
      });
      const settled=new Promise(resolve=>{request.on('error',()=>resolve());request.on('response',response=>{response.resume();resolve();});});
      try{request.write(Uint8Array.from(fixture.prefix));await wait(count=>count>0);}
      finally{request.destroy();await settled;}
      await wait(count=>count===0);
    })().catch(()=>{console.error('Storage partial-file cleanup probe failed');process.exitCode=1;});
  `,
    ],
    {
      input: JSON.stringify({
        id: s.id,
        path: s.storage_path,
        token: session.data.session.access_token,
        prefix: Array.from(jpeg.subarray(0, 100)),
      }),
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15000,
    },
  );
}

try {
  const a = await account(),
    b = await account();
  const challenge = await rpc(a.client, 'get_or_create_today_challenge');
  const assignment = challenge.words[0].id;
  const reserve = () => rpc(a.client, 'reserve_submission', { assignment_id: assignment });
  for (const bytes of [
    new TextEncoder().encode('not a photo'),
    new Uint8Array([255, 216, 255, 218, 0, 2, 1, 2, 3, 255, 217]),
    new Uint8Array([...jpeg.slice(0, 2), 255, 225, 0, 6, 71, 80, 83, 0, ...jpeg.slice(2)]),
  ]) {
    const s = await reserve();
    assert.ifError((await upload(a.client, s, bytes)).error);
    const direct = await a.client.rpc('finalize_submission', { submission_id: s.id });
    assert.equal(direct.error?.message, 'photo_not_verified');
    const verified = await invoke(a.client, 'finalize', s);
    assert(verified.error);
    assert.equal(verified.error.context.status, 422);
    assert.equal(
      (await a.client.from('submissions').select('status').eq('id', s.id).single()).data.status,
      'pending',
    );
    await discard(a.client, s);
  }
  console.log(
    'PASS: arbitrary bytes, fake JPEG scans and embedded GPS metadata cannot complete via RPC or function',
  );

  const s = await reserve();
  assert(
    (
      await a.client.rpc('attest_submission_photo', {
        submission_id: s.id,
        expected_user_id: a.id,
        expected_object_id: randomUUID(),
        expected_object_version: 'fake',
        image_sha256: 'a'.repeat(64),
        image_width: 16,
        image_height: 16,
      })
    ).error,
  );
  assert((await a.client.storage.from(bucket).createSignedUploadUrl(s.storage_path)).error);
  assert(
    (
      await b.client.storage
        .from(bucket)
        .upload(s.storage_path, jpeg, { contentType: 'image/jpeg' })
    ).error,
  );
  assert.ifError((await upload(a.client, s)).error);
  const results = await Promise.all([
    invoke(a.client, 'finalize', s),
    invoke(a.client, 'finalize', s),
  ]);
  results.forEach((result) => {
    assert.ifError(result.error);
    assert.equal(result.data.submission.id, s.id);
  });
  const retry = await invoke(a.client, 'finalize', s, { visibility: 'public' });
  assert.ifError(retry.error);
  assert.equal(retry.data.submission.visibility, 'private');
  assert((await invoke(b.client, 'finalize', s)).error);
  assert((await invoke(b.client, 'preview', s)).error);
  assert((await invoke(api.client(), 'preview', s)).error);
  assert((await a.client.storage.from(bucket).createSignedUrl(s.storage_path, 31536000)).error);
  const batchSigned = await a.client.storage
    .from(bucket)
    .createSignedUrls([s.storage_path], 31536000);
  assert(batchSigned.error || batchSigned.data.every((entry) => entry.error && !entry.signedUrl));
  const preview = await invoke(a.client, 'preview', s, {
    expiresIn: 31536000,
    path: `${b.id}/invented.jpg`,
  });
  assert.ifError(preview.error);
  const signed = api.url + preview.data.signedPath;
  const token = new URL(signed).searchParams.get('token');
  const claims = JSON.parse(atob(token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/')));
  assert.equal(claims.exp - claims.iat, 60);
  assert.equal((await fetch(signed)).status, 200);
  const expiryCheck = delay(62000).then(async () => {
    assert.notEqual((await fetch(signed)).status, 200);
    console.log('PASS: signed preview actually expires after its server-fixed lifetime');
  });
  console.log(
    'PASS: concurrent verification/retries complete once; owner-only fixed-lifetime previews resist TTL/path manipulation',
  );

  await expiryCheck;

  // A stale/incorrect cleanup job must not delete a live image, even with service credentials.
  await execute(
    `insert into private.photo_cleanup_queue(storage_path) values('${s.storage_path}') on conflict do nothing;`,
  );
  const waiting = await rpc(a.client, 'reserve_submission', {
    assignment_id: challenge.words[1].id,
  });
  assert.ifError((await upload(a.client, waiting)).error);
  await rpc(a.client, 'begin_submission_deletion', { submission_id: waiting.id });
  const protectedJob = await cleanupSubmissions(api.admin, 1);
  assert.equal(protectedJob.retry, 1);
  const nextJob = await cleanupSubmissions(api.admin, 1);
  assert.equal(nextJob.removed, 1, 'A failing oldest job must not starve other objects');
  assert.equal(
    (await rpc(a.client, 'finish_submission_deletion', { submission_id: waiting.id })).status,
    'deleted',
  );
  assert.ifError((await a.client.storage.from(bucket).download(s.storage_path)).error);
  await execute(`delete from private.photo_cleanup_queue where storage_path='${s.storage_path}';`);
  await rpc(a.client, 'begin_submission_deletion', { submission_id: s.id });
  const workers = await Promise.all([cleanupSubmissions(api.admin), cleanupSubmissions(api.admin)]);
  assert(workers.some((worker) => worker.removed >= 1));
  assert.equal(
    (await rpc(a.client, 'finish_submission_deletion', { submission_id: s.id })).status,
    'deleted',
  );
  assert((await api.admin.storage.from(bucket).download(s.storage_path)).error);
  assert(
    (
      await api.admin.storage
        .from(bucket)
        .upload(s.storage_path, jpeg, { contentType: 'image/jpeg' })
    ).error,
  );
  console.log(
    'PASS: stale cleanup cannot delete a live image; overlapping workers safely finish deletion and retired paths reject late writes',
  );

  const interrupted = await reserve();
  await interruptUpload(a.client, interrupted);
  assert((await a.client.storage.from(bucket).download(interrupted.storage_path)).error);
  assert.ifError((await upload(a.client, interrupted)).error);
  assert.ifError((await invoke(a.client, 'finalize', interrupted)).error);
  await discard(a.client, interrupted);
  await waitForFiles(interrupted.id, (count) => count === 0);
  console.log(
    'PASS: aborted request bodies leave no physical partial file; retry reuses the reservation and deletion removes all fixture bytes',
  );

  const fresh = await reserve();
  const simultaneous = await Promise.all([upload(a.client, fresh), upload(a.client, fresh)]);
  assert.equal(simultaneous.filter((r) => !r.error).length, 1);
  assert.ifError((await invoke(a.client, 'finalize', fresh)).error);
  assert(
    (
      await a.client.storage
        .from(bucket)
        .update(fresh.storage_path, jpeg, { contentType: 'image/jpeg' })
    ).error,
  );
  assert(
    (await a.client.storage.from(bucket).copy(fresh.storage_path, `${a.id}/${randomUUID()}.jpg`))
      .error,
  );
  const deletion = await rpc(a.client, 'begin_submission_deletion', { submission_id: fresh.id });
  assert.equal(deletion.status, 'deleting');
  assert((await invoke(a.client, 'finalize', fresh)).error);
  await cleanupSubmissions(api.admin);
  console.log(
    'PASS: concurrent uploads save one version; overwrite/copy and finalization during deletion are denied',
  );
} finally {
  for (const id of users) await execute(`delete from auth.users where id='${id}';`);
  await cleanupSubmissions(api.admin);
}
