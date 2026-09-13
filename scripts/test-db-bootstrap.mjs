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
  // Minimal Storage metadata contract; actual file service behavior is exercised
  // separately by db:test:submissions against real local Auth/Storage.
  await execute(
    `create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,user_metadata jsonb,owner_id text,version text);
    alter table storage.objects enable row level security;`,
    database,
  );
  for (const file of (await readdir(migrations))
    .filter((file) => file.endsWith('.sql') && file > auditName)
    .sort()) {
    const sql = await readFile(new URL(file, migrations), 'utf8');
    if (file === '20260912050000_phase4_audit_storage.sql') {
      // Pre-audit completion trusted metadata only. Never silently backfill that
      // fixture as verified or rewrite its completion when installing the guard.
      await execute(
        `select set_config('request.jwt.claim.sub','${user}',false);
        create table public.migration_photo_fixture as select (public.reserve_submission(
          (select id from public.daily_challenge_words limit 1))).*;
        insert into storage.objects(bucket_id,name,owner_id,version,metadata)
          select 'challenge-submissions',storage_path,user_id::text,'old-version','{"mimetype":"image/jpeg","size":100}'::jsonb
          from public.migration_photo_fixture;
        select public.finalize_submission((select id from public.migration_photo_fixture));`,
        database,
      );
      const refused = await query(sql, database).result;
      assert.notEqual(refused.code, 0);
      assert.match(refused.error, /Existing completed photos require a verified backfill/);
      assert.equal(
        await execute(
          `select status from public.submissions where id=(select id from public.migration_photo_fixture);`,
          database,
        ),
        'completed',
      );
      assert.equal(
        await execute(`select to_regclass('private.photo_verifications') is null;`, database),
        't',
      );
      await execute(
        `delete from storage.objects where name=(select storage_path from public.migration_photo_fixture);
        delete from public.submissions where id=(select id from public.migration_photo_fixture);
        drop table public.migration_photo_fixture;`,
        database,
      );
      console.log(
        'PASS: unverified legacy completion aborts the photo audit without blessing, altering or deleting existing data',
      );
    }
    if (file === '20260913000000_phase5_progress.sql') {
      await execute(
        `select set_config('request.jwt.claim.sub','${user}',false);
        do $$ declare w record; s public.submissions; o storage.objects; begin
          for w in select id from public.daily_challenge_words loop
            s:=public.reserve_submission(w.id);
            insert into storage.objects(bucket_id,name,owner_id,version,metadata) values('challenge-submissions',s.storage_path,s.user_id::text,'backfill','{"mimetype":"image/jpeg","size":100}') returning * into o;
            perform public.attest_submission_photo(s.id,s.user_id,o.id,o.version,repeat('a',64),16,16);
            perform public.finalize_submission(s.id);
          end loop;
          select * into s from public.submissions limit 1;
          perform public.begin_submission_deletion(s.id);
          delete from storage.objects where name=s.storage_path;
          perform public.finish_submission_deletion(s.id);
          s:=public.reserve_submission(s.daily_challenge_word_id);
          insert into storage.objects(bucket_id,name,owner_id,version,metadata) values('challenge-submissions',s.storage_path,s.user_id::text,'backfill','{"mimetype":"image/jpeg","size":100}') returning * into o;
          perform public.attest_submission_photo(s.id,s.user_id,o.id,o.version,repeat('a',64),16,16);
          perform public.finalize_submission(s.id);
        end $$;`,
        database,
      );
    }
    if (file === '20260913010000_phase5_audit_integrity.sql') {
      const ledger = await execute(
        `select jsonb_agg(to_jsonb(e) order by id) from public.xp_events e;`,
        database,
      );
      for (const [damage, message] of [
        [
          `select private.set_xp_award('${user}','STREAK_MILESTONE','milestone:3:03/01/2026',10,true,(select id from public.submissions limit 1));`,
          /milestone source keys require reviewed reconciliation/,
        ],
        [
          `update private.xp_awards set balance=0 where user_id='${user}' and balance>0;`,
          /ledger and source balances require reviewed reconciliation/,
        ],
      ]) {
        const refused = await query(`begin; ${damage} ${sql}`, database).result;
        assert.notEqual(refused.code, 0);
        assert.match(refused.error, message);
        assert.equal(
          await execute(
            `select jsonb_agg(to_jsonb(e) order by id) from public.xp_events e;`,
            database,
          ),
          ledger,
        );
      }
      console.log(
        'PASS: Phase 5 audit refuses ambiguous source aliases and inconsistent projections without changing history',
      );
      await execute(sql, database);
      assert.equal(
        await execute(
          `select jsonb_agg(to_jsonb(e) order by id) from public.xp_events e;`,
          database,
        ),
        ledger,
      );
      await execute(sql, database);
      assert.equal(
        await execute(
          `select jsonb_agg(to_jsonb(e) order by id) from public.xp_events e;`,
          database,
        ),
        ledger,
      );
      console.log(
        'PASS: Phase 5 audit and replay preserve every existing event and source balance',
      );
    } else {
      await execute(sql, database);
    }
    if (file === '20260914000000_phase6_vocabulary_history.sql') {
      const before = await execute(
        `select jsonb_agg(to_jsonb(e) order by id) from public.xp_events e;`,
        database,
      );
      await execute(sql, database);
      assert.equal(
        await execute(
          `select jsonb_agg(to_jsonb(e) order by id) from public.xp_events e;`,
          database,
        ),
        before,
      );
      assert.equal(
        await execute(
          `select set_config('request.jwt.claim.sub','${user}',false); select public.get_my_vocabulary()->>'total_concepts';`,
          database,
        ),
        `${user}\n3`,
      );
      console.log(
        'PASS: Phase 6 installs and replays over nonempty history without changing completion or XP',
      );
    }
    if (file === '20260913000000_phase5_progress.sql') {
      assert.equal(await execute(`select sum(amount) from public.xp_events;`, database), '40');
      assert.equal(
        await execute(
          `select count(*) from private.word_completions where time_source='legacy_challenge_snapshot';`,
          database,
        ),
        '4',
      );
      assert.equal(
        await execute(
          `select count(*) from private.word_completions where revoked_at is null;`,
          database,
        ),
        '3',
      );
      console.log(
        'PASS: nonempty Phase 5 backfill replays verified completions/deletions without XP farming or changing photos',
      );
    }
  }
  assert.equal(await execute(`select count(*) from public.daily_challenge_words;`, database), '3');
  assert.equal(
    await execute(`select public from storage.buckets where id='challenge-submissions';`, database),
    'f',
  );
  console.log(
    'PASS: Phase 4 migration bootstrap creates private storage and preserves existing challenges',
  );
} finally {
  await execute(`drop database ${database};`);
}
