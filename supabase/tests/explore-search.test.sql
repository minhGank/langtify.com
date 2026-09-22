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
insert into auth.users(id,email) values
 ('7d000000-0000-4000-8000-000000000001','explore_owner@example.test'),
 ('7d000000-0000-4000-8000-000000000002','explore_viewer@example.test'),
 ('7d000000-0000-4000-8000-000000000003','explore_other@example.test');
select set_config('request.jwt.claim.sub','7d000000-0000-4000-8000-000000000001',true);
select public.complete_onboarding('explore_owner','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','A1','UTC');
select set_config('request.jwt.claim.sub','7d000000-0000-4000-8000-000000000002',true);
select public.complete_onboarding('explore_viewer','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','A1','UTC');
select set_config('request.jwt.claim.sub','7d000000-0000-4000-8000-000000000003',true);
select public.complete_onboarding('explore_other','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','A1','UTC');
insert into public.vocabulary_concepts(id,concept_key,category,is_photographable) values
 ('7d100000-0000-4000-8000-000000000001','EXPLORE_CHIEN','test',true),
 ('7d100000-0000-4000-8000-000000000002','EXPLORE_CHIEN_TWO','test',true),
 ('7d100000-0000-4000-8000-000000000003','EXPLORE_WINDOW','test',true),
 ('7d100000-0000-4000-8000-000000000004','EXPLORE_INACTIVE','test',true),
 ('7d100000-0000-4000-8000-000000000005','EXPLORE_ABSTRACT','test',false),
 ('7d100000-0000-4000-8000-000000000006','EXPLORE_MISSING_REFERENCE','test',true);
insert into public.vocabulary_terms(concept_id,language_id,term,cefr_level,part_of_speech) values
 ('7d100000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','le qachien','A1','noun'),
 ('7d100000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','le qachien','A2','noun'),
 ('7d100000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002','la qafenêtre','B1','noun'),
 ('7d100000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000002','le qachien inactif','A1','noun'),
 ('7d100000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000002','le qachien abstrait','A1','noun'),
 ('7d100000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000002','le qachien sans référence','A1','noun'),
 ('7d100000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','the qadog','A1','noun'),
 ('7d100000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','the qadog separate meaning','A1','noun'),
 ('7d100000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','the qawindow','A1','noun'),
 ('7d100000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','the inactive qadog','A1','noun'),
 ('7d100000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000001','the abstract qadog','A1','noun');
update public.vocabulary_concepts set is_active=false where id='7d100000-0000-4000-8000-000000000004';
create temporary table photos(n integer,id uuid);
create function pg_temp.capture(day_offset integer,which_visibility text default 'public') returns uuid language plpgsql as $$
declare challenge public.daily_challenges;learning public.user_language_profiles;assignment uuid;s public.submissions;o storage.objects;
begin
 select * into learning from public.user_language_profiles where user_id=auth.uid();
 insert into public.daily_challenges(user_id,user_language_profile_id,target_language_id,reference_language_id,cefr_level,timezone,local_challenge_date,created_at)
 values(auth.uid(),learning.id,learning.target_language_id,learning.reference_language_id,learning.cefr_level,learning.timezone,current_date-day_offset,statement_timestamp()-make_interval(days=>day_offset)) returning * into challenge;
 insert into public.daily_challenge_words(daily_challenge_id,slot,cefr_level,vocabulary_term_id,concept_id,reference_term_id,target_term,reference_term)
 select challenge.id,'review','A1',t.id,t.concept_id,r.id,t.term,r.term from public.vocabulary_terms t join public.vocabulary_terms r using(concept_id)
 where t.concept_id='7d100000-0000-4000-8000-000000000001' and t.language_id=learning.target_language_id and r.language_id=learning.reference_language_id returning id into assignment;
 perform private.assign_challenge_word(challenge.id,'target');
 perform private.assign_challenge_word(challenge.id,'stretch');
 s:=pg_temp.reserve_daily_fixture(assignment);
 insert into storage.objects(bucket_id,name,owner_id,version,metadata) values('challenge-submissions',s.storage_path,s.user_id::text,'explore-fixture','{"mimetype":"image/jpeg","size":100}') returning * into o;
 perform public.attest_submission_photo(s.id,s.user_id,o.id,o.version,repeat('a',64),16,16);
 perform public.finalize_submission(s.id,which_visibility);return s.id;
end;$$;
-- Pin the tested review concept; remaining slots use the authoritative selector.
select set_config('request.jwt.claim.sub','7d000000-0000-4000-8000-000000000001',true);
insert into photos values(1,pg_temp.capture(4)),(2,pg_temp.capture(3)),(3,pg_temp.capture(2,'private'));
select set_config('request.jwt.claim.sub','7d000000-0000-4000-8000-000000000003',true);
insert into photos values(4,pg_temp.capture(4));
set constraints all immediate;
set constraints all deferred;
alter table public.submissions disable trigger prepare_submission;
update public.submissions set submitted_at='2026-09-20T12:00:00.123456Z' where id in(select id from photos);
alter table public.submissions enable trigger prepare_submission;
create temporary table pages(payload jsonb);
grant select on photos,pages to authenticated;
grant insert,delete on pages to authenticated;
select set_config('request.jwt.claim.sub','7d000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select is(jsonb_array_length(public.search_vocabulary_terms('qachien')->'items'),2,'Token prefix inside a phrase finds both separate concepts and excludes inactive, abstract and untranslated catalog entries');
select is(jsonb_array_length(public.search_vocabulary_terms('  QACHI  ')->'items'),2,'Search trims input and is case-insensitive');
select is(jsonb_array_length(public.search_vocabulary_terms('le qachi')->'items'),2,'Multiword search requires every parsed prefix');
select is(jsonb_array_length(public.search_vocabulary_terms('qachi | nonexistent')->'items'),0,'Caller tsquery operators cannot broaden token matching');
select is(jsonb_array_length(public.search_vocabulary_terms('qafenê')->'items'),1,'Accented Unicode term prefixes resolve');
select is(jsonb_array_length(public.search_vocabulary_terms('qadog')->'items'),0,'Reference-language words are not target-language matches');
select is(public.search_vocabulary_terms('qachien')->>'reference_language_id','00000000-0000-4000-8000-000000000001','Reference language comes from persisted learning settings');
select is(public.search_vocabulary_terms('qachien')->'items'->0->>'reference_term','the qadog','Translation follows concept identity');
insert into pages values(public.search_vocabulary_terms('qachien',page_size=>1));
select is((select payload->>'has_more' from pages),'true','Word search page has a bounded lookahead');
select is((select payload->'items'->0->>'concept_id' from pages),'7d100000-0000-4000-8000-000000000001','Identical terms use ascending concept UUID tie break');
select is((select public.search_vocabulary_terms('qachien',payload->'items'->0->>'target_term',(payload->'items'->0->>'concept_id')::uuid,1)->'items'->0->>'concept_id' from pages),'7d100000-0000-4000-8000-000000000002','Word keyset does not skip or duplicate identical terms');
select is(jsonb_array_length(public.search_vocabulary_terms('notpresentqa')->'items'),0,'Unknown words return an empty page');
select throws_ok($$select public.search_vocabulary_terms('a')$$,'22023','invalid_vocabulary_search','Single-character search is rejected');
select throws_ok($$select public.search_vocabulary_terms(repeat('a',65))$$,'22023','invalid_vocabulary_search','Search input length is bounded');
select throws_ok($$select public.search_vocabulary_terms('%%')$$,'22023','invalid_vocabulary_search','Wildcard-only input cannot issue an unrestricted search');
select throws_ok($$select public.search_vocabulary_terms('a b c d e f g h i')$$,'22023','invalid_vocabulary_search','Query token complexity is bounded');
select throws_ok($$select public.search_vocabulary_terms('qa',page_size=>25)$$,'22023','invalid_vocabulary_search','Word page is bounded');
select throws_ok($$select public.search_vocabulary_terms('qa',before_id=>gen_random_uuid())$$,'22023','invalid_vocabulary_search','Incomplete word cursor is denied');
select is(public.get_explore_concept('7d100000-0000-4000-8000-000000000001')->'item'->>'target_term','le qachien','Concept read resolves saved target phrase');
select is(public.get_explore_concept('7d100000-0000-4000-8000-000000000004')->'item','null'::jsonb,'Inactive concept details are unavailable');
select is(public.get_explore_concept(gen_random_uuid())->'item','null'::jsonb,'Unknown concept is a safe empty detail');
select throws_ok($$select public.get_explore_concept(null)$$,'22023','invalid_explore_concept','Missing concept is denied');
select is(jsonb_array_length(public.get_concept_submissions('7d100000-0000-4000-8000-000000000001')->'items'),3,'Concept examples contain only public verified captures');
select is((select count(*) from public.submissions),0::bigint,'New read RPCs preserve owner-only raw submission RLS');
select ok(not (public.get_concept_submissions('7d100000-0000-4000-8000-000000000001')->'items'->0 ?| array['owner_id','user_id','email','storage_path','daily_challenge_word_id']),'Examples expose only minimized feed fields');
delete from pages;
insert into pages values(public.get_concept_submissions('7d100000-0000-4000-8000-000000000001',page_size=>1));
select is((select payload->>'has_more' from pages),'true','Photo examples have bounded lookahead');
select is((select payload->'items'->0->>'id' from pages),(select id::text from photos where n<>3 order by id desc limit 1),'Example order breaks timestamp ties by UUID');
select is((select public.get_concept_submissions('7d100000-0000-4000-8000-000000000001',(payload->'items'->0->>'submitted_at')::timestamptz,(payload->'items'->0->>'id')::uuid,1)->'items'->0->>'id' from pages),(select id::text from photos where n<>3 order by id desc offset 1 limit 1),'Photo keyset does not skip or duplicate timestamp ties');
select is(jsonb_array_length(public.get_concept_submissions('7d100000-0000-4000-8000-000000000002')->'items'),0,'Separate concept with identical target phrase does not borrow examples');
select throws_ok($$select public.get_concept_submissions(gen_random_uuid(),page_size=>25)$$,'22023','invalid_concept_feed_query','Example page size is bounded');
select throws_ok($$select public.get_concept_submissions(gen_random_uuid(),before_id=>gen_random_uuid())$$,'22023','invalid_concept_feed_query','Incomplete example cursor is denied');
select throws_ok($$select public.get_concept_submissions(gen_random_uuid(),'infinity',gen_random_uuid())$$,'22023','invalid_concept_feed_query','Nonfinite photo cursor is denied');
select is(jsonb_array_length(public.get_discover_submission((select id from photos where n=3))->'items'),0,'Direct post entry cannot read a private submission');
select is(jsonb_array_length(public.get_discover_submission(gen_random_uuid())->'items'),0,'Unknown post entry safely returns empty');
select is(jsonb_array_length(public.get_discover_submission((select id from photos where n=1))->'items'),1,'Eligible direct post entry returns one item');
select public.rate_submission((select id from photos where n=1),4);
select is(public.get_discover_submission((select id from photos where n=1))->'items'->0->>'viewer_rating','4','Direct entry includes only current viewer score');
select is(public.get_discover_submission((select id from photos where n=1))->'items'->0->>'rating_count','1','Direct entry rating aggregate is authoritative');
select public.set_follow((select id from jsonb_to_recordset(public.search_public_profiles('explore_owner')->'items') as x(id uuid)),true);
select is(public.search_public_profiles('explore_owner')->'items'->0->>'is_following','true','People search includes confirmed current follow state');
select is(public.search_public_profiles('explore_viewer')->'items'->0->>'is_self','true','People search identifies own profile without Auth UUID');
select ok(not(public.search_public_profiles('explore_owner')->'items'->0 ?| array['email','user_id','owner_id','id_token']),'People search adds no private identity fields');
select public.block_public_profile((select id from jsonb_to_recordset(public.search_public_profiles('explore_owner')->'items') as x(id uuid)));
select is(jsonb_array_length(public.get_concept_submissions('7d100000-0000-4000-8000-000000000001')->'items'),1,'Blocked owner examples disappear');
select is(jsonb_array_length(public.get_discover_submission((select id from photos where n=1))->'items'),0,'Blocked owner direct post is unavailable');
select is(jsonb_array_length(public.search_public_profiles('explore_owner')->'items'),0,'Blocked person disappears from search');
select set_config('request.jwt.claim.sub','7d000000-0000-4000-8000-000000000001',true);
select is(public.get_discover_submission((select id from photos where n=1))->'items'->0->>'can_rate','false','Owner direct entry cannot self-rate');
select is(public.get_discover_submission((select id from photos where n=1))->'items'->0->'viewer_rating','null'::jsonb,'Account switch never returns another viewer score');
reset role;
delete from public.user_blocks where blocker_user_id='7d000000-0000-4000-8000-000000000002';
update public.vocabulary_terms set term='renamed qachien' where concept_id='7d100000-0000-4000-8000-000000000001' and language_id='00000000-0000-4000-8000-000000000002';
select is(public.get_explore_concept('7d100000-0000-4000-8000-000000000001')->'item'->>'target_term','renamed qachien','Catalog detail reflects maintained live term');
select is(public.get_discover_submission((select id from photos where n=1))->'items'->0->>'target_term','le qachien','Historical example snapshot survives catalog edits');
insert into private.submission_moderation(submission_id,removed) values((select id from photos where n=1),true);
select is(jsonb_array_length(public.get_discover_submission((select id from photos where n=1))->'items'),0,'Removed post cannot be resolved directly');
select is(jsonb_array_length(public.get_concept_submissions('7d100000-0000-4000-8000-000000000001')->'items'),2,'Removed post excluded from concept examples');
select public.begin_submission_deletion((select id from photos where n=2));
select is(jsonb_array_length(public.get_discover_submission((select id from photos where n=2))->'items'),0,'Deleting post cannot be resolved directly');
select set_config('request.jwt.claim.sub','7d000000-0000-4000-8000-000000000002',true);
update private.safety_accounts set restricted=true where user_id='7d000000-0000-4000-8000-000000000003';
select is(jsonb_array_length(public.get_concept_submissions('7d100000-0000-4000-8000-000000000001')->'items'),0,'Restricted owners cannot supply public examples');
update private.safety_accounts set restricted=false where user_id='7d000000-0000-4000-8000-000000000003';
update public.user_language_profiles set target_language_id='00000000-0000-4000-8000-000000000001',reference_language_id='00000000-0000-4000-8000-000000000002' where user_id=auth.uid();
select is(public.get_explore_concept('7d100000-0000-4000-8000-000000000001')->'item'->>'target_term','the qadog','Concept detail derives switched target language');
select is(jsonb_array_length(public.search_vocabulary_terms('qachien')->'items'),0,'Target changes invalidate old target search matches');
select is(jsonb_array_length(public.get_concept_submissions('7d100000-0000-4000-8000-000000000001')->'items'),0,'Concept examples use current saved target language');
select is(jsonb_array_length(public.get_discover_submission((select id from photos where n=4))->'items'),0,'Direct entry cannot bypass saved target language');
update private.safety_accounts set restricted=true where user_id=auth.uid();
select throws_ok($$select public.search_vocabulary_terms('qadog')$$,'42501','feed_unavailable','Restricted viewer cannot use Explore');
select throws_ok($$select public.get_explore_concept(gen_random_uuid())$$,'42501','feed_unavailable','Restricted viewer cannot use direct concept entry');
select throws_ok($$select public.get_concept_submissions(gen_random_uuid())$$,'42501','feed_unavailable','Restricted viewer cannot use example reads');
select throws_ok($$select public.get_discover_submission(gen_random_uuid())$$,'42501','feed_unavailable','Restricted viewer cannot use direct post reads');
set local role anon;
select throws_ok($$select public.search_vocabulary_terms('qa')$$,'42501',null,'Anonymous catalog search denied');
select throws_ok($$select public.get_explore_concept(gen_random_uuid())$$,'42501',null,'Anonymous concept detail denied');
select throws_ok($$select public.get_concept_submissions(gen_random_uuid())$$,'42501',null,'Anonymous example feed denied');
select throws_ok($$select public.get_discover_submission(gen_random_uuid())$$,'42501',null,'Anonymous post entry denied');
reset role;
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc where oid in('public.search_vocabulary_terms(text,text,uuid,integer)'::regprocedure,'public.get_explore_concept(uuid)'::regprocedure,'public.get_concept_submissions(uuid,timestamptz,uuid,integer)'::regprocedure,'public.get_discover_submission(uuid)'::regprocedure)),'Explore RPCs use hardened definer search paths');
select is((select public from storage.buckets where id='challenge-submissions'),false,'Explore never makes photo storage public');
select * from finish();
rollback;
