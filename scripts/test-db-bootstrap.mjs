// Replay schema files against a disposable database with the minimal Auth SQL
// contract. This checks migrations, not Supabase Auth service provisioning.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { execute, query } from './lib/local-db.mjs';

const database = `langtify_audit_${randomUUID().replaceAll('-', '')}`;
const migrations = new URL('../supabase/migrations/', import.meta.url);
const auditName = '20260912030000_phase3_audit_integrity.sql';
const user = randomUUID();
await execute(`create database ${database};`);
try {
  await execute(
    `create schema auth; create schema extensions;
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`,
    database,
  );
  for (const file of (await readdir(migrations)).filter((file) => file.endsWith('.sql')).sort()) {
    if (file === auditName) break;
    await execute(await readFile(new URL(file, migrations), 'utf8'), database);
  }
  await execute(await readFile(new URL('../supabase/seed.sql', import.meta.url), 'utf8'), database);
  await execute(
    `begin; insert into auth.users(id,email) values('${user}','${user}@example.test');
    select set_config('request.jwt.claim.sub','${user}',true);
    select public.complete_onboarding('bootstrap_fixture','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','B1','UTC');
    select public.get_or_create_today_challenge(); commit;`,
    database,
  );
  const before = await execute(
    `select jsonb_agg(jsonb_build_object('id',id,'concept',concept_id,'target',target_term,'reference',reference_term,'level',cefr_level) order by id) from public.daily_challenge_words;`,
    database,
  );
  const audit = await readFile(new URL(auditName, migrations), 'utf8');
  const failed = await query(
    `begin;
    insert into public.languages(id,code,name,native_name) values('43000000-0000-4000-8000-000000000001','zz','Fixture','Fixture');
    update public.vocabulary_terms set language_id='43000000-0000-4000-8000-000000000001'
      where id=(select vocabulary_term_id from public.daily_challenge_words limit 1);
    ${audit}`,
    database,
  ).result;
  assert.notEqual(failed.code, 0);
  assert.match(failed.error, /Historical vocabulary links must be repaired/);
  assert.equal(
    await execute(
      `select count(*) from information_schema.columns where table_schema='public' and table_name='daily_challenge_words' and column_name='target_language_id';`,
      database,
    ),
    '0',
  );
  console.log(
    'PASS: inconsistent pre-audit history aborts the migration without partial schema changes',
  );
  await execute(audit, database);
  assert.equal(
    await execute(
      `select jsonb_agg(jsonb_build_object('id',id,'concept',concept_id,'target',target_term,'reference',reference_term,'level',cefr_level) order by id) from public.daily_challenge_words;`,
      database,
    ),
    before,
  );
  assert.equal(
    await execute(
      `select count(*) from public.daily_challenge_words where target_language_id='00000000-0000-4000-8000-000000000002' and reference_language_id='00000000-0000-4000-8000-000000000001';`,
      database,
    ),
    '3',
  );
  console.log(
    'PASS: ordered migration bootstrap and nonempty audit backfill preserve all assignment snapshots',
  );
} finally {
  await execute(`drop database ${database};`);
}
