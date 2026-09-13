begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Test-only server clock replacement, rolled back with every fixture.
create temporary table progress_clock(instant timestamptz);
insert into progress_clock values('2026-01-01 12:00:00+00');
create or replace function private.progress_time() returns timestamptz language sql volatile set search_path='' as $$select instant from pg_temp.progress_clock$$;
create function pg_temp.clock_at(stamp timestamptz) returns void language sql as $$update pg_temp.progress_clock set instant=stamp$$;
create function pg_temp.photo(day date,slot_name text default 'review') returns uuid language plpgsql as $$
declare c uuid; s public.submissions; o storage.objects;
begin
 select id into c from public.daily_challenges where user_id=auth.uid() and local_challenge_date=day;
 if c is null then
  insert into public.daily_challenges(user_id,user_language_profile_id,created_at)
   select user_id,id,day::timestamp at time zone timezone from public.user_language_profiles where user_id=auth.uid() returning id into c;
  perform private.assign_challenge_word(c,'review'); perform private.assign_challenge_word(c,'target'); perform private.assign_challenge_word(c,'stretch');
 end if;
 s:=public.reserve_submission((select id from public.daily_challenge_words where daily_challenge_id=c and slot=slot_name and replaced_at is null));
 if s.status='completed' then perform public.finalize_submission(s.id); return s.id; end if;
 insert into storage.objects(bucket_id,name,owner_id,version,metadata) values('challenge-submissions',s.storage_path,s.user_id::text,'xp-fixture','{"mimetype":"image/jpeg","size":100}') returning * into o;
 -- Metadata fixture only. Real byte verification is exercised by Auth/Storage integration.
 perform public.attest_submission_photo(s.id,s.user_id,o.id,o.version,repeat('a',64),16,16);
 perform public.finalize_submission(s.id);
 return s.id;
end;
$$;
create function pg_temp.erase(sid uuid) returns void language plpgsql as $$
begin
 perform public.begin_submission_deletion(sid);
 perform set_config('storage.allow_delete_query','true',true);
 delete from storage.objects where name=(select storage_path from public.submissions where id=sid);
 perform public.finish_submission_deletion(sid);
end;
$$;
insert into auth.users(id,email) values('56000000-0000-4000-8000-000000000001','xp_audit@example.test');
select set_config('request.jwt.claim.sub','56000000-0000-4000-8000-000000000001',true);
select public.complete_onboarding('xp_audit','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','B1','UTC');
select pg_temp.clock_at('2026-01-01 12:00+00'); select pg_temp.photo('2026-01-01');
select pg_temp.clock_at('2026-01-02 12:00+00'); select pg_temp.photo('2026-01-02');
select pg_temp.clock_at('2026-01-03 12:00+00'); select pg_temp.photo('2026-01-03');
select is((select sum(amount) from public.xp_events),40::bigint,'Three distinct days earn word XP and one milestone');
-- Source identities must ignore the database session's presentation settings.
create temporary table date_formats as select row_number() over()::integer n,style from unnest(array['SQL, DMY','SQL, MDY','German, DMY','Postgres, DMY','Postgres, MDY','ISO, YMD']) style;
create function pg_temp.format_completion(n integer,style text) returns bigint language plpgsql as $$begin
 perform set_config('datestyle',style,true);
 perform pg_temp.photo('2025-12-01'::date+n);
 return (select sum(amount) from public.xp_events where event_type='STREAK_MILESTONE');
end$$;
select is(pg_temp.format_completion(n,style),10::bigint,'One net milestone under '||style) from date_formats order by n;
select is((select count(*) from private.xp_awards where event_type='STREAK_MILESTONE'),1::bigint,'One durable milestone source across formats');
set local datestyle='German, DMY';
select pg_temp.erase(id) from public.submissions where daily_challenge_id=(select id from public.daily_challenges where user_id=auth.uid() and local_challenge_date='2026-01-02');
select is((select sum(amount) from public.xp_events where event_type='STREAK_MILESTONE'),0::bigint,'Historical deletion reverses the original source under a different format');
select is(public.get_my_progress()->>'current_streak','1','Historical middle deletion splits current streak');
select is(public.get_my_progress()->>'longest_streak','1','Historical middle deletion splits longest streak');
select is((select count(*) from private.streak_milestones),1::bigint,'Split history cannot manufacture candidates');
-- Restore the qualifying window using the test-only clock. No new identity.
select pg_temp.clock_at('2026-01-02 12:00+00'); select pg_temp.photo('2026-01-02');
select is((select sum(amount) from public.xp_events where event_type='STREAK_MILESTONE'),10::bigint,'Restoration reuses the original milestone');
select is((select count(*) from private.streak_milestones),1::bigint,'Restoration has no new candidate');
select is((select sum(amount) from public.xp_events),(select sum(balance) from private.xp_awards),'Signed ledger and source balances agree after restoration');
-- Parent removal must preserve signed history while reconciling missing facts.
select pg_temp.clock_at('2026-01-03 12:00+00');
delete from public.daily_challenges where user_id=auth.uid() and local_challenge_date='2026-01-01';
select is((select sum(amount) from public.xp_events where event_type='STREAK_MILESTONE'),0::bigint,'Challenge cascade revokes broken milestone without deleting history');
select ok(exists(select 1 from public.xp_events where event_type='WORD_COMPLETED' and amount<0),'Challenge cascade retains reversal events');
select is(public.get_my_progress()->>'longest_streak','2','Cascade recomputes streak');
-- The formatter must not implicitly cast a date through the session timezone.
-- Apia skipped 2011-12-30; UTC completion facts must still keep that exact key.
insert into auth.users(id,email) values('56000000-0000-4000-8000-000000000002','xp_audit_zone@example.test');
select set_config('request.jwt.claim.sub','56000000-0000-4000-8000-000000000002',true);
select public.complete_onboarding('xp_audit_zone','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','B1','UTC');
set local timezone='UTC';
select pg_temp.clock_at('2011-12-28 12:00+00'); select pg_temp.photo('2011-12-28');
select pg_temp.clock_at('2011-12-29 12:00+00'); select pg_temp.photo('2011-12-29');
select pg_temp.clock_at('2011-12-30 12:00+00'); select pg_temp.photo('2011-12-30');
select is((select sum(amount) from public.xp_events where user_id=auth.uid() and event_type='STREAK_MILESTONE'),10::bigint,'UTC date earns one milestone before session timezone change');
set local timezone='Pacific/Apia';
select pg_temp.photo('2011-12-30','target');
select is((select sum(amount) from public.xp_events where user_id=auth.uid() and event_type='STREAK_MILESTONE'),10::bigint,'Skipped date in session timezone cannot change completion source');
select is((select source_key from private.xp_awards where user_id=auth.uid() and event_type='STREAK_MILESTONE'),'milestone:3:2011-12-30','Canonical key retains persisted completion date');
set local timezone='UTC';
-- Exact boundaries, including numeric-sqrt rounding cases within bigint input.
select is((private.level_progress((25::numeric*l*(l+3)+dx)::bigint)->>'level')::integer,
 l-case when dx=-1 then 1 else 0 end,'Exact level near threshold '||l||' offset '||dx)
 from unnest(array[1,2,3,4,5,10,100,1000,1000000,10000000,100000000,600000000]) l cross join unnest(array[-1,0,1]) dx;
select ok((private.level_progress(9223372036854775807)->>'level_start_xp')::numeric<=9223372036854775807::numeric
 and (private.level_progress(9223372036854775807)->>'next_level_xp')::numeric>9223372036854775807::numeric,'Maximum bigint lies inside its exact level interval');
select throws_ok($$select private.level_progress(-1)$$,'P0001','invalid_xp_total','Negative XP input rejected');
select throws_ok($$select private.level_progress(null)$$,'P0001','invalid_xp_total','Null XP input rejected');
select * from finish(); rollback;
