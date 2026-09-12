begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

select is((select count(*) from public.vocabulary_concepts)::integer,36,'Modest seed contains 36 semantic concepts');
select is((select count(*) from public.vocabulary_terms)::integer,72,'Two linked language terms per development concept');
select ok((select bool_and(is_photographable) from public.vocabulary_concepts),'All development challenge concepts are photographable');
select is((select count(distinct concept_id) from public.vocabulary_terms where term='bank')::integer,2,'Financial bank and river bank retain separate meanings');
select is((select count(*) from public.vocabulary_terms t join public.vocabulary_concepts c on c.id=t.concept_id where c.concept_key='DOG')::integer,2,'DOG links English and French');
select is((select count(distinct cefr_level) from public.vocabulary_terms t join public.vocabulary_concepts c on c.id=t.concept_id where c.concept_key='ALLEY')::integer,2,'CEFR can differ across languages');
select throws_ok($$insert into public.vocabulary_terms(concept_id,language_id,term,cefr_level,part_of_speech) select concept_id,language_id,'alternate spelling',cefr_level,part_of_speech from public.vocabulary_terms limit 1$$,'23505',null,'A concept/language cannot have duplicate primary terms');
select is(private.challenge_date('Pacific/Kiritimati','2026-01-01 11:30:00+00'),'2026-01-02'::date,'Positive timezone crosses the UTC date boundary');
select is(private.challenge_date('Pacific/Honolulu','2026-01-01 01:00:00+00'),'2025-12-31'::date,'Negative timezone crosses the UTC date boundary');
select is(private.challenge_date('America/Toronto','2026-03-08 07:01:00+00'),'2026-03-08'::date,'DST spring transition uses named timezone rules');
select is(private.challenge_date('America/Toronto','2026-11-01 06:01:00+00'),'2026-11-01'::date,'DST repeated hour keeps the same local date');

create temporary table cases(user_id uuid,level text,payload jsonb);
insert into cases(user_id,level) values
 ('30000000-0000-4000-8000-000000000001','A1'),
 ('30000000-0000-4000-8000-000000000002','A2'),
 ('30000000-0000-4000-8000-000000000003','B1'),
 ('30000000-0000-4000-8000-000000000004','B2'),
 ('30000000-0000-4000-8000-000000000005','C1'),
 ('30000000-0000-4000-8000-000000000006','C2');
insert into auth.users(id,email) select user_id,user_id::text||'@example.test' from cases;
do $$ declare c record; begin
  for c in select * from cases loop
    perform set_config('request.jwt.claim.sub',c.user_id::text,true);
    perform public.complete_onboarding('phase3_'||lower(c.level),'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',c.level,'Pacific/Kiritimati');
    update cases set payload=public.get_or_create_today_challenge() where user_id=c.user_id;
  end loop;
end $$;
select is((select string_agg(w->>'cefr_level','/' order by ord) from cases,jsonb_array_elements(payload->'words') with ordinality a(w,ord) where level='A1'),'A1/A1/A2','A1 boundary');
select is((select string_agg(w->>'cefr_level','/' order by ord) from cases,jsonb_array_elements(payload->'words') with ordinality a(w,ord) where level='A2'),'A1/A2/B1','A2 slots');
select is((select string_agg(w->>'cefr_level','/' order by ord) from cases,jsonb_array_elements(payload->'words') with ordinality a(w,ord) where level='B1'),'A2/B1/B2','B1 slots');
select is((select string_agg(w->>'cefr_level','/' order by ord) from cases,jsonb_array_elements(payload->'words') with ordinality a(w,ord) where level='B2'),'B1/B2/C1','B2 slots');
select is((select string_agg(w->>'cefr_level','/' order by ord) from cases,jsonb_array_elements(payload->'words') with ordinality a(w,ord) where level='C1'),'B2/C1/C2','C1 slots');
select is((select string_agg(w->>'cefr_level','/' order by ord) from cases,jsonb_array_elements(payload->'words') with ordinality a(w,ord) where level='C2'),'C1/C2/C2','C2 boundary');
select ok(not exists(select 1 from public.daily_challenges c join public.daily_challenge_words w on w.daily_challenge_id=c.id group by c.id having count(distinct w.concept_id)<>3),'All initial challenges use three distinct concepts');
select ok(not exists(select 1 from public.daily_challenge_words w join public.daily_challenges c on c.id=w.daily_challenge_id join public.vocabulary_terms t on t.id=w.vocabulary_term_id join public.vocabulary_terms r on r.id=w.reference_term_id where t.language_id<>c.target_language_id or r.language_id<>c.reference_language_id or t.concept_id<>r.concept_id or w.cefr_level<>t.cefr_level or w.target_term<>t.term or w.reference_term<>r.term),'Exact target/reference linkage and text come from a shared concept');
select ok(not exists(select 1 from public.daily_challenges where local_challenge_date <> private.challenge_date(timezone,created_at)),'RPC derives dates from server time and saved timezone');
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000001',true);
select is(public.get_or_create_today_challenge(),(select payload from cases where level='A1'),'Same-day retry returns the identical saved challenge');
select is((select count(*) from public.daily_challenges where user_id=auth.uid())::integer,1,'Same-day retry does not create another challenge');

-- Snapshot settings and term text survive subsequent administrative/catalog changes.
update public.user_language_profiles set cefr_level='C2',target_language_id='00000000-0000-4000-8000-000000000001',reference_language_id='00000000-0000-4000-8000-000000000002' where user_id=auth.uid();
select is(public.get_or_create_today_challenge(),(select payload from cases where level='A1'),'Same local day retains original configuration after profile changes');
update public.vocabulary_terms set term=term||' [edited]' where id=(select (payload->'words'->0->>'vocabulary_term_id')::uuid from cases where level='A1');
select is(public.get_or_create_today_challenge(),(select payload from cases where level='A1'),'Existing card text does not change with catalog edits');
update public.user_language_profiles set timezone='UTC' where user_id=auth.uid();
select is((select timezone from public.daily_challenges where user_id=auth.uid()),'Pacific/Kiritimati','Timezone changes cannot rewrite historical challenge configuration');
update public.user_language_profiles set timezone='Pacific/Kiritimati' where user_id=auth.uid();
create temporary table replaced as select (payload->'words'->0->>'id')::uuid old_id, public.replace_daily_challenge_word((payload->'words'->0->>'id')::uuid) payload from cases where level='A1';
select ok((select replaced_at is not null from public.daily_challenge_words where id=(select old_id from replaced)),'Replacement preserves the old assignment as history');
select is((select payload->'words'->0->>'cefr_level' from replaced),'A1','Replacement retains original slot level after settings change');
select is((select payload->'challenge'->>'target_language_id' from replaced),'00000000-0000-4000-8000-000000000002','Replacement retains original target language');
select isnt((select payload->'words'->0->>'concept_id' from replaced),(select payload->'words'->0->>'concept_id' from cases where level='A1'),'Replacement selects a different concept');
select throws_ok($$select public.replace_daily_challenge_word((select old_id from replaced))$$,'P0001','assignment_unavailable','Retrying a replaced ID cannot replace it again');
select lives_ok($$select public.replace_daily_challenge_word((select (payload->'words'->0->>'id')::uuid from replaced))$$,'Repeated replacements using the current active ID are allowed');
select is((select count(*) from public.daily_challenge_words w join public.daily_challenges c on c.id=w.daily_challenge_id where c.user_id=auth.uid() and w.replaced_at is null)::integer,3,'Repeated replacement leaves exactly three active words');
select is((select count(*) from public.daily_challenge_words w join public.daily_challenges c on c.id=w.daily_challenge_id where c.user_id=auth.uid())::integer,5,'Each replacement adds history');
select throws_ok($$update public.daily_challenge_words set target_term='forged' where id=(select old_id from replaced)$$,'23514','assignment_history_immutable','Retired assignment snapshots are immutable');
select throws_ok($$update public.daily_challenges set local_challenge_date=local_challenge_date+1 where user_id=auth.uid()$$,'23514','challenge_snapshot_immutable','Challenge snapshots cannot be rewritten');
set constraints all immediate;
select throws_ok($$delete from public.daily_challenge_words where id=(select w.id from public.daily_challenge_words w join public.daily_challenges c on c.id=w.daily_challenge_id where c.user_id=auth.uid() and w.replaced_at is null limit 1)$$,'23514','assignment_history_immutable','Cannot delete an assignment from a retained challenge');
set constraints all deferred;

-- RLS/privilege checks use actual ordinary roles, never owner privileges.
set local role authenticated;
select is((select count(*) from public.daily_challenges)::integer,1,'A reads only A challenge');
select is((select count(*) from public.daily_challenge_words)::integer,5,'A reads own history including replacements');
select lives_ok($$select * from public.vocabulary_concepts$$,'Authenticated catalog reads allowed');
select throws_ok($$insert into public.vocabulary_concepts(concept_key,category) values('UNAUTHORIZED','test')$$,'42501',null,'Catalog concept insert denied');
select throws_ok($$update public.vocabulary_concepts set is_active=false$$,'42501',null,'Catalog concept update denied');
select throws_ok($$delete from public.vocabulary_concepts$$,'42501',null,'Catalog concept delete denied');
select throws_ok($$insert into public.vocabulary_terms(term) values('forged')$$,'42501',null,'Catalog term insert denied');
select throws_ok($$update public.vocabulary_terms set term='forged'$$,'42501',null,'Catalog term update denied');
select throws_ok($$delete from public.vocabulary_terms$$,'42501',null,'Catalog term delete denied');
select throws_ok($$insert into public.daily_challenges(user_id) values(auth.uid())$$,'42501',null,'Direct challenge creation denied');
select throws_ok($$update public.daily_challenges set local_challenge_date=current_date-1$$,'42501',null,'Direct challenge date changes denied');
select throws_ok($$delete from public.daily_challenges$$,'42501',null,'Challenge deletion denied');
select throws_ok($$insert into public.daily_challenge_words(slot) values('review')$$,'42501',null,'Direct assignment creation denied');
select throws_ok($$update public.daily_challenge_words set cefr_level='C2',vocabulary_term_id=gen_random_uuid(),replaced_at=now()$$,'42501',null,'Direct level, term and history changes denied');
select throws_ok($$delete from public.daily_challenge_words$$,'42501',null,'Assignment history deletion denied');
reset role;
grant select on cases to authenticated;
set local role authenticated;
select throws_ok($$select public.replace_daily_challenge_word((select (payload->'words'->0->>'id')::uuid from cases where level='B1'))$$,'P0001','assignment_unavailable','Cross-user replacement denied without revealing assignment state');
select is((select count(*) from public.daily_challenges where user_id='30000000-0000-4000-8000-000000000003')::integer,0,'Cross-user challenge reads hidden');
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select public.get_or_create_today_challenge()$$,'42501','authentication_required','Missing JWT subject denied');
set local role anon;
select throws_ok($$select public.get_or_create_today_challenge()$$,'42501',null,'Anonymous creation RPC denied');
select throws_ok($$select public.replace_daily_challenge_word(gen_random_uuid())$$,'42501',null,'Anonymous replacement RPC denied');
select throws_ok($$select * from public.daily_challenges$$,'42501',null,'Anonymous challenge read denied');
select throws_ok($$select * from public.daily_challenge_words$$,'42501',null,'Anonymous history read denied');
select throws_ok($$select * from public.vocabulary_terms$$,'42501',null,'Anonymous vocabulary read denied');
reset role;
select ok(not has_function_privilege('authenticated','private.assign_challenge_word(uuid,text)','execute'),'Private selection helper is not callable');
select ok(not has_function_privilege('anon','private.challenge_payload(uuid)','execute'),'Private payload reader is not callable');

-- Privileged identity maintenance must not turn a linked row into cross-user RPC access.
insert into auth.users(id,email) values('30000000-0000-4000-8000-000000000009','transferred@example.test');
update public.profiles set onboarding_completed_at=null where id='30000000-0000-4000-8000-000000000001';
update public.user_language_profiles set user_id='30000000-0000-4000-8000-000000000009' where user_id='30000000-0000-4000-8000-000000000001';
update public.profiles set username='transfer_recipient',onboarding_completed_at=now() where id='30000000-0000-4000-8000-000000000009';
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000009',true);
select is(private.challenge_payload((select (payload->'challenge'->>'id')::uuid from cases where level='A1')),null::jsonb,'Payload helper independently verifies immutable challenge ownership');
set local role authenticated;
select throws_ok($$select public.get_or_create_today_challenge()$$,'42501','challenge_owner_mismatch','Transferred learning row cannot expose another owners saved challenge through RPC');
select is((select count(*) from public.daily_challenges)::integer,0,'Transferred learning row cannot bypass challenge RLS');
reset role;
select * from finish();
rollback;
