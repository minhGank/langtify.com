begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- These existing daily-photo fixtures represent reservations admitted on their
-- challenge day, then finalized later. Only the transaction-local test clock is
-- changed around admission; the production date guard remains fully exercised.
create temporary table reservation_clock(instant timestamptz);
insert into reservation_clock values(null);
create or replace function private.progress_time() returns timestamptz language sql volatile set search_path='' as $$
 select coalesce((select instant from pg_temp.reservation_clock),clock_timestamp())
$$;
create function pg_temp.reserve_daily_fixture(assignment uuid) returns public.submissions language plpgsql as $$
declare s public.submissions;
begin
 update pg_temp.reservation_clock set instant=(select (c.local_challenge_date::timestamp+interval '12 hours') at time zone l.timezone
   from public.daily_challenge_words w join public.daily_challenges c on c.id=w.daily_challenge_id
   join public.user_language_profiles l on l.user_id=c.user_id where w.id=assignment);
 s:=public.reserve_submission(assignment);
 update pg_temp.reservation_clock set instant=null;
 return s;
end;
$$;
insert into auth.users(id,email) values('66000000-0000-4000-8000-000000000001','history_a@example.test'),('66000000-0000-4000-8000-000000000002','history_b@example.test');
select set_config('request.jwt.claim.sub','66000000-0000-4000-8000-000000000001',true);
select public.complete_onboarding('history_a','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','B1','UTC');
create temporary table photos(n integer,id uuid);
create function pg_temp.capture(day date) returns uuid language plpgsql as $$
declare c uuid;s public.submissions;o storage.objects;term uuid;
begin
 insert into public.daily_challenges(user_id,user_language_profile_id,created_at)
  select user_id,id,day::timestamp at time zone 'UTC' from public.user_language_profiles where user_id=auth.uid() returning id into c;
 select id into term from public.vocabulary_terms where language_id='00000000-0000-4000-8000-000000000002' and cefr_level='A2' order by id limit 1;
 insert into public.daily_challenge_words(daily_challenge_id,slot,cefr_level,vocabulary_term_id) values(c,'review','A2',term);
 perform private.assign_challenge_word(c,'target');perform private.assign_challenge_word(c,'stretch');
 s:=pg_temp.reserve_daily_fixture((select id from public.daily_challenge_words where daily_challenge_id=c and slot='review'));
 insert into storage.objects(bucket_id,name,owner_id,version,metadata) values('challenge-submissions',s.storage_path,s.user_id::text,'history-fixture','{"mimetype":"image/jpeg","size":100}') returning * into o;
 -- SQL metadata fixture only; real JPEG/Storage coverage is in the integration suite.
 perform public.attest_submission_photo(s.id,s.user_id,o.id,o.version,repeat('a',64),16,16);
 perform public.finalize_submission(s.id);return s.id;
end;
$$;
select is(public.get_my_vocabulary()->>'total_concepts','0','No finalized captures means no learned concepts');
insert into photos values(1,pg_temp.capture('2026-08-01'));
select is(public.get_my_vocabulary()->>'total_concepts','1','First verified word appears');
select is(public.get_my_vocabulary()->'items'->0->>'visibility','private','Private photos appear to owner');
insert into photos values(2,pg_temp.capture('2026-08-02'));
select is(public.get_my_vocabulary()->>'total_concepts','1','Repeated concept groups across dates');
select is(public.get_my_vocabulary()->'items'->0->>'capture_count','2','Capture count counts surviving photos');
select is(public.get_my_vocabulary()->'items'->0->>'id',(select id::text from photos where n=2),'Latest photo selected');
select is(jsonb_array_length(public.get_my_vocabulary((select concept_id from public.submissions where id=(select id from photos where n=1)))->'items'),2,'Concept history retains both captures');
select is(jsonb_array_length(public.get_my_vocabulary(search_text=>upper((select target_term from public.submissions where id=(select id from photos where n=1))))->'items'),1,'Case-insensitive target search');
select is(jsonb_array_length(public.get_my_vocabulary(search_text=>upper((select reference_term from public.submissions where id=(select id from photos where n=1))))->'items'),1,'Case-insensitive reference search');
select is(jsonb_array_length(public.get_my_vocabulary(search_text=>'%')->'items'),0,'Search metacharacters are literal');
select is(jsonb_array_length(public.get_my_vocabulary(requested_level=>'A2')->'items'),1,'Exact CEFR filter matches');
select is(jsonb_array_length(public.get_my_vocabulary(requested_level=>'C2')->'items'),0,'Other level excluded');
select is(public.get_my_vocabulary(requested_level=>'C2')->>'total_concepts','1','Unique total is independent of filters');
create temporary table first_page as select public.get_my_vocabulary(requested_concept=>(select concept_id from public.submissions where id=(select id from photos where n=1)),page_size=>1) payload;
select is((select payload->>'has_more' from first_page),'true','Bounded page signals more');
select is((select public.get_my_vocabulary(requested_concept=>(payload->'concept'->>'concept_id')::uuid,before_time=>(payload->'items'->0->>'submitted_at')::timestamptz,before_id=>(payload->'items'->0->>'id')::uuid,page_size=>1)->'items'->0->>'id' from first_page),(select id::text from photos where n=1),'Keyset cursor retrieves older capture');
select throws_ok($$select public.get_my_vocabulary(page_size=>0)$$,'22023','invalid_history_query','Zero page rejected');
select throws_ok($$select public.get_my_vocabulary(page_size=>25)$$,'22023','invalid_history_query','Oversized page rejected');
select throws_ok($$select public.get_my_vocabulary(requested_level=>'D1')$$,'22023','invalid_history_query','Unknown CEFR rejected');
select throws_ok($$select public.get_my_vocabulary(before_id=>gen_random_uuid())$$,'22023','invalid_history_query','Partial cursor rejected');
select throws_ok($$select public.get_my_vocabulary(search_text=>repeat('a',101))$$,'22023','invalid_history_query','Search bounded');
-- Catalog edits/deactivation never change the snapshots used by history.
update public.vocabulary_terms set term='Catalog changed',is_active=false where id=(select vocabulary_term_id from public.submissions where id=(select id from photos where n=1));
select isnt(public.get_my_vocabulary()->'items'->0->>'target_term','Catalog changed','Historical text is immutable');
select public.set_submission_visibility((select id from photos where n=2),'public');
select is(public.get_my_vocabulary()->'items'->0->>'visibility','public','Visibility refresh reflects existing authority');
grant select on photos,first_page to authenticated;
set local role authenticated;
select is(public.get_my_vocabulary()->>'total_concepts','1','Authenticated invoker reads own history under RLS');
select throws_ok($$update public.submissions set target_term='fake'$$,'42501',null,'No direct mutation permission');
select set_config('request.jwt.claim.sub','66000000-0000-4000-8000-000000000002',true);
select is(public.get_my_vocabulary()->>'total_concepts','0','Other account cannot read even public captures');
select is((select count(*) from public.submissions),0::bigint,'Source RLS prevents cross-user reads');
select is(public.get_my_vocabulary(requested_concept=>(select payload->'concept'->>'concept_id' from first_page)::uuid)->>'total_concepts','0','Known concept ID does not grant another owner history');
reset role;
select set_config('request.jwt.claim.sub','66000000-0000-4000-8000-000000000001',true);
select public.begin_submission_deletion((select id from photos where n=2));
select is(public.get_my_vocabulary()->'items'->0->>'id',(select id::text from photos where n=1),'Deletion intent hides unavailable latest image and falls back to surviving photo');
select is(public.get_my_vocabulary()->'items'->0->>'capture_count','1','Another surviving capture retains concept');
select public.begin_submission_deletion((select id from photos where n=1));
select is(public.get_my_vocabulary()->>'total_concepts','0','Last removal removes concept');
set local role anon;
select throws_ok($$select public.get_my_vocabulary()$$,'42501',null,'Anonymous history denied');
reset role;
select ok(not (select prosecdef from pg_proc where oid='public.get_my_vocabulary(uuid,text,text,timestamptz,uuid,integer)'::regprocedure),'RPC is security invoker');
select * from finish();
rollback;
