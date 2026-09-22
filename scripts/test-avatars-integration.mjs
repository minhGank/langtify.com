import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { localApi } from './lib/local-api.mjs';
import { execute, query } from './lib/local-db.mjs';
import { cleanupAvatars } from './cleanup-avatars.mjs';
import { stripJpegMetadata } from '../src/features/photos/jpeg.ts';

const api = localApi(),
  users = [];
const bucket = 'profile-avatars';
const jpeg = stripJpegMetadata(
  await readFile(new URL('../tests/fixtures/photo.jpg', import.meta.url)),
);
async function rpc(client, name, args) {
  const result = await client.rpc(name, args);
  assert.ifError(result.error);
  return result.data;
}
async function account() {
  const email = `avatar-${randomUUID()}@example.test`,
    password = `Local-${randomUUID()}!`;
  const made = await api.admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ifError(made.error);
  const id = made.data.user.id;
  users.push(id);
  const client = api.client();
  assert.ifError((await client.auth.signInWithPassword({ email, password })).error);
  await rpc(client, 'complete_onboarding', {
    p_username: `av_${randomUUID().replaceAll('-', '').slice(0, 20)}`,
    p_reference_language_id: '00000000-0000-4000-8000-000000000001',
    p_target_language_id: '00000000-0000-4000-8000-000000000002',
    p_cefr_level: 'B1',
    p_timezone: 'UTC',
  });
  return { id, client };
}
async function reserve(client, requestId = randomUUID()) {
  return (await rpc(client, 'reserve_profile_avatar', { request_id: requestId })).avatar;
}
async function upload(client, avatar, bytes = jpeg, contentType = 'image/jpeg') {
  return client.storage.from(bucket).upload(avatar.storage_path, bytes, { contentType });
}
const finalize = (client, id) =>
  client.functions.invoke('avatar-authority', { body: { action: 'finalize', avatarId: id } });
async function previews(client, ids) {
  const result = await client.functions.invoke('avatar-authority', {
    body: { action: 'previews', avatarIds: ids },
  });
  assert.ifError(result.error);
  return result.data.items;
}
try {
  const a = await account(),
    b = await account();
  const requestId = randomUUID();
  const [first, duplicate] = await Promise.all([
    reserve(a.client, requestId),
    reserve(a.client, requestId),
  ]);
  assert.equal(first.id, duplicate.id);
  assert.equal(first.storage_path, `${first.id}.jpg`);
  assert((await upload(b.client, first)).error, 'Another account must not claim the reserved path');
  assert(
    (
      await a.client.storage
        .from(bucket)
        .upload('arbitrary.jpg', jpeg, { contentType: 'image/jpeg' })
    ).error,
  );
  assert((await upload(a.client, first, jpeg, 'image/png')).error);
  assert((await finalize(a.client, first.id)).error, 'Cannot finalize missing bytes');
  assert.ifError((await upload(a.client, first)).error);
  const uploadedVersion = await execute(
    `select version from storage.objects where bucket_id='profile-avatars' and name='${first.storage_path}';`,
  );
  const repeatedUpload = await upload(a.client, first);
  assert.equal(
    repeatedUpload.error?.statusCode,
    '409',
    `An uncertain-upload retry must return the conflict the avatar client recognizes: ${repeatedUpload.error?.message}`,
  );
  assert.equal(
    await execute(
      `select version from storage.objects where bucket_id='profile-avatars' and name='${first.storage_path}';`,
    ),
    uploadedVersion,
    'Duplicate upload cannot replace the bytes awaiting verification',
  );
  assert((await b.client.storage.from(bucket).download(first.storage_path)).error);
  assert((await a.client.storage.from(bucket).createSignedUrl(first.storage_path, 3600)).error);
  assert((await finalize(b.client, first.id)).error);
  assert.deepEqual(await previews(a.client, [first.id]), []);
  const results = await Promise.all([finalize(a.client, first.id), finalize(a.client, first.id)]);
  for (const result of results) {
    assert.ifError(result.error);
    assert.equal(result.data.avatar_id, first.id);
  }
  assert.equal((await rpc(a.client, 'get_own_avatar')).avatar_id, first.id);
  assert.equal((await rpc(a.client, 'get_public_profile')).profile.avatar_id, first.id);
  assert(
    (
      await a.client.rpc('activate_profile_avatar', {
        avatar_id: first.id,
        expected_user_id: a.id,
        expected_object_id: randomUUID(),
        expected_object_version: 'fake',
        image_sha256: 'a'.repeat(64),
        image_width: 16,
        image_height: 16,
      })
    ).error,
  );
  assert(
    (await a.client.rpc('get_avatar_targets', { viewer: b.id, avatar_ids: [first.id] })).error,
  );
  assert(
    (
      await a.client.storage
        .from(bucket)
        .update(first.storage_path, jpeg, { contentType: 'image/jpeg' })
    ).error,
  );
  assert(
    (await api.admin.storage.from(bucket).remove([first.storage_path])).error,
    'Stale privileged cleanup must not delete current image',
  );
  const signed = (await previews(b.client, [first.id]))[0];
  assert.deepEqual(Object.keys(signed).sort(), ['id', 'signed_path']);
  assert(!signed.signed_path.includes(a.id));
  const parsed = new URL(signed.signed_path, api.url);
  const claims = JSON.parse(
    Buffer.from(parsed.searchParams.get('token').split('.')[1], 'base64url').toString(),
  );
  assert.equal(claims.exp - claims.iat, 60);
  assert.equal((await fetch(parsed)).status, 200);
  console.log(
    'PASS: avatar reservation/finalization concurrency, immutable owner upload, trusted verification, private bucket and 60-second signing',
  );

  const publicId = (await rpc(a.client, 'get_public_profile')).profile.id;
  await rpc(b.client, 'block_public_profile', { profile_id: publicId });
  assert.deepEqual(await previews(b.client, [first.id]), []);
  const blocks = await rpc(b.client, 'get_blocked_users');
  await rpc(b.client, 'unblock_user', { block_id: blocks.items[0].id });
  await execute(`update private.safety_accounts set restricted=true where user_id='${a.id}';`);
  assert.deepEqual(await previews(b.client, [first.id]), []);
  assert.equal((await previews(a.client, [first.id])).length, 1);
  await execute(`update private.safety_accounts set restricted=false where user_id='${a.id}';`);
  const second = await reserve(a.client);
  assert.ifError((await upload(a.client, second)).error);
  const third = await reserve(a.client);
  // Test replay against real lifecycle rows, but never commit an older function
  // definition over newer migrations in the persistent local test database.
  const snapshot = `select jsonb_build_object(
    'states',(select jsonb_agg(to_jsonb(s) order by user_id) from private.avatar_states s where user_id='${a.id}'),
    'avatars',(select jsonb_agg(to_jsonb(v) order by id) from private.profile_avatars v where user_id='${a.id}'),
    'cleanup',(select jsonb_agg(to_jsonb(q) order by storage_path) from private.avatar_cleanup_queue q
      where storage_path in(select storage_path from private.profile_avatars where user_id='${a.id}')),
    'objects',(select jsonb_agg(jsonb_build_object('id',id,'name',name,'version',version) order by id)
      from storage.objects where bucket_id='profile-avatars'
      and name in(select storage_path from private.profile_avatars where user_id='${a.id}')),
    'bucket',(select to_jsonb(b) from storage.buckets b where id='profile-avatars'))`;
  const beforeReplay = await execute(snapshot);
  const searchDefinition =
    "select pg_get_functiondef('public.search_public_profiles(text,text,uuid)'::regprocedure);";
  const beforeSearch = await execute(searchDefinition);
  const migration = await readFile(
    new URL('../supabase/migrations/20260921010000_profile_avatars.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /^begin;\s/i);
  assert.match(migration, /\scommit;\s*$/i);
  const replay = migration.replace(/^begin;\s*/i, '').replace(/\s*commit;\s*$/i, '');
  await execute(`begin;
    create temporary table avatar_replay_snapshot(value jsonb) on commit drop;
    insert into avatar_replay_snapshot ${snapshot};
    ${replay}
    do $$begin
      if (${snapshot}) is distinct from (select value from pg_temp.avatar_replay_snapshot) then
        raise exception 'avatar_replay_changed_lifecycle_state';
      end if;
      if has_function_privilege('authenticated','public.get_avatar_targets(uuid,uuid[])','execute')
        or has_function_privilege('authenticated','public.activate_profile_avatar(uuid,uuid,uuid,text,text,integer,integer)','execute')
        or has_function_privilege('anon','public.reserve_profile_avatar(uuid)','execute') then
        raise exception 'avatar_replay_exposed_service_authority';
      end if;
    end$$;
    rollback;`);
  assert.equal(await execute(snapshot), beforeReplay);
  assert.equal(
    await execute(searchDefinition),
    beforeSearch,
    'Avatar replay must retain the exact newer People search definition',
  );
  console.log(
    'PASS: rollback-only avatar replay validates lifecycle/object/cleanup state and service-only authority without replacing newer People search',
  );
  assert((await finalize(a.client, second.id)).error);
  assert.equal(
    (await rpc(a.client, 'get_own_avatar')).avatar_id,
    first.id,
    'Failed replacement preserves previous avatar',
  );
  assert.ifError((await upload(a.client, third)).error);
  assert.ifError((await finalize(a.client, third.id)).error);
  assert.deepEqual(await previews(b.client, [first.id, second.id]), []);
  assert.equal(
    (await rpc(a.client, 'remove_profile_avatar', { expected_avatar_id: first.id })).avatar_id,
    third.id,
  );
  await Promise.all([cleanupAvatars(api.admin), cleanupAvatars(api.admin)]);
  assert.equal((await previews(a.client, [third.id])).length, 1);
  assert.equal(
    (await rpc(a.client, 'remove_profile_avatar', { expected_avatar_id: third.id })).avatar_id,
    null,
  );
  await cleanupAvatars(api.admin);
  assert.deepEqual(await previews(a.client, [third.id]), []);
  assert((await upload(a.client, third)).error, 'Retired paths reject late uploads');
  console.log(
    'PASS: blocked/restricted signing denial, replacement fencing, stale-remove protection and overlapping cleanup',
  );

  const invalid = await reserve(a.client);
  const exif = new Uint8Array([
    ...jpeg.slice(0, 2),
    255,
    225,
    0,
    6,
    71,
    80,
    83,
    0,
    ...jpeg.slice(2),
  ]);
  assert.ifError((await upload(a.client, invalid, exif)).error);
  assert((await finalize(a.client, invalid.id)).error);
  assert.equal((await rpc(a.client, 'get_own_avatar')).avatar_id, null);
  await execute(
    `update private.profile_avatars set expires_at=clock_timestamp()-interval '1 second' where id='${invalid.id}';`,
  );
  const cleaned = await cleanupAvatars(api.admin);
  assert(cleaned.removed >= 1);
  assert((await upload(a.client, invalid)).error);
  assert.deepEqual(
    (await api.admin.storage.from(bucket).list()).data?.filter((row) =>
      [first.id, second.id, third.id, invalid.id].some((id) => row.name === `${id}.jpg`),
    ),
    [],
  );
  console.log(
    'PASS: actual JPEG metadata rejection, abandoned-upload expiry and Storage API orphan recovery',
  );
  const erased = await account();
  await reserve(erased.client);
  const deletion = query(`begin;
    select 1 from auth.users where id='${erased.id}' for update;
    select 'AUDIT_LOCKED';select pg_sleep(1);
    delete from auth.users where id='${erased.id}';commit;`);
  assert.equal(await deletion.ready, true);
  const lateReservation = erased.client.rpc('reserve_profile_avatar', {
    request_id: randomUUID(),
  });
  const [deletionResult, reservationResult] = await Promise.all([deletion.result, lateReservation]);
  assert.equal(deletionResult.code, 0, deletionResult.error);
  users.splice(users.indexOf(erased.id), 1);
  assert.equal(reservationResult.error?.code, '42501');
  assert.equal(
    await execute(`select count(*) from private.profile_avatars where user_id='${erased.id}';`),
    '0',
  );
  console.log(
    'PASS: Auth erasure precedes avatar-state locks; waiting reservation rejects without a deadlock or orphan row',
  );
} finally {
  for (const id of users) assert.ifError((await api.admin.auth.admin.deleteUser(id)).error);
  await cleanupAvatars(api.admin);
}
