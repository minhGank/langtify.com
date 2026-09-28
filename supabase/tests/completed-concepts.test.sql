begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
create temporary table clock_fixture(stamp timestamptz);
insert into clock_fixture values(clock_timestamp());
create or replace function private.progress_time() returns timestamptz language sql volatile set search_path='' as $$select stamp from pg_temp.clock_fixture$$;
create function pg_temp.make_day(day date) returns uuid language plpgsql as $$
declare cid uuid;
begin
 insert into public.daily_challenges(user_id,user_language_profile_id,created_at)
 select user_id,id,day::timestamp at time zone timezone from public.user_language_profiles where user_id=auth.uid() returning id into cid;
 perform private.assign_challenge_word(cid,'review');perform private.assign_challenge_word(cid,'target');perform private.assign_challenge_word(cid,'stretch');return cid;
end;$$;
create function pg_temp.complete_word(word uuid,historical boolean default false) returns uuid language plpgsql as $$
declare s public.submissions;o storage.objects;
begin
 if historical then s:=public.reserve_historical_submission(word);else s:=public.reserve_submission(word);end if;
 insert into storage.objects(bucket_id,name,owner_id,version,metadata)
 values('challenge-submissions',s.storage_path,s.user_id::text,'completion-fixture','{"mimetype":"image/jpeg","size":100}') returning * into o;
 perform public.attest_submission_photo(s.id,s.user_id,o.id,o.version,repeat('a',64),16,16);
 perform public.finalize_submission(s.id);return s.id;
end;$$;
create function pg_temp.erase(sid uuid) returns void language plpgsql as $$begin
 perform public.begin_submission_deletion(sid);
 perform set_config('storage.allow_delete_query','true',true);
 delete from storage.objects where name=(select storage_path from public.submissions where id=sid);
 perform public.finish_submission_deletion(sid);
end;$$;
insert into auth.users(id,email) values
 ('33000000-0000-4000-8000-000000000001','completed_a@example.test'),
 ('33000000-0000-4000-8000-000000000002','completed_b@example.test'),
 ('33000000-0000-4000-8000-000000000003','completed_c@example.test');
do $$declare who uuid;begin for who in select id from auth.users where id::text like '33000000-%' loop
 perform set_config('request.jwt.claim.sub',who::text,true);
 perform public.complete_onboarding('c_'||right(who::text,12),'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','A1','UTC');
end loop;end$$;
select set_config('request.jwt.claim.sub','33000000-0000-4000-8000-000000000001',true);
create temporary table days(label text,id uuid);
insert into days values('past',pg_temp.make_day((clock_timestamp() at time zone 'UTC')::date-4));
create temporary table captured(kind text,id uuid,concept uuid,assignment uuid);
update clock_fixture set stamp=clock_timestamp()-interval '4 days';
insert into captured select 'daily',pg_temp.complete_word(id),concept_id,id from public.daily_challenge_words where daily_challenge_id=(select id from days where label='past') and slot='review';
update clock_fixture set stamp=clock_timestamp();
insert into captured select 'historical',pg_temp.complete_word(id,true),concept_id,id from public.daily_challenge_words where daily_challenge_id=(select id from days where label='past') and slot='target';
select is((select count(*) from private.completed_concepts where user_id=auth.uid()),2::bigint,'Both verified daily and historical captures are remembered by concept');
select is((select count(*) from private.historical_captures where user_id=auth.uid()),1::bigint,'Historical capture retains its separate progress source');
create temporary table incomplete as select (public.reserve_historical_submission(id)).* from public.daily_challenge_words where daily_challenge_id=(select id from days where label='past') and slot='stretch';
select throws_ok($$select public.finalize_submission((select id from incomplete))$$,'23514','photo_not_uploaded','Failed finalization cannot manufacture a completed concept');
select is((select count(*) from private.completed_concepts where user_id=auth.uid()),2::bigint,'Pending and rejected uploads never enter completion memory');
select pg_temp.erase(id) from incomplete;
select ok(not exists(select 1 from private.completed_concepts where user_id=auth.uid() and concept_id=(select concept_id from incomplete)),'Abandoned upload does not make an uncompleted concept ineligible');
select pg_temp.erase(id) from captured;
select is(public.get_my_progress()->>'total_xp','0','Deletion still reverses word XP');
select is((select count(*) from private.completed_concepts where user_id=auth.uid()),2::bigint,'Revocation cannot reset selection eligibility');
create temporary table payloads(label text,payload jsonb);
insert into payloads values('today',public.get_or_create_today_challenge());
select ok(not exists(select 1 from jsonb_array_elements((select payload->'words' from payloads where label='today')) w join captured c on c.concept=(w->>'concept_id')::uuid),'Later daily generation excludes both completed semantic concepts despite deletion');
select is((select string_agg(w->>'cefr_level','/' order by n) from jsonb_array_elements((select payload->'words' from payloads where label='today')) with ordinality x(w,n)),'A1/A1/A2','Exact A1 boundary survives completion filtering');
select is((select count(distinct w->>'concept_id') from jsonb_array_elements((select payload->'words' from payloads where label='today')) w),3::bigint,'Today has no duplicate concepts');
select is(public.get_or_create_today_challenge(),(select payload from payloads where label='today'),'Retries preserve the existing daily snapshot');
insert into payloads values('replace',public.replace_daily_challenge_word((select (payload->'words'->0->>'id')::uuid from payloads where label='today')));
select ok(not exists(select 1 from jsonb_array_elements((select payload->'words' from payloads where label='replace')) w join captured c on c.concept=(w->>'concept_id')::uuid),'Replace excludes all remembered concepts');
select is((select count(*) from public.daily_challenge_words where daily_challenge_id=(select (payload->'challenge'->>'id')::uuid from payloads where label='today') and replaced_at is null),3::bigint,'Replacement retains exactly three active slots');
-- Limit only the A1 pool to completed concepts: replacement must fail atomically.
update public.vocabulary_terms set is_active=false where language_id='00000000-0000-4000-8000-000000000002' and cefr_level='A1' and concept_id not in(select concept from captured);
select throws_ok($$select public.replace_daily_challenge_word((select (payload->'words'->0->>'id')::uuid from payloads where label='replace'))$$,'P0001','insufficient_vocabulary','Replacement exhaustion never reuses completed concepts or changes CEFR');
select is(public.get_or_create_today_challenge(),(select payload from payloads where label='replace'),'Exhausted replacement leaves assignment/history unchanged');
select throws_ok($$select pg_temp.make_day((clock_timestamp() at time zone 'UTC')::date+1)$$,'P0001','insufficient_vocabulary','Generation exhaustion cannot reuse completed concepts');
select is((select count(*) from public.daily_challenges where user_id=auth.uid()),2::bigint,'Failed generation leaves no partial challenge');
-- Same remaining pool is valid for a user who never completed those concepts.
select set_config('request.jwt.claim.sub','33000000-0000-4000-8000-000000000002',true);
select lives_ok($$select public.get_or_create_today_challenge()$$,'Completion exclusion is isolated to its owner');
select is((select count(*) from private.completed_concepts where user_id=auth.uid()),0::bigint,'Assignments alone never create completion history');
-- Switch the target language: a different primary term still means the same concept.
select set_config('request.jwt.claim.sub','33000000-0000-4000-8000-000000000001',true);
update public.vocabulary_terms set is_active=true;
update public.user_language_profiles set target_language_id='00000000-0000-4000-8000-000000000001',reference_language_id='00000000-0000-4000-8000-000000000002' where user_id=auth.uid();
update public.vocabulary_terms set is_active=false where language_id='00000000-0000-4000-8000-000000000001' and cefr_level='A1' and concept_id not in(select concept from captured);
select is((select count(*) from public.vocabulary_terms where language_id='00000000-0000-4000-8000-000000000001' and cefr_level='A1' and is_active),2::bigint,'Cross-language fixture has two exact-level equivalents before completion exclusion');
select throws_ok($$select pg_temp.make_day((clock_timestamp() at time zone 'UTC')::date+2)$$,'P0001','insufficient_vocabulary','Different language terms cannot evade concept-level exclusion');
update public.vocabulary_terms set is_active=true;
-- Reupload of an existing final assignment remains supported and cannot multiply memory.
select pg_temp.complete_word(assignment,true) from captured where kind='historical';
select is(public.get_my_progress()->>'total_xp','10','Existing historical assignment can restore its unchanged entitlement');
select is((select count(*) from private.completed_concepts where user_id=auth.uid()),2::bigint,'Reupload preserves one durable entry per semantic concept');
select pg_temp.erase(id) from public.submissions where daily_challenge_id=(select id from days where label='past') and status='completed';
delete from public.daily_challenges where id=(select id from days where label='past');
select is((select count(*) from private.completed_concepts where user_id=auth.uid()),2::bigint,'Trusted hard history deletion does not erase completion memory');
-- Uncompleted assignment recency remains unchanged and may cycle through the pool.
select set_config('request.jwt.claim.sub','33000000-0000-4000-8000-000000000003',true);
select pg_temp.make_day((clock_timestamp() at time zone 'UTC')::date-d) from generate_series(6,4,-1) d;
create temporary table oldest as select w.concept_id from public.daily_challenge_words w join public.daily_challenges c on c.id=w.daily_challenge_id where c.user_id=auth.uid() and w.cefr_level='A1' group by w.concept_id order by max(w.assigned_at),w.concept_id limit 1;
insert into days values('recency',pg_temp.make_day((clock_timestamp() at time zone 'UTC')::date-3));
select is((select concept_id from public.daily_challenge_words where daily_challenge_id=(select id from days where label='recency') and slot='review'),(select concept_id from oldest),'Never-completed concepts remain eligible in least-recently-assigned order');
update public.user_language_profiles set cefr_level='C2' where user_id=auth.uid();
insert into payloads values('c2',public.get_or_create_today_challenge());
select is((select string_agg(w->>'cefr_level','/' order by n) from jsonb_array_elements((select payload->'words' from payloads where label='c2')) with ordinality x(w,n)),'C1/C2/C2','Exact C2 boundary is unchanged');
set local role authenticated;
select throws_ok($$select * from private.completed_concepts$$,'42501',null,'Clients cannot read completion index directly');
select throws_ok($$insert into private.completed_concepts values(auth.uid(),gen_random_uuid(),gen_random_uuid(),now())$$,'42501',null,'Clients cannot manufacture completion history');
select throws_ok($$delete from private.completed_concepts where user_id=auth.uid()$$,'42501',null,'Clients cannot reset completion history');
select throws_ok($$select private.assign_challenge_word(gen_random_uuid(),'review')$$,'42501',null,'No client selection-helper authority');
reset role;
select throws_ok($$delete from private.completed_concepts$$,'23514','completed_concept_immutable','Even direct history deletion requires account erasure');
select throws_ok($$update private.completed_concepts set first_completed_at=now()$$,'23514','completed_concept_immutable','Original completion provenance cannot be rewritten');
delete from auth.users where id='33000000-0000-4000-8000-000000000001';
select is((select count(*) from private.completed_concepts),0::bigint,'Account erasure removes its private completion memory');
select * from finish();rollback;
