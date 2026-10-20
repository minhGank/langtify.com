begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
-- Explicit legacy v1 fixture. Public v2 behavior is tested in selection-v2.test.sql.
create function pg_temp.legacy_today() returns jsonb language plpgsql as $$
declare cid uuid;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and onboarding_completed_at is not null) then
  raise exception using errcode='P0001',message='onboarding_required'; end if;
 select id into cid from public.daily_challenges where user_id=auth.uid() and local_challenge_date=(clock_timestamp() at time zone 'UTC')::date;
 if cid is null then
  insert into public.daily_challenges(user_id,user_language_profile_id) select user_id,id from public.user_language_profiles where user_id=auth.uid() returning id into cid;
  perform private.assign_challenge_word(cid,'review');
  perform private.assign_challenge_word(cid,'target');
  perform private.assign_challenge_word(cid,'stretch');
 end if;
 return private.challenge_payload(cid);
end;$$;
select no_plan();
insert into auth.users(id,email) values('31000000-0000-4000-8000-000000000001','selection@example.test');
select set_config('request.jwt.claim.sub','31000000-0000-4000-8000-000000000001',true);
select throws_ok($$select pg_temp.legacy_today()$$,'P0001','onboarding_required','Incomplete onboarding cannot create a challenge');
select public.complete_onboarding('selection_user','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','B1','UTC');
create temporary table pool as select id,concept_id from public.vocabulary_terms where language_id='00000000-0000-4000-8000-000000000002' and cefr_level='A2';
update public.vocabulary_terms set cefr_level='A1' where id in(select id from pool);
select throws_ok($$select pg_temp.legacy_today()$$,'P0001','insufficient_vocabulary','No fallback to an incorrect CEFR level');
update public.vocabulary_terms set cefr_level='A2' where id in(select id from pool);
update public.vocabulary_concepts set is_photographable=false where id in(select concept_id from pool);
select throws_ok($$select pg_temp.legacy_today()$$,'P0001','insufficient_vocabulary','Non-photographable concepts excluded');
update public.vocabulary_concepts set is_photographable=true,is_active=false where id in(select concept_id from pool);
select throws_ok($$select pg_temp.legacy_today()$$,'P0001','insufficient_vocabulary','Inactive concepts excluded');
update public.vocabulary_concepts set is_active=true where id in(select concept_id from pool);
update public.vocabulary_terms set is_active=false where id in(select id from pool);
select throws_ok($$select pg_temp.legacy_today()$$,'P0001','insufficient_vocabulary','Inactive target terms excluded');
update public.vocabulary_terms set is_active=true where id in(select id from pool);
update public.vocabulary_terms set is_active=false where concept_id in(select concept_id from pool) and language_id='00000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.legacy_today()$$,'P0001','insufficient_vocabulary','Inactive reference equivalents excluded');
update public.vocabulary_terms set is_active=true where concept_id in(select concept_id from pool);
insert into public.languages(id,code,name,native_name) values('31000000-0000-4000-8000-000000000002','zz','Test reference','Test reference');
update public.vocabulary_terms set language_id='31000000-0000-4000-8000-000000000002' where concept_id in(select concept_id from pool) and language_id='00000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.legacy_today()$$,'P0001','insufficient_vocabulary','Missing reference equivalents excluded');
update public.vocabulary_terms set language_id='00000000-0000-4000-8000-000000000001' where language_id='31000000-0000-4000-8000-000000000002';
select is((select count(*) from public.daily_challenges where user_id=auth.uid())::integer,0,'Insufficient pools roll back challenge creation');
select is((select count(*) from public.daily_challenge_words)::integer,0,'Insufficient pools leave no partial assignments');

-- Failure in the final slot must also roll back the first two selected words.
update public.vocabulary_terms set is_active=false where language_id='00000000-0000-4000-8000-000000000002' and cefr_level='B2';
select throws_ok($$select pg_temp.legacy_today()$$,'P0001','insufficient_vocabulary','Final-slot insufficiency fails the entire transaction');
select is((select count(*) from public.daily_challenge_words)::integer,0,'Earlier slot writes roll back after final-slot failure');
update public.vocabulary_terms set is_active=true where language_id='00000000-0000-4000-8000-000000000002' and cefr_level='B2';

-- Build genuine prior assignments on a previous date using privileged fixtures.
insert into public.daily_challenges(user_id,user_language_profile_id,created_at)
select user_id,id,clock_timestamp()-interval '2 days' from public.user_language_profiles where user_id=auth.uid();
create temporary table prior as select id from public.daily_challenges where user_id=auth.uid();
select private.assign_challenge_word((select id from prior),'review');
select private.assign_challenge_word((select id from prior),'target');
select private.assign_challenge_word((select id from prior),'stretch');
-- Mark every review-level concept seen. Replacement preserves chronological history.
do $$ declare assignment uuid; begin
 for i in 1..5 loop
  select id into assignment from public.daily_challenge_words where daily_challenge_id=(select id from prior) and slot='review' and replaced_at is null;
  perform public.replace_daily_challenge_word(assignment);
 end loop;
end $$;
create temporary table oldest as select concept_id from public.daily_challenge_words where daily_challenge_id=(select id from prior) and slot='review' order by assigned_at limit 1;
create temporary table today as select pg_temp.legacy_today() payload;
select is(public.get_or_create_today_challenge(),(select payload from today),'Public generation reuses the saved v1 challenge unchanged');
select is((select payload->'challenge'->>'selection_policy_version' from today),'1','Legacy challenge keeps version 1');
select is((select (payload->'words'->0->>'concept_id')::uuid from today),(select concept_id from oldest),'When all concepts were seen, least recently assigned wins');
select ok(not exists(select 1 from public.daily_challenge_words w join public.daily_challenge_words old on old.concept_id=w.concept_id where w.daily_challenge_id=(select (payload->'challenge'->>'id')::uuid from today) and w.slot in('target','stretch') and old.daily_challenge_id=(select id from prior)),'Never-assigned concepts precede seen concepts in other slots');
select is((select count(distinct concept_id) from public.daily_challenge_words where daily_challenge_id=(select id from prior) and slot='review')::integer,6,'Repeated replacements exhaust distinct concepts without recycling any');
select throws_ok($$select public.replace_daily_challenge_word((select id from public.daily_challenge_words where daily_challenge_id=(select id from prior) and slot='review' and replaced_at is null))$$,'P0001','insufficient_vocabulary','Exhausted replacement pool returns a controlled error');
select is((select count(*) from public.daily_challenge_words where daily_challenge_id=(select id from prior) and replaced_at is null)::integer,3,'Failed replacement preserves all active assignments');
select is((select count(*) from public.daily_challenge_words where daily_challenge_id=(select id from prior))::integer,8,'Failed replacement does not alter history');

-- History uses snapshots; changing a term spelling does not make its concept unseen.
update public.vocabulary_terms set term=term||' variant' where concept_id=(select concept_id from oldest);
select ok(exists(select 1 from public.daily_challenge_words where concept_id=(select concept_id from oldest) and target_term not like '% variant'),'Term edits retain semantic assignment history');
set constraints all immediate;
select lives_ok($$delete from auth.users where id='31000000-0000-4000-8000-000000000001'$$,'Auth deletion cascades through challenge history without breaking slot constraints');
select * from finish();
rollback;
