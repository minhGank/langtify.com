begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Literal expected boundaries independently specify the approved early curve.
create temporary table levels(level integer,start_xp bigint,next_xp bigint);
insert into levels values (1,0,40),(2,40,100),(3,100,180),(4,180,280),(5,280,400),
  (6,400,540),(7,540,700),(8,700,880),(9,880,1080),(10,1080,1300);
create temporary table totals as select xp, l.* from
  unnest(array[0,39,40,41,99,100,101,120,179,180,181,279,280,399,400,539,540,620,699,700,879,880,1079,1080]) xp
  join levels l on xp>=start_xp and xp<next_xp;
select is(private.level_progress(xp),jsonb_build_object(
  'level',level,'level_start_xp',start_xp,'next_level_xp',next_xp,
  'xp_into_level',xp-start_xp,'xp_for_next_level',next_xp-start_xp),
  'Exact level, thresholds and within-level progress at '||xp||' XP') from totals;
select is((private.level_progress(xp)->>'next_level_xp')::bigint-xp,next_xp-xp,
  'Exact remaining XP at '||xp) from totals;
-- Higher levels are not capped. Arithmetic remains exact across JS safe-integer
-- and PostgreSQL bigint boundaries, including a next threshold beyond bigint.
select is((private.level_progress((10::numeric*(l-1)*(l+2)+delta)::bigint)->>'level')::integer,
  l-case when delta=-1 then 1 else 0 end,'High-level boundary '||l||' offset '||delta)
  from unnest(array[11,100,1000,1000000,30000000,100000000,960000000]) l
  cross join unnest(array[-1,0,1]) delta;
select ok((p->>'level_start_xp')::numeric<=xp and (p->>'next_level_xp')::numeric>xp
  and (p->>'xp_into_level')::numeric=xp-(p->>'level_start_xp')::numeric
  and (p->>'xp_for_next_level')::numeric=(p->>'next_level_xp')::numeric-(p->>'level_start_xp')::numeric,
  'Exact interval at large total '||xp)
  from unnest(array[9007199254740991,9007199254740992,9223372036854775807]::bigint[]) xp
  cross join lateral (select private.level_progress(xp) p) result;
select throws_ok($$select private.level_progress(-1)$$,'P0001','invalid_xp_total','Negative total rejected');
select throws_ok($$select private.level_progress(null)$$,'P0001','invalid_xp_total','Null total rejected');
select ok(not has_function_privilege('authenticated','private.level_progress(bigint)','execute'),
  'Level helper grants no client authority');
select ok(not has_function_privilege('anon','private.level_progress(bigint)','execute'),
  'Level helper grants no anonymous authority');
-- Rollback-only trusted ledger fixture: exercise read-time multi-level changes
-- without rewriting immutable events or adding any client award capability.
insert into auth.users(id,email) values('32000000-0000-4000-8000-000000000001','qa32@example.test');
select set_config('request.jwt.claim.sub','32000000-0000-4000-8000-000000000001',true);
select public.complete_onboarding('qa32_levels','00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002','B1','UTC');
select is(public.get_my_progress()->>'level','1','New authenticated profile begins at Level 1');
select private.set_xp_award(auth.uid(),'WORD_COMPLETED','qa32:word:'||i,10,true,gen_random_uuid()) from generate_series(1,4) i;
select is(public.get_my_progress()->>'level','2','New XP crosses exactly one level threshold');
select private.set_xp_award(auth.uid(),'STREAK_MILESTONE','qa32:milestone',200,true,gen_random_uuid());
select is(public.get_my_progress()->>'level','4','One new XP event can cross multiple thresholds');
select is(public.get_public_profile()->'profile'->>'level','4','Public and private multi-level progress agree');
select private.set_xp_award(auth.uid(),'STREAK_MILESTONE','qa32:milestone',200,false,gen_random_uuid());
select is(public.get_my_progress()->>'level','2','Signed reversal decreases multiple levels');
select private.set_xp_award(auth.uid(),'STREAK_MILESTONE','qa32:milestone',200,true,gen_random_uuid());
select is(public.get_my_progress()->>'level','4','Restoration derives the same level from net XP');
select is(public.get_my_progress()->>'total_xp','240','Restoration never adds positive-only lifetime XP');
select * from finish();
rollback;
