// Replay schema files against a disposable database with the minimal Auth SQL
// contract. This checks migrations, not Supabase Auth service provisioning.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { execute, query } from './lib/local-db.mjs';

const database = `langtify_audit_${randomUUID().replaceAll('-', '')}`;
const migrations = new URL('../supabase/migrations/', import.meta.url);
const auditName = '20260912030000_phase3_audit_integrity.sql';
const user = randomUUID();
let expectedChallengeWords = 3;
await execute(`create database ${database};`);
try {
  await execute(
    `create schema auth; create schema extensions;
    create extension if not exists pgcrypto with schema extensions;
    create table auth.users(id uuid primary key,email text,deleted_at timestamptz,banned_until timestamptz);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as
      $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
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
    const historicalSnapshot = `select jsonb_build_object(
      'photos',(select jsonb_agg(to_jsonb(s)-'capture_kind' order by id) from public.submissions s),
      'daily',(select jsonb_agg(to_jsonb(w) order by submission_id) from private.word_completions w),
      'xp',(select jsonb_agg(to_jsonb(e) order by id) from public.xp_events e));`;
    const beforeHistorical =
      file === '20260923000000_past_words.sql' ? await execute(historicalSnapshot, database) : null;
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
    if (file === '20260923000000_past_words.sql') {
      assert.equal(await execute(historicalSnapshot, database), beforeHistorical);
      assert.equal(
        await execute(
          `select count(*) from public.submissions where capture_kind<>'daily';`,
          database,
        ),
        '0',
      );
      await execute(
        `select set_config('request.jwt.claim.sub','${user}',false);
        do $$declare challenge uuid; s public.submissions; o storage.objects;begin
          insert into public.daily_challenges(user_id,user_language_profile_id,created_at)
            select user_id,id,clock_timestamp()-interval '2 days' from public.user_language_profiles where user_id='${user}' returning id into challenge;
          perform private.assign_challenge_word(challenge,slot) from unnest(array['review','target','stretch']) slot;
          s:=public.reserve_historical_submission((select id from public.daily_challenge_words where daily_challenge_id=challenge and slot='review'));
          insert into storage.objects(bucket_id,name,owner_id,version,metadata)
            values('challenge-submissions',s.storage_path,s.user_id::text,'past-bootstrap','{"mimetype":"image/jpeg","size":100}') returning * into o;
          perform public.attest_submission_photo(s.id,s.user_id,o.id,o.version,repeat('a',64),16,16);
          perform public.finalize_submission(s.id);
        end$$;`,
        database,
      );
      expectedChallengeWords += 3;
      const snapshot = `select jsonb_build_object(
        'photos',(select jsonb_agg(to_jsonb(s) order by id) from public.submissions s),
        'daily',(select jsonb_agg(to_jsonb(w) order by submission_id) from private.word_completions w),
        'historical',(select jsonb_agg(to_jsonb(h) order by submission_id) from private.historical_captures h),
        'entries',(select jsonb_agg(to_jsonb(e) order by assignment_id) from private.past_word_entries e),
        'xp',(select jsonb_agg(to_jsonb(e) order by id) from public.xp_events e),
        'sources',(select jsonb_agg(to_jsonb(a) order by user_id,source_key) from private.xp_awards a));`;
      const before = await execute(snapshot, database);
      await execute(sql, database);
      await execute(sql, database);
      assert.equal(await execute(snapshot, database), before);
      assert.equal(
        await execute(`select count(*) from private.historical_captures;`, database),
        '1',
      );
      assert.equal(
        await execute(
          `select count(*) from private.word_completions where revoked_at is null;`,
          database,
        ),
        '3',
      );
      assert.equal(
        await execute(
          `select sum(amount) from public.xp_events where user_id='${user}';`,
          database,
        ),
        '50',
      );
      const security = await query(
        await readFile(new URL('../supabase/tests/past-words.test.sql', import.meta.url), 'utf8'),
        database,
      ).result;
      assert.equal(security.code, 0, security.error);
      assert.doesNotMatch(security.output, /(?:^|\n)not ok /);
      assert.match(security.output, /(?:^|\n)1\.\.[1-9][0-9]*/);
      console.log(
        'PASS: Past Words bootstrap preserves existing daily recovery/history and replay preserves nonempty historical credit, indexed state and immutable XP',
      );

      const plan = await query(
        `begin;
        set local session_replication_role=replica;
        insert into public.daily_challenge_words(id,daily_challenge_id,slot,cefr_level,vocabulary_term_id,concept_id,reference_term_id,target_term,reference_term,target_language_id,reference_language_id)
          select gen_random_uuid(),gen_random_uuid(),w.slot,w.cefr_level,w.vocabulary_term_id,w.concept_id,w.reference_term_id,
            w.target_term,w.reference_term,w.target_language_id,w.reference_language_id
          from (select * from public.daily_challenge_words limit 1) w cross join generate_series(1,25000);
        insert into private.past_word_entries(assignment_id,user_id,challenge_date,has_capture)
          select w.id,'${user}',current_date-(row_number() over(order by w.id)/3+1)::integer,false
          from public.daily_challenge_words w where not exists(select 1 from private.past_word_entries e where e.assignment_id=w.id);
        set local session_replication_role=origin;
        analyze private.past_word_entries;analyze public.daily_challenge_words;analyze public.submissions;
        load 'auto_explain';
        set local auto_explain.log_min_duration=0;
        set local auto_explain.log_nested_statements=on;
        set local auto_explain.log_analyze=on;
        set local auto_explain.log_timing=off;
        set local client_min_messages=log;
        set local plan_cache_mode=force_generic_plan;
        select set_config('request.jwt.claim.sub','${user}',true);
        select public.get_my_past_words(before_captured=>false,before_date=>current_date-4000,before_id=>'ffffffff-ffff-ffff-ffff-ffffffffffff',page_size=>12);
        rollback;`,
        database,
        'supabase_admin',
      ).result;
      assert.equal(plan.code, 0, plan.error);
      assert.match(
        plan.error,
        /(?:Index Scan|Index Only Scan|Bitmap Index Scan) (?:on|using) past_word_entries_page/,
      );
      assert.match(plan.error, /Index Cond:.*user_id.*has_capture.*challenge_date.*assignment_id/);
      assert.doesNotMatch(plan.error, /Seq Scan on past_word_entries/);
      assert.doesNotMatch(plan.error, /Seq Scan on daily_challenge_words/);
      assert.equal(await execute(snapshot, database), before);
      console.log(
        'PASS: deep Past Words pagination seeks the owner/capture/date/assignment index under a generic plan across 25,000 assignments without loading entire history',
      );
    }
    if (file === '20260922020000_explore_search.sql') {
      const snapshot = `select jsonb_build_object(
        'catalog',(select jsonb_agg(to_jsonb(t) order by id) from public.vocabulary_terms t),
        'photos',(select jsonb_agg(to_jsonb(s) order by id) from public.submissions s),
        'follows',(select jsonb_agg(to_jsonb(f) order by follower_user_id,followed_user_id) from public.user_follows f),
        'inbox',(select jsonb_agg(to_jsonb(n) order by id) from public.in_app_notifications n),
        'xp',(select jsonb_agg(to_jsonb(e) order by id) from public.xp_events e));`;
      const before = await execute(snapshot, database);
      await execute(sql, database);
      await execute(sql, database);
      assert.equal(await execute(snapshot, database), before);
      assert.equal(
        await execute(
          `select has_function_privilege('anon','public.search_vocabulary_terms(text,text,uuid,integer)','execute');`,
          database,
        ),
        'f',
      );
      // The disposable Auth/Storage contract does not install Supabase's test-schema grants.
      await execute('grant usage on schema extensions to authenticated,anon;', database);
      const security = await query(
        await readFile(
          new URL('../supabase/tests/explore-search.test.sql', import.meta.url),
          'utf8',
        ),
        database,
      ).result;
      assert.equal(security.code, 0, security.error);
      assert.doesNotMatch(security.output, /(?:^|\n)not ok /);
      assert.match(security.output, /(?:^|\n)1\.\.[1-9][0-9]*/);
      console.log(
        'PASS: Explore security/pagination tests and nonempty replay preserve catalog, photos, social history and XP',
      );
      const plan = await query(
        `begin;
        set local session_replication_role=replica;
        insert into public.vocabulary_concepts(id,concept_key,category,is_photographable)
          select gen_random_uuid(),'EXPLORE_PLAN_'||n,'fixture',true from generate_series(1,25000)n;
        insert into public.vocabulary_terms(concept_id,language_id,term,cefr_level,part_of_speech)
          select id,'00000000-0000-4000-8000-000000000002','plan unrelated '||concept_key,'A1','noun'
          from public.vocabulary_concepts where concept_key like 'EXPLORE_PLAN_%';
        insert into public.submissions(id,user_id,daily_challenge_id,daily_challenge_word_id,concept_id,vocabulary_term_id,reference_term_id,target_term,reference_term,storage_path,visibility,status,submitted_at)
          select fixture.id,s.user_id,s.daily_challenge_id,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),s.reference_term_id,
            s.target_term,s.reference_term,s.user_id::text||'/'||fixture.id::text||'.jpg','public','completed',statement_timestamp()
          from (select * from public.submissions where status='completed' and visibility='public' limit 1) s
          cross join (select gen_random_uuid() as id from generate_series(1,25000)) fixture;
        insert into public.daily_challenge_words(id,daily_challenge_id,slot,cefr_level,vocabulary_term_id,concept_id,reference_term_id,target_term,reference_term,target_language_id,reference_language_id)
          select s.daily_challenge_word_id,gen_random_uuid(),'review','A1',s.vocabulary_term_id,s.concept_id,s.reference_term_id,s.target_term,s.reference_term,
            '00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001'
          from public.submissions s where not exists(select 1 from public.daily_challenge_words w where w.id=s.daily_challenge_word_id);
        set local session_replication_role=origin;
        analyze public.vocabulary_terms; analyze public.vocabulary_concepts; analyze public.submissions; analyze public.daily_challenge_words;
        load 'auto_explain';
        set local auto_explain.log_min_duration=0;
        set local auto_explain.log_nested_statements=on;
        set local auto_explain.log_analyze=on;
        set local auto_explain.log_timing=off;
        set local client_min_messages=log;
        set local plan_cache_mode=force_generic_plan;
        select set_config('request.jwt.claim.sub','${user}',true);
        select public.search_vocabulary_terms('chien');
        select public.get_concept_submissions((select concept_id from public.submissions where user_id='${user}' and status='completed' and visibility='public' order by created_at limit 1),statement_timestamp(),gen_random_uuid());
        rollback;`,
        database,
        'supabase_admin',
      ).result;
      assert.equal(plan.code, 0, plan.error);
      assert.match(plan.error, /Bitmap Index Scan on vocabulary_terms_explore_search/);
      assert.match(plan.error, /Index Cond:.*to_tsvector/);
      assert.match(
        plan.error,
        /(?:Index Scan|Index Only Scan|Bitmap Index Scan) (?:on|using) submissions_concept_newest/,
        plan.error,
      );
      assert.match(plan.error, /Index Cond:.*vocabulary_term_id.*submitted_at.*id.*</);
      assert.doesNotMatch(plan.error, /Seq Scan on vocabulary_terms/);
      assert.doesNotMatch(plan.error, /Seq Scan on submissions/);
      console.log(
        'PASS: actual Explore search and concept-photo RPCs use catalog GIN and concept/time/UUID indexes among 25,000 unrelated rows under generic plans',
      );
    }
    if (file === '20260922010000_follow_lists_inbox.sql') {
      const snapshot = `select jsonb_build_object(
        'profiles',(select jsonb_agg(to_jsonb(p) order by id) from public.profiles p),
        'follows',(select jsonb_agg(to_jsonb(f) order by follower_user_id,followed_user_id) from public.user_follows f),
        'inbox',(select jsonb_agg(to_jsonb(n) order by id) from public.in_app_notifications n),
        'xp',(select jsonb_agg(to_jsonb(e) order by id) from public.xp_events e));`;
      assert.equal(
        await execute(`select count(*) from public.in_app_notifications;`, database),
        '0',
      );
      await execute(
        `select set_config('request.jwt.claim.sub','${user}',false);
        select public.get_notification_summary();`,
        database,
      );
      assert.equal(
        await execute(
          `select count(*) from public.in_app_notifications where kind='DAILY_WORDS_READY';`,
          database,
        ),
        '1',
      );
      assert.equal(
        await execute(
          `select count(*) from public.in_app_notifications where kind<>'DAILY_WORDS_READY';`,
          database,
        ),
        '0',
      );
      const before = await execute(snapshot, database);
      await execute(sql, database);
      assert.equal(await execute(snapshot, database), before);
      await execute(
        `select set_config('request.jwt.claim.sub','${user}',false);
        select public.get_notification_summary(); select public.get_notification_inbox();`,
        database,
      );
      assert.equal(await execute(snapshot, database), before);
      assert.equal(
        await execute(
          `select has_table_privilege('authenticated','public.in_app_notifications','select');`,
          database,
        ),
        'f',
      );
      assert.equal(
        await execute(
          `select has_function_privilege('anon','public.get_notification_inbox(timestamptz,uuid,integer)','execute');`,
          database,
        ),
        'f',
      );
      console.log(
        'PASS: follow/inbox replay preserves nonempty relationships, event identity and XP; only current ready challenge is recovered',
      );
      const plan = await query(
        `begin;
        set local session_replication_role=replica;
        insert into public.user_follows(follower_user_id,followed_user_id)
          select gen_random_uuid(),gen_random_uuid() from generate_series(1,25000);
        insert into public.in_app_notifications(user_id,kind,source_key,actor_user_id)
          select gen_random_uuid(),'NEW_FOLLOWER','plan-'||n,gen_random_uuid() from generate_series(1,25000)n;
        set local session_replication_role=origin;
        analyze public.user_follows; analyze public.in_app_notifications;
        load 'auto_explain';
        set local auto_explain.log_min_duration=0;
        set local auto_explain.log_nested_statements=on;
        set local auto_explain.log_analyze=on;
        set local auto_explain.log_timing=off;
        set local client_min_messages=log;
        set local plan_cache_mode=force_generic_plan;
        select set_config('request.jwt.claim.sub','${user}',true);
        select public.get_profile_connections((select public_id from public.profiles where id='${user}'),'followers',statement_timestamp(),gen_random_uuid());
        select public.get_profile_connections((select public_id from public.profiles where id='${user}'),'following',statement_timestamp(),gen_random_uuid());
        select public.get_notification_inbox(statement_timestamp(),gen_random_uuid());
        rollback;`,
        database,
        'supabase_admin',
      ).result;
      assert.equal(plan.code, 0, plan.error);
      assert.doesNotMatch(plan.error, /Seq Scan on user_follows/);
      assert.doesNotMatch(plan.error, /Seq Scan on in_app_notifications/);
      assert.match(
        plan.error,
        /(?:Index Scan|Index Only Scan|Bitmap Index Scan) (?:on|using) user_follows_followers_page/,
      );
      assert.match(
        plan.error,
        /(?:Index Scan|Index Only Scan|Bitmap Index Scan) (?:on|using) user_follows_following_page/,
      );
      assert.match(
        plan.error,
        /(?:Index Scan|Index Only Scan|Bitmap Index Scan) (?:on|using) in_app_notifications_owner_page/,
      );
      assert.match(
        plan.error,
        /(?:Index Scan|Index Only Scan|Bitmap Index Scan) (?:on|using) in_app_notifications_unread/,
      );
      assert.match(plan.error, /Index Cond:.*created_at.*id.*</);
      console.log(
        'PASS: actual follow lists and inbox use indexed owner/cursor/unread bounds among 25,000 unrelated records under generic plans',
      );
    }
    if (file === '20260922000000_public_profile_submissions.sql') {
      const snapshot = `select jsonb_build_object(
        'profiles',(select jsonb_agg(to_jsonb(p) order by id) from public.profiles p),
        'submissions',(select jsonb_agg(to_jsonb(s) order by id) from public.submissions s),
        'xp',(select jsonb_agg(to_jsonb(e) order by id) from public.xp_events e));`;
      const before = await execute(snapshot, database);
      const feed = `select set_config('request.jwt.claim.sub','${user}',false);
        select public.get_public_profile_submissions((select public_id from public.profiles where id='${user}'));`;
      const visible = await execute(feed, database);
      await execute(sql, database);
      assert.equal(await execute(snapshot, database), before);
      assert.equal(await execute(feed, database), visible);
      assert.equal(
        await execute(
          `select has_function_privilege('anon','public.get_public_profile_submissions(uuid,timestamptz,uuid,integer)','execute');`,
          database,
        ),
        'f',
      );
      console.log(
        'PASS: public profile post migration replays over nonempty photos without changing privacy, identity or XP',
      );
    }
    if (file === '20260921000000_product_social.sql') {
      const author = randomUUID();
      const requestId = randomUUID();
      const moderator = await execute(`select user_id from private.moderators limit 1;`, database);
      await execute(
        `insert into auth.users(id,email) values('${author}','social-bootstrap@example.test');
        select set_config('request.jwt.claim.sub','${author}',false);
        select public.complete_onboarding('social_bootstrap','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','B1','UTC');
        select public.set_follow((select public_id from public.profiles where id='${user}'),true);
        select set_config('request.jwt.claim.sub','${moderator}',false);
        select public.moderate_report((select id from public.safety_reports where target_kind='submission' limit 1),'restore_submission','${randomUUID()}');
        select set_config('request.jwt.claim.sub','${author}',false);
        select public.create_submission_comment((select id from public.submissions where visibility='public' and status='completed' limit 1),'Durable discussion','${requestId}');
        select set_config('request.jwt.claim.sub','${user}',false);
        select public.report_submission_comment((select id from public.submission_comments where author_user_id='${author}'),'privacy');
        select set_config('request.jwt.claim.sub','${moderator}',false);
        select public.moderate_report((select id from public.safety_reports where target_kind='comment' limit 1),'remove_comment','${randomUUID()}');
        select set_config('request.jwt.claim.sub','${author}',false);
        select public.delete_submission_comment((select id from public.submission_comments where author_user_id='${author}'));`,
        database,
      );
      const snapshot = `select jsonb_build_object(
        'profiles',(select jsonb_agg(to_jsonb(p) order by id) from public.profiles p),
        'follows',(select jsonb_agg(to_jsonb(f) order by follower_user_id,followed_user_id) from public.user_follows f),
        'comments',(select jsonb_agg(to_jsonb(c) order by id) from public.submission_comments c),
        'reports',(select jsonb_agg(to_jsonb(r) order by id) from public.safety_reports r),
        'audit',(select jsonb_agg(to_jsonb(a) order by id) from public.moderation_audit a),
        'xp',(select jsonb_agg(to_jsonb(e) order by id) from public.xp_events e));`;
      const before = await execute(snapshot, database);
      await execute(sql, database);
      assert.equal(await execute(snapshot, database), before);
      const retry = await query(
        `select set_config('request.jwt.claim.sub','${author}',false);
        select public.create_submission_comment((select id from public.submission_comments where author_user_id='${author}'),'Durable discussion','${requestId}');`,
        database,
      ).result;
      // Exact retries must identify the original submission, never accept a
      // comment UUID as interchangeable context after replay.
      assert.notEqual(retry.code, 0);
      assert.match(retry.error, /request_identity_conflict/);
      await execute(
        `select set_config('request.jwt.claim.sub','${author}',false);
        select public.create_submission_comment((select submission_id from public.submission_comments where author_user_id='${author}'),'Durable discussion','${requestId}');`,
        database,
      );
      assert.equal(await execute(snapshot, database), before);
      console.log(
        'PASS: social replay preserves public identity, follows, comment tombstones, reports, immutable audit and XP',
      );
      const plan = await query(
        `begin;
        set local session_replication_role=replica;
        insert into public.profiles(id,username,onboarding_completed_at)
          select gen_random_uuid(),'zz_planner_'||lpad(n::text,8,'0'),now() from generate_series(1,25000)n;
        insert into public.user_follows(follower_user_id,followed_user_id)
          select gen_random_uuid(),gen_random_uuid() from generate_series(1,25000);
        insert into public.submission_comments(submission_id,author_user_id,request_id,body)
          select gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'Planner fixture' from generate_series(1,25000);
        set local session_replication_role=origin;
        analyze public.profiles;
        analyze public.user_follows;
        analyze public.submission_comments;
        load 'auto_explain';
        set local auto_explain.log_min_duration=0;
        set local auto_explain.log_nested_statements=on;
        set local auto_explain.log_analyze=on;
        set local auto_explain.log_timing=off;
        set local client_min_messages=log;
        set local plan_cache_mode=force_generic_plan;
        select set_config('request.jwt.claim.sub','${author}',true);
        select public.search_public_profiles('social_bo');
        select public.get_public_profile();
        select public.get_submission_comments(
          (select submission_id from public.submission_comments where author_user_id='${author}' limit 1),
          statement_timestamp(),gen_random_uuid());
        rollback;`,
        database,
        'supabase_admin',
      ).result;
      assert.equal(plan.code, 0, plan.error);
      assert.match(
        plan.error,
        /(?:Index Scan|Index Only Scan|Bitmap Index Scan) (?:on|using) profiles_username_search/,
      );
      assert.match(plan.error, /Index Cond:.*username.*>=/);
      assert.doesNotMatch(plan.error, /Seq Scan on profiles/);
      assert.doesNotMatch(plan.error, /Seq Scan on user_follows/);
      assert.doesNotMatch(plan.error, /Seq Scan on submission_comments/);
      assert.match(
        plan.error,
        /(?:Index Scan|Index Only Scan|Bitmap Index Scan) (?:on|using) submission_comments_page/,
      );
      assert.match(plan.error, /Index Cond:.*created_at.*id.*</);
      assert.match(
        plan.error,
        /(?:Index Scan|Index Only Scan|Bitmap Index Scan) (?:on|using) user_follows_pkey/,
      );
      assert.match(
        plan.error,
        /(?:Index Scan|Index Only Scan|Bitmap Index Scan) (?:on|using) user_follows_reverse/,
      );
      assert.equal((plan.error.match(/Query Text: \s*with edges as/g) ?? []).length, 1);
      console.log(
        'PASS: actual prefix-search, follow-count and comment-page RPCs use indexed bounds among 25,000 unrelated profiles/edges/comments under a generic plan',
      );
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
    if (file === '20260915000000_phase7_discover.sql') {
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
          `select set_config('request.jwt.claim.sub','${user}',false); select jsonb_array_length(public.get_discover_feed()->'items');`,
          database,
        ),
        `${user}\n0`,
      );
      await execute(
        `select set_config('request.jwt.claim.sub','${user}',false); select public.set_submission_visibility((select id from public.submissions where status='completed' limit 1),'public');`,
        database,
      );
      assert.equal(
        await execute(
          `select set_config('request.jwt.claim.sub','${user}',false); select jsonb_array_length(public.get_discover_feed()->'items');`,
          database,
        ),
        `${user}\n1`,
      );
      console.log(
        'PASS: Phase 7 installs and replays without changing XP or exposing private photos; explicit public visibility enables feed reads',
      );
    }
    if (file === '20260915010000_phase7_audit_pagination.sql') {
      const snapshot = `select set_config('request.jwt.claim.sub','${user}',false);
        select jsonb_build_object('feed',public.get_discover_feed(),
          'ledger',(select jsonb_agg(to_jsonb(e) order by id) from public.xp_events e),
          'photos',(select jsonb_agg(to_jsonb(s) order by id) from public.submissions s));`;
      const before = await execute(snapshot, database);
      await execute(sql, database);
      assert.equal(await execute(snapshot, database), before);
      console.log(
        'PASS: Phase 7 audit replay preserves public feed payloads, private photos and every XP event',
      );
    }
    if (file === '20260916000000_phase8_ratings.sql') {
      const rater = randomUUID();
      const ledger = await execute(
        `select jsonb_agg(to_jsonb(e) order by id) from public.xp_events e;`,
        database,
      );
      await execute(
        `insert into auth.users(id,email) values('${rater}','ratings-bootstrap@example.test');
        select set_config('request.jwt.claim.sub','${rater}',false);
        select public.complete_onboarding('rating_bootstrap','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','B1','UTC');
        select public.rate_submission((select id from public.submissions where visibility='public' and status='completed' limit 1),4);`,
        database,
      );
      const snapshot = `select set_config('request.jwt.claim.sub','${rater}',false);
        select jsonb_build_object('feed',public.get_discover_feed(),'ratings',(select jsonb_agg(to_jsonb(r) order by submission_id,rater_user_id) from public.submission_ratings r));`;
      const before = await execute(snapshot, database);
      await execute(sql, database);
      assert.equal(await execute(snapshot, database), before);
      assert.equal(
        await execute(
          `select jsonb_agg(to_jsonb(e) order by id) from public.xp_events e;`,
          database,
        ),
        ledger,
      );
      console.log(
        'PASS: Phase 8 bootstrap and nonempty replay preserve current votes, feed summaries and every XP event',
      );
      // Planner-only volume fixture in this disposable database. Deliberately
      // unrelated keys avoid provisioning 50,000 Auth accounts; all synthetic
      // rows and disabled-trigger settings roll back before lifecycle tests.
      const plan = await query(
        `begin;
        set local session_replication_role=replica;
        insert into public.submission_ratings(submission_id,rater_user_id,score)
          select gen_random_uuid(),gen_random_uuid(),3 from generate_series(1,50000);
        set local session_replication_role=origin;
        analyze public.submission_ratings;
        load 'auto_explain';
        set local auto_explain.log_min_duration=0;
        set local auto_explain.log_nested_statements=on;
        set local auto_explain.log_analyze=on;
        set local auto_explain.log_timing=off;
        set local client_min_messages=log;
        set local plan_cache_mode=force_generic_plan;
        select set_config('request.jwt.claim.sub','${rater}',true);
        select public.get_discover_feed(page_size=>1);
        rollback;`,
        database,
        'supabase_admin',
      ).result;
      assert.equal(plan.code, 0, plan.error);
      assert.match(
        plan.error,
        /(?:Index Scan|Bitmap Index Scan) (?:on|using) submission_ratings_pkey/,
      );
      assert.match(plan.error, /Index Cond: \(submission_id = ANY/);
      assert.doesNotMatch(plan.error, /Seq Scan on submission_ratings/);
      assert.equal((plan.error.match(/Query Text: with totals as/g) ?? []).length, 1);
      assert.equal(await execute(snapshot, database), before);
      console.log(
        'PASS: real feed RPC uses one indexed bounded rating aggregate among 50,000 unrelated votes under a generic plan',
      );
    }
    if (file === '20260918000000_phase10_notifications.sql') {
      await execute(
        `insert into public.notification_preferences(user_id,daily_time) values('${user}','09:15');
        insert into private.push_installations(id,secret_hash,revision,user_id,session_id,token,platform) values('${randomUUID()}',repeat('a',64),1,'${user}','${randomUUID()}','ExpoPushToken[bootstrapfixture]','ios');
        insert into private.notification_deliveries(user_id,kind,local_date,timezone,title,body) values('${user}','STREAK_AT_RISK',current_date,'UTC','Fixture','Fixture');`,
        database,
      );
      const snapshot = `select jsonb_build_object('preferences',(select jsonb_agg(to_jsonb(p)) from public.notification_preferences p),'bindings',(select jsonb_agg(to_jsonb(i)) from private.push_installations i),'deliveries',(select jsonb_agg(to_jsonb(n)) from private.notification_deliveries n),'xp',(select jsonb_agg(to_jsonb(e) order by id) from public.xp_events e));`;
      const before = await execute(snapshot, database);
      await execute(sql, database);
      assert.equal(await execute(snapshot, database), before);
      const sent = await query(`update private.notification_deliveries set state='sent';`, database)
        .result;
      assert.notEqual(sent.code, 0);
      console.log(
        'PASS: Phase 10 nonempty replay preserves preferences, bindings, blocked preparation and XP; schema cannot falsely record delivery',
      );
    }
    if (file === '20260918010000_phase10_sender.sql') {
      const attempt = randomUUID(),
        ticket = randomUUID();
      await execute(
        `insert into private.notification_deliveries(id,user_id,kind,local_date,timezone,title,body,state,blocked_reason,attempt_started_at,send_authorized_at,installation_id,installation_revision,token_hash)
        values('${attempt}','${user}','STREAK_AT_RISK',current_date-1,'UTC','Fixture','Fixture','attempting',null,now(),now(),'${randomUUID()}',1,repeat('a',64));`,
        database,
      );
      await execute(
        `select public.record_notification_result('${attempt}','ticket_accepted','${ticket}');`,
        database,
      );
      const snapshot = `select jsonb_build_object('deliveries',(select jsonb_agg(to_jsonb(n) order by id) from private.notification_deliveries n),'events',(select jsonb_agg(to_jsonb(e) order by id) from private.notification_attempt_events e),'xp',(select jsonb_agg(to_jsonb(e) order by id) from public.xp_events e));`;
      const before = await execute(snapshot, database);
      await execute(sql, database);
      await execute(
        `select public.record_notification_result('${attempt}','uncertain',null,'NetworkError');`,
        database,
      );
      assert.equal(await execute(snapshot, database), before);
      console.log(
        'PASS: sender migration replays over blocked and attempted history without resetting attempts, receipts, events or XP',
      );
    }
    if (
      ['20260918020000_phase10_audit.sql', '20260918030000_phase10_lock_order.sql'].includes(file)
    ) {
      const snapshot = `select jsonb_build_object('deliveries',(select jsonb_agg(to_jsonb(n) order by id) from private.notification_deliveries n),'events',(select jsonb_agg(to_jsonb(e) order by id) from private.notification_attempt_events e),'bindings',(select jsonb_agg(to_jsonb(i) order by id) from private.push_installations i),'xp',(select jsonb_agg(to_jsonb(e) order by id) from public.xp_events e));`;
      const before = await execute(snapshot, database);
      await execute(sql, database);
      assert.equal(await execute(snapshot, database), before);
      assert.equal(
        await execute(
          `select has_function_privilege('authenticated','public.claim_notification_attempts(integer)','execute') or has_function_privilege('anon','public.authorize_notification_attempt(uuid)','execute');`,
          database,
        ),
        'f',
      );
      console.log(
        'PASS: Phase 10 admission audit migration replays without changing durable attempts, events, bindings or XP and preserves service-only admission',
      );
    }
    if (file === '20260917000000_phase9_safety.sql') {
      const rater = await execute(
        `select id from auth.users where id<>'${user}' limit 1;`,
        database,
      );
      const moderator = randomUUID();
      await execute(
        `insert into auth.users(id,email) values('${moderator}','safety-bootstrap@example.test');
        insert into private.moderators(user_id) values('${moderator}');
        select set_config('request.jwt.claim.sub','${rater}',false);
        select public.report_public_content((select id from public.submissions where visibility='public' and status='completed' limit 1),'submission','privacy');
        select public.block_submission_user((select id from public.submissions where visibility='public' and status='completed' limit 1));
        select set_config('request.jwt.claim.sub','${moderator}',false);
        select public.moderate_report((select id from public.safety_reports limit 1),'remove_submission','${randomUUID()}');`,
        database,
      );
      const snapshot = `select jsonb_build_object(
        'reports',(select jsonb_agg(to_jsonb(r) order by id) from public.safety_reports r),
        'audit',(select jsonb_agg(to_jsonb(e) order by id) from public.moderation_audit e),
        'blocks',(select jsonb_agg(to_jsonb(b) order by id) from public.user_blocks b),
        'safety',(select jsonb_agg(to_jsonb(a) order by user_id) from private.safety_accounts a),
        'removal',(select jsonb_agg(to_jsonb(m) order by submission_id) from private.submission_moderation m),
        'xp',(select jsonb_agg(to_jsonb(e) order by id) from public.xp_events e));`;
      const before = await execute(snapshot, database);
      await execute(sql, database);
      assert.equal(await execute(snapshot, database), before);
      assert.equal(
        await execute(
          `select has_function_privilege('authenticated','private.finalize_submission(uuid,text)','execute');`,
          database,
        ),
        'f',
      );
      assert.equal(
        await execute(
          `select set_config('request.jwt.claim.sub','${rater}',false); select jsonb_array_length(public.get_discover_feed()->'items');`,
          database,
        ),
        `${rater}\n0`,
      );
      console.log(
        'PASS: Phase 9 backfill/replay preserves nonempty reports, blocks, immutable audits and XP while keeping admission wrappers private',
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
  assert.equal(
    await execute(`select count(*) from public.daily_challenge_words;`, database),
    String(expectedChallengeWords),
  );
  assert.equal(
    await execute(`select public from storage.buckets where id='challenge-submissions';`, database),
    'f',
  );
  console.log(
    'PASS: Phase 4 migration bootstrap creates private storage and preserves existing challenges',
  );
  // Capture local credentials in memory only; lint the disposable schema, never
  // the persistent project or a linked deployment. Do not echo the connection URL.
  const status = spawnSync('npx', ['supabase', 'status', '-o', 'json'], { encoding: 'utf8' });
  assert.equal(status.status, 0, 'Local Supabase status unavailable for disposable lint');
  let connection;
  try {
    connection = new URL(JSON.parse(status.stdout).DB_URL);
  } catch {
    throw new Error('Local Supabase database URL unavailable for disposable lint');
  }
  assert(['postgres:', 'postgresql:'].includes(connection.protocol));
  assert.equal(connection.hostname, '127.0.0.1');
  assert.equal(connection.port, '54322');
  assert(connection.password.length > 0, 'Local disposable lint requires a database credential');
  assert.match(database, /^langtify_audit_[a-f0-9]{32}$/);
  connection.pathname = `/${database}`;
  connection.search = '';
  connection.hash = '';
  const lint = spawnSync(
    'npx',
    [
      'supabase',
      'db',
      'lint',
      '--db-url',
      connection.href,
      '--level',
      'warning',
      '--fail-on',
      'warning',
    ],
    { encoding: 'utf8' },
  );
  const safeOutput = `${lint.stdout ?? ''}\n${lint.stderr ?? ''}`
    .replaceAll(connection.href, '[local disposable database]')
    .replaceAll(connection.password, '[redacted]')
    .replaceAll(decodeURIComponent(connection.password), '[redacted]');
  assert.equal(lint.status, 0, safeOutput);
  console.log(
    'PASS: Supabase database lint reports no warnings/errors for the complete disposable schema',
  );
} finally {
  await execute(`drop database ${database};`);
}
