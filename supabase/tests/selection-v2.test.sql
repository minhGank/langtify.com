begin;
select no_plan();
create function pg_temp.pool(learner text, sizes integer[]) returns uuid language plpgsql as $$
declare u uuid:=gen_random_uuid(); t uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); c uuid;
  levels text[]:=array['A1','A2','B1','B2','C1','C2']; i integer; j integer;
begin
 insert into auth.users(id,email) values(u,u::text||'@example.test');
 insert into public.languages(id,code,name,native_name) values(t,'zz-'||left(t::text,23),'Target','Target'),(r,'zz-'||left(r::text,23),'Reference','Reference');
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform public.complete_onboarding('v2_'||left(replace(u::text,'-',''),20),r,t,learner,'UTC');
 for i in 1..6 loop for j in 1..sizes[i] loop
  c:=gen_random_uuid();
  insert into public.vocabulary_concepts(id,concept_key,category,is_photographable) values(c,'V2_'||upper(replace(c::text,'-','')),'test',true);
  insert into public.vocabulary_terms(concept_id,language_id,term,cefr_level,part_of_speech)
    values(c,t,'target '||c,levels[i],'verb'),(c,r,'reference '||c,'A1','verb');
 end loop; end loop;
 return u;
end;$$;
create function pg_temp.word_levels(payload jsonb) returns text[] language sql as $$
 select array_agg(w->>'cefr_level' order by n) from jsonb_array_elements(payload->'words') with ordinality x(w,n);
$$;

select is(private.challenge_level_plan(l,array[6,6,6,6,6,6]),array[
 private.slot_level(l,'review'),private.slot_level(l,'target'),private.slot_level(l,'stretch')],l||' preferred pattern')
from unnest(array['A1','A2','B1','B2','C1','C2']) l;
select is(private.challenge_level_plan('A1',array[3,0,0,0,0,0]),array['A1','A1','A1'],'A1 fallback');
select is(private.challenge_level_plan('A1',array[1,9,0,0,0,0]),null::text[],'Never two above A1');
select is(private.challenge_level_plan('B2',array[0,0,1,2,0,0]),array['B1','B2','B2'],'Joint multiset reserves both B2 candidates');
select is(private.challenge_level_plan('C2',array[0,0,0,9,3,0]),array['C1','C1','C1'],'Avoid B2 if C1 suffices');
select is(private.challenge_level_plan('C2',array[0,0,0,9,2,0]),array['B2','C1','C1'],'Minimal C2 consolidation');
select is(private.challenge_level_plan('C2',array[0,0,0,3,0,0]),array['B2','B2','B2'],'C2 permits accurately labelled B2');
select is(private.challenge_level_plan('C2',array[0,0,9,2,0,0]),null::text[],'C2 never descends to B1');
select throws_ok($$select private.challenge_level_plan('bad',array[3,3,3,3,3,3])$$,'23514','invalid_selection_pool','Invalid learner fails');
select ok(not private.selection_level_allowed(null,'A1'),'Null learner fails closed');

create temp table cases as select l,pg_temp.pool(l,array[6,6,6,6,6,6]) u from unnest(array['A1','A2','B1','B2','C1','C2']) l;
create temp table saved(l text,payload jsonb);
do $$declare x record;begin for x in select * from cases loop
 perform set_config('request.jwt.claim.sub',x.u::text,true);
 insert into saved values(x.l,public.get_or_create_today_challenge());
end loop;end$$;
select is(pg_temp.word_levels(payload),array[private.slot_level(l,'review'),private.slot_level(l,'target'),private.slot_level(l,'stretch')],l||' RPC preferred mix') from saved;
select ok(not exists(select 1 from saved where payload->'challenge'->>'selection_policy_version'<>'2'),'New RPC challenges opt into v2');

select pg_temp.pool('B2',array[0,0,1,4,0,0]);
create temp table fallback as select public.get_or_create_today_challenge() payload;
select is(pg_temp.word_levels(payload),array['B1','B2','B2'],'RPC joint fallback') from fallback;
select is(public.get_or_create_today_challenge(),(select payload from fallback),'Retry returns saved fallback');
create temp table replacement as select public.replace_daily_challenge_word((payload->'words'->0->>'id')::uuid) payload from fallback;
select is(pg_temp.word_levels(payload),array['B2','B2','B2'],'Replacement falls back without changing other cards') from replacement;
select is((select payload->'words'->1 from fallback),(select payload->'words'->1 from replacement),'Other assignment unchanged');
select is((select count(distinct w.concept_id) from public.daily_challenge_words w where w.daily_challenge_id=(select (payload->'challenge'->>'id')::uuid from fallback)),4::bigint,'Retired concept not recycled');
select throws_ok($$select public.replace_daily_challenge_word((select (payload->'words'->0->>'id')::uuid from fallback))$$,'P0001','assignment_unavailable','Stale replacement ID denied');
select public.replace_daily_challenge_word((select (payload->'words'->0->>'id')::uuid from replacement));
create temp table exhausted as select public.get_or_create_today_challenge() payload;
select throws_ok($$select public.replace_daily_challenge_word((select (payload->'words'->0->>'id')::uuid from exhausted))$$,'P0001','insufficient_vocabulary','Exhausted replacement fails');
select is(public.get_or_create_today_challenge(),(select payload from exhausted),'Failed replacement preserves full payload');

select pg_temp.pool('A1',array[1,8,0,0,0,0]);
select throws_ok($$select public.get_or_create_today_challenge()$$,'P0001','insufficient_vocabulary','Enough total words cannot bypass stretch cap');
select is((select count(*) from public.daily_challenges where user_id=auth.uid()),0::bigint,'Shortage creates no partial day');
select pg_temp.pool('C2',array[0,0,9,3,0,0]);
select is(pg_temp.word_levels(public.get_or_create_today_challenge()),array['B2','B2','B2'],'C2 RPC consolidation labels are actual B2');

select pg_temp.pool('B2',array[0,0,0,3,0,0]);
insert into private.completed_concepts(user_id,concept_id,first_submission_id,first_completed_at)
 select auth.uid(),t.concept_id,gen_random_uuid(),clock_timestamp() from public.vocabulary_terms t
 join public.user_language_profiles p on p.target_language_id=t.language_id where p.user_id=auth.uid() limit 1;
select throws_ok($$select public.get_or_create_today_challenge()$$,'P0001','insufficient_vocabulary','Completed semantic concept cannot fill a fallback day');
select is((select count(*) from public.daily_challenges where user_id=auth.uid()),0::bigint,'Completion shortage is atomic');

-- The same-level fallback is feasible at every learner level.
select is(private.challenge_level_plan(l, array(select case when n=array_position(array['A1','A2','B1','B2','C1','C2'],l) then 3 else 0 end from generate_series(1,6) n)),array[l,l,l],l||' same-level fallback')
from unnest(array['A1','A2','B1','B2','C1','C2']) l;

-- Test final-set guard independently of the planner; a trusted insert must not
-- bypass the one-above constraint. Subtransaction catches and rolls back all rows.
create function pg_temp.invalid_mix() returns void language plpgsql as $$
declare c uuid; p public.user_language_profiles; terms uuid[];
begin
 select * into p from public.user_language_profiles where user_id=auth.uid();
 insert into public.daily_challenges(user_id,user_language_profile_id,selection_policy_version)
 values(p.user_id,p.id,2) returning id into c;
 select array_agg(id order by cefr_level,id) into terms from public.vocabulary_terms where language_id=p.target_language_id;
 insert into public.daily_challenge_words(daily_challenge_id,slot,cefr_level,vocabulary_term_id)
 values(c,'review','A1',terms[1]),(c,'target','A2',terms[2]),(c,'stretch','A2',terms[3]);
 set constraints all immediate;
end;$$;
select pg_temp.pool('A1',array[1,2,0,0,0,0]);
select throws_ok($$select pg_temp.invalid_mix()$$,'23514','invalid_selection_mix','Deferred guard rejects two above even for trusted writes');
select is((select count(*) from public.daily_challenges where user_id=auth.uid()),0::bigint,'Invalid direct mix rolls back');

-- Never-assigned concepts precede unfinished history. A completed semantic ID is
-- excluded even when its reference language becomes the target language.
select pg_temp.pool('A1',array[6,0,0,0,0,0]);
insert into public.daily_challenges(user_id,user_language_profile_id,created_at,selection_policy_version)
 select user_id,id,clock_timestamp()-interval '1 day',2 from public.user_language_profiles where user_id=auth.uid();
select private.assign_challenge_set(id) from public.daily_challenges where user_id=auth.uid();
create temp table fresh as select public.get_or_create_today_challenge() payload;
select is((select count(*) from public.daily_challenge_words w join public.daily_challenges c on c.id=w.daily_challenge_id where c.user_id=auth.uid()),6::bigint,'Both days have three assignments');
select is((select count(distinct w.concept_id) from public.daily_challenge_words w join public.daily_challenges c on c.id=w.daily_challenge_id where c.user_id=auth.uid()),6::bigint,'Never-assigned concepts precede unfinished history');
-- Retire today by testing another future trusted day; all six unfinished concepts
-- remain eligible, and the oldest three come back first.
insert into public.daily_challenges(user_id,user_language_profile_id,created_at,selection_policy_version)
 select user_id,id,clock_timestamp()+interval '1 day',2 from public.user_language_profiles where user_id=auth.uid();
select private.assign_challenge_set(id) from public.daily_challenges where user_id=auth.uid() and local_challenge_date=(now() at time zone 'UTC')::date+1;
select is((select count(*) from public.daily_challenge_words w join public.daily_challenges c on c.id=w.daily_challenge_id where c.user_id=auth.uid() and c.local_challenge_date=(now() at time zone 'UTC')::date+1 and w.concept_id in(select h.concept_id from public.daily_challenge_words h join public.daily_challenges d on d.id=h.daily_challenge_id where d.user_id=auth.uid() and d.local_challenge_date=(now() at time zone 'UTC')::date-1)),3::bigint,'Oldest unfinished concepts return');

select pg_temp.pool('A1',array[4,0,0,0,0,0]);
insert into private.completed_concepts(user_id,concept_id,first_submission_id,first_completed_at)
 select auth.uid(),t.concept_id,gen_random_uuid(),clock_timestamp() from public.vocabulary_terms t join public.user_language_profiles p on p.target_language_id=t.language_id where p.user_id=auth.uid() limit 1;
update public.user_language_profiles set target_language_id=reference_language_id,reference_language_id=target_language_id where user_id=auth.uid();
select public.get_or_create_today_challenge();
select is((select count(*) from public.daily_challenge_words w join public.daily_challenges c on c.id=w.daily_challenge_id join private.completed_concepts d on d.user_id=c.user_id and d.concept_id=w.concept_id where c.user_id=auth.uid()),0::bigint,'Completion exclusion follows semantic identity across languages');
select throws_ok($$update public.daily_challenges set selection_policy_version=1 where user_id=auth.uid()$$,'23514','challenge_snapshot_immutable','Saved selection version is immutable');

-- A replacement cannot consume a second above-level word while the first remains.
select pg_temp.pool('A1',array[2,5,0,0,0,0]);
create temp table capped as select public.get_or_create_today_challenge() payload;
select throws_ok($$select public.replace_daily_challenge_word((select (payload->'words'->0->>'id')::uuid from capped))$$,'P0001','insufficient_vocabulary','Replacement preserves one-above cap');
select is(public.get_or_create_today_challenge(),(select payload from capped),'Cap shortage preserves assignments');

-- C2 consolidation is a fallback, including replacement after catalog expansion.
select pg_temp.pool('C2',array[0,0,0,4,1,0]);
update public.vocabulary_terms set is_active=false where language_id=(select target_language_id from public.user_language_profiles where user_id=auth.uid()) and cefr_level='C1';
create temp table consolidation as select public.get_or_create_today_challenge() payload;
update public.vocabulary_terms set is_active=true where language_id=(select target_language_id from public.user_language_profiles where user_id=auth.uid()) and cefr_level='C1';
select is(pg_temp.word_levels(public.replace_daily_challenge_word((select (payload->'words'->0->>'id')::uuid from consolidation))),array['C1','B2','B2'],'C2 replacement prefers newly available C1 over another B2');

select pg_temp.pool('B2',array[0,0,0,3,0,0]);
update public.vocabulary_concepts set is_photographable=false where id=(select t.concept_id from public.vocabulary_terms t join public.user_language_profiles p on p.target_language_id=t.language_id where p.user_id=auth.uid() limit 1);
select throws_ok($$select public.get_or_create_today_challenge()$$,'P0001','insufficient_vocabulary','Nonphotographable concepts cannot fill fallback');
select pg_temp.pool('B2',array[0,0,0,3,0,0]);
update public.vocabulary_terms set is_active=false where id=(select t.id from public.vocabulary_terms t join public.user_language_profiles p on p.reference_language_id=t.language_id where p.user_id=auth.uid() limit 1);
select throws_ok($$select public.get_or_create_today_challenge()$$,'P0001','insufficient_vocabulary','Inactive reference translation cannot fill fallback');
select pg_temp.pool('B2',array[0,0,0,3,0,0]);
update public.vocabulary_terms set is_active=false where id=(select t.id from public.vocabulary_terms t join public.user_language_profiles p on p.target_language_id=t.language_id where p.user_id=auth.uid() limit 1);
select throws_ok($$select public.get_or_create_today_challenge()$$,'P0001','insufficient_vocabulary','Inactive target translation cannot fill fallback');

select ok(not has_function_privilege('authenticated','private.assign_challenge_set(uuid,text,text)','EXECUTE'),'Client cannot choose policy/levels');
select ok(not has_function_privilege('anon','private.challenge_level_plan(text,integer[])','EXECUTE'),'Anonymous planner denied');
select ok(not has_function_privilege('service_role','private.assign_challenge_set(uuid,text,text)','EXECUTE'),'No new service RPC authority');
select ok(has_function_privilege('authenticated','public.get_or_create_today_challenge()','EXECUTE'),'Existing RPC permissions retained');
set constraints all immediate;
select * from finish();
rollback;
