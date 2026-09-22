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
create function pg_temp.capture(day date, requested_term uuid default null) returns uuid language plpgsql as $$
declare c uuid;s public.submissions;o storage.objects;term uuid;
begin
 insert into public.daily_challenges(user_id,user_language_profile_id,created_at)
  select user_id,id,day::timestamp at time zone 'UTC' from public.user_language_profiles where user_id=auth.uid() returning id into c;
 select id into term from public.vocabulary_terms where language_id='00000000-0000-4000-8000-000000000002' and cefr_level='A2' and (requested_term is null or id=requested_term) order by id limit 1;
 insert into public.daily_challenge_words(daily_challenge_id,slot,cefr_level,vocabulary_term_id) values(c,'review','A2',term);
 perform private.assign_challenge_word(c,'target');perform private.assign_challenge_word(c,'stretch');
 s:=pg_temp.reserve_daily_fixture((select id from public.daily_challenge_words where daily_challenge_id=c and slot='review'));
 insert into storage.objects(bucket_id,name,owner_id,version,metadata) values('challenge-submissions',s.storage_path,s.user_id::text,'history-fixture','{"mimetype":"image/jpeg","size":100}') returning * into o;
 -- SQL metadata fixture only; real JPEG/Storage coverage is in the integration suite.
 perform public.attest_submission_photo(s.id,s.user_id,o.id,o.version,repeat('a',64),16,16);
 perform public.finalize_submission(s.id);return s.id;
end;
$$;

-- Identical spellings represent distinct meanings. Save an older spelling before
-- the catalog edit, then two concepts with the same latest display text.
create temporary table terms as select id,row_number() over(order by id) n from public.vocabulary_terms
 where language_id='00000000-0000-4000-8000-000000000002' and cefr_level='A2' order by id limit 4;
update public.vocabulary_terms set term='Old audit spelling' where id=(select id from terms where n=1);
insert into photos values(1,pg_temp.capture('2026-07-01',(select id from terms where n=1)));
update public.vocabulary_terms set term='Shared audit spelling' where id in(select id from terms where n<=2);
insert into photos values(2,pg_temp.capture('2026-07-02',(select id from terms where n=1)));
insert into photos values(3,pg_temp.capture('2026-07-03',(select id from terms where n=2)));
insert into photos values(4,pg_temp.capture('2026-07-04',(select id from terms where n=3)));
insert into photos values(5,pg_temp.capture('2026-07-05',(select id from terms where n=4)));
-- Deliberate equal/submillisecond timestamps in isolated, rolled-back fixtures.
-- Production timestamps remain trigger-owned. No statuses or ownership are changed.
alter table public.submissions disable trigger prepare_submission;
update public.submissions set submitted_at='2026-07-06 12:00:00.123456+00' where id in(select id from photos where n in (2,3));
update public.submissions set submitted_at='2026-07-06 12:00:00.123455+00' where id in(select id from photos where n in (1,4,5));
alter table public.submissions enable trigger prepare_submission;
grant select on photos,terms to authenticated;
set local role authenticated;
select is(public.get_my_vocabulary()->>'total_concepts','4','Same spelling never collapses distinct meanings');
select is(jsonb_array_length(public.get_my_vocabulary(search_text=>'SHARED AUDIT',requested_level=>'A2')->'items'),2,'Combined search and level retain both meanings');
select is(jsonb_array_length(public.get_my_vocabulary(search_text=>'Old audit')->'items'),0,'Older matching text does not replace the latest card');
select is(public.get_my_vocabulary(requested_concept=>(select concept_id from public.submissions where id=(select id from photos where n=1)))->'items'->1->>'target_term','Old audit spelling','Old snapshot remains in detail');
select is(public.get_my_vocabulary(requested_concept=>(select concept_id from public.submissions where id=(select id from photos where n=1)))->'items'->0->>'id',(select id::text from photos where n=2),'Microseconds distinguish latest capture');
-- Walk each query with several page sizes; compare against its full bounded result.
create function pg_temp.walk(query text,level text,size integer,concept uuid default null) returns uuid[] language plpgsql as $$
declare page jsonb; ids uuid[]:='{}'; stamp timestamptz; last_id uuid; iterations integer:=0;
begin loop
 page:=public.get_my_vocabulary(concept,query,level,stamp,last_id,size);
 if jsonb_array_length(page->'items')>size then raise exception 'unbounded_page'; end if;
 ids:=ids||array(select (x->>'id')::uuid from jsonb_array_elements(page->'items') x);
 exit when not (page->>'has_more')::boolean;
 iterations:=iterations+1;if iterations>100 then raise exception 'pagination_did_not_terminate';end if;
 stamp:=(page->'items'->-1->>'submitted_at')::timestamptz;last_id:=(page->'items'->-1->>'id')::uuid;
 end loop;return ids;end;
$$;
select is(pg_temp.walk(q,l,size),array(select (x->>'id')::uuid from jsonb_array_elements(public.get_my_vocabulary(search_text=>q,requested_level=>l,page_size=>24)->'items') x),
 'Exact pagination with query '||q||', level '||coalesce(l,'all')||', size '||size)
 from (values(''::text,null::text),('shared audit','A2'),('shared audit','C2'),('Old audit',null),('%',null),('_',null)) queries(q,l) cross join generate_series(1,3) size;
select is(pg_temp.walk('',null,1,(select concept_id from public.submissions where id=(select id from photos where n=1))),array(select (x->>'id')::uuid from jsonb_array_elements(public.get_my_vocabulary(requested_concept=>(select concept_id from public.submissions where id=(select id from photos where n=1)))->'items') x),'Detail cursor preserves submillisecond timestamp precision');
select throws_ok($$select public.get_my_vocabulary(before_time=>'infinity',before_id=>gen_random_uuid())$$,'22023','invalid_history_query','Nonfinite cursor denied');
select throws_ok($$select public.get_my_vocabulary(page_size=>null)$$,'22023','invalid_history_query','Null page size cannot disable LIMIT');
select set_config('request.jwt.claim.sub','66000000-0000-4000-8000-000000000002',true);
select is(public.get_my_vocabulary(search_text=>'shared audit',requested_level=>'A2')->>'total_concepts','0','Foreign search cannot reveal public or private history');
select is(jsonb_array_length(public.get_my_vocabulary(before_time=>'2099-01-01',before_id=>(select id from photos limit 1))->'items'),0,'Foreign cursor ID confers no access');
reset role;
select set_config('request.jwt.claim.sub','66000000-0000-4000-8000-000000000001',true);
-- Learned-language settings change does not rewrite historical language or level.
update public.user_language_profiles set cefr_level='C2',timezone='America/Toronto' where user_id=auth.uid();
select is(jsonb_array_length(public.get_my_vocabulary(requested_level=>'A2')->'items'),4,'Current level and timezone do not filter out past learning');
select public.begin_submission_deletion((select id from photos where n=2));
select is(public.get_my_vocabulary(requested_concept=>(select concept_id from public.submissions where id=(select id from photos where n=1)))->'concept'->>'target_term','Old audit spelling','Deleting latest restores older snapshot and photo together');
select is(jsonb_array_length(public.get_my_vocabulary(search_text=>'shared audit')->'items'),1,'Search reflects latest surviving capture after deletion');
select is(jsonb_array_length(public.get_my_vocabulary(search_text=>'Old audit')->'items'),1,'Older surviving term becomes searchable');
select public.begin_submission_deletion((select id from photos where n=1));
select is(public.get_my_vocabulary(requested_concept=>(select concept_id from public.submissions where id=(select id from photos where n=1)))->'concept','null'::jsonb,'Last-capture deletion leaves no detail summary ghost');
-- More than one maximum page of real SQL lifecycle fixtures for one concept.
update public.user_language_profiles set cefr_level='B1',timezone='UTC' where user_id=auth.uid();
insert into photos select n,pg_temp.capture('2026-05-01'::date+n,(select id from terms where n=3)) from generate_series(6,40) n;
set local role authenticated;
select is(jsonb_array_length(public.get_my_vocabulary(requested_concept=>(select concept_id from public.submissions where id=(select id from photos where n=4)))->'items'),12,'Default detail page stays at 12 with 36 surviving captures');
select is(jsonb_array_length(public.get_my_vocabulary(requested_concept=>(select concept_id from public.submissions where id=(select id from photos where n=4)),page_size=>24)->'items'),24,'Maximum detail page stays bounded at 24');
select is(public.get_my_vocabulary(requested_concept=>(select concept_id from public.submissions where id=(select id from photos where n=4)),page_size=>24)->>'has_more','true','Large detail history signals continuation');
select is(public.get_my_vocabulary()->>'total_concepts','3','Many repetitions still produce only three surviving concepts');
select is(pg_temp.walk('',null,7,(select concept_id from public.submissions where id=(select id from photos where n=4))),array(select id from public.submissions where concept_id=(select concept_id from public.submissions where id=(select id from photos where n=4)) and status='completed' order by submitted_at desc,id desc),'All 36 captures traverse exactly once across pages');
select * from finish();rollback;
