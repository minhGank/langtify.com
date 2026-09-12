// Uses only the isolated local Langtify database, never a linked/hosted project.
import assert from 'node:assert/strict';
import { query, execute } from './lib/local-db.mjs';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const userA = randomUUID();
const userB = randomUUID();
const username = `audit_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
const en = '00000000-0000-4000-8000-000000000001';
const fr = '00000000-0000-4000-8000-000000000002';
const claim = (id) => `select set_config('request.jwt.claim.sub','${id}',true);`;
const rpc = (name, level = 'B1', zone = 'UTC') =>
  `select public.complete_onboarding('${name}','${en}','${fr}','${level}','${zone}');`;

const seed = await readFile(new URL('../supabase/seed.sql', import.meta.url), 'utf8');
const seedResult = await execute(`begin;
  update public.languages set is_active=false, name='Administratively renamed' where code='fr';
  ${seed}
  ${seed}
  select (not is_active and name='Administratively renamed' and
    (select count(*) from public.languages where code in ('en','fr'))=2)
    from public.languages where code='fr';
  rollback;`);
assert.match(seedResult, /\nt\nROLLBACK$/);
console.log('PASS: replaying the actual seed preserves catalog edits and avoids duplicates');

const auditMigrationFile = await readFile(
  new URL('../supabase/migrations/20260912010000_phase2_audit_invariants.sql', import.meta.url),
  'utf8',
);
// Replay inside our rollback-only transaction, including files that now provide
// their own explicit transaction boundaries for CLI compatibility.
const auditMigration = auditMigrationFile.replace(/^begin;\s*/i, '').replace(/\s*commit;\s*$/i, '');
await execute(`begin; ${auditMigration} ${auditMigration} rollback;`);
console.log('PASS: the additive audit migration can be replayed safely in a transaction');

try {
  await execute(
    `insert into auth.users(id,email) values ('${userA}','${userA}@example.test'),('${userB}','${userB}@example.test');`,
  );
  const first = query(
    `begin; ${claim(userA)} ${rpc(username)} select 'AUDIT_LOCKED'; select pg_sleep(2); commit;`,
  );
  assert.equal(await first.ready, true, 'First transaction did not acquire its write locks');
  const second = query(`begin; ${claim(userB)} ${rpc(username.toUpperCase())} commit;`);
  const [winner, loser] = await Promise.all([first.result, second.result]);
  assert.equal(winner.code, 0, winner.error);
  assert.notEqual(loser.code, 0);
  assert.match(loser.error, /23505/);
  assert.equal(
    await execute(
      `select (onboarding_completed_at is null and username is null and not exists(select 1 from public.user_language_profiles where user_id='${userB}')) from public.profiles where id='${userB}';`,
    ),
    't',
  );
  console.log(
    'PASS: concurrent case-insensitive username claims yield one winner and a fully rolled-back loser',
  );

  const updateOne = query(
    `begin; ${claim(userA)} ${rpc(`${username}_a`, 'A1', 'UTC')} select 'AUDIT_LOCKED'; select pg_sleep(2); commit;`,
  );
  assert.equal(await updateOne.ready, true, 'First update did not acquire its write locks');
  const updateTwo = query(
    `begin; ${claim(userA)} ${rpc(`${username}_b`, 'C2', 'Europe/Paris')} commit;`,
  );
  const updates = await Promise.all([updateOne.result, updateTwo.result]);
  updates.forEach((result) => assert.equal(result.code, 0, result.error));
  assert.equal(
    await execute(
      `select username || ':' || cefr_level || ':' || timezone from public.profiles p join public.user_language_profiles l on l.user_id=p.id where p.id='${userA}';`,
    ),
    `${username}_b:C2:Europe/Paris`,
  );
  console.log(
    'PASS: concurrent onboarding updates for one account serialize into one coherent final record',
  );

  // Simulate pre-migration corruption only inside a transaction that must abort.
  const invalidExistingData = await query(`begin;
    alter table public.user_language_profiles disable trigger preserve_completed_learning_profile;
    delete from public.user_language_profiles where user_id='${userA}';
    ${auditMigration}
    rollback;`).result;
  assert.notEqual(invalidExistingData.code, 0);
  assert.match(
    invalidExistingData.error,
    /Completed profiles without learning records must be repaired/,
  );
  assert.equal(
    await execute(
      `select exists(select 1 from public.user_language_profiles where user_id='${userA}');`,
    ),
    't',
  );
  console.log(
    'PASS: the audit migration rejects inconsistent existing data without retaining changes',
  );
} finally {
  await execute(`delete from auth.users where id in ('${userA}','${userB}');`);
}
