begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users (id, email) values
  ('10000000-0000-4000-8000-000000000001', 'phase2-a@example.test'),
  ('10000000-0000-4000-8000-000000000002', 'phase2-b@example.test');
select is((select count(*) from public.profiles where id in ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'))::integer, 2, 'Signup creates one profile per auth user');
select is((select count(*) from public.languages where code in ('en','fr') and is_active)::integer, 2, 'English and French are seeded');
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.profiles'::regclass, 'public.languages'::regclass, 'public.user_language_profiles'::regclass)), 'All domain tables enable RLS');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select is((select count(*) from public.profiles)::integer, 1, 'A sees only own profile');
select lives_ok($$update public.profiles set username='Before_Setup' where id=auth.uid()$$, 'A may update own username');
select is((select username from public.profiles where id=auth.uid()), 'before_setup', 'Username normalized');
select throws_ok($$update public.profiles set onboarding_completed_at=now() where id=auth.uid()$$, '42501', null, 'Client cannot forge completion');
select throws_ok($$insert into public.profiles(id) values ('10000000-0000-4000-8000-000000000002')$$, '42501', null, 'Client cannot insert profiles');
select throws_ok($$delete from public.profiles where id=auth.uid()$$, '42501', null, 'No profile delete privilege');
select lives_ok($$select public.complete_onboarding(' Learner_A ', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'B1', 'America/Toronto')$$, 'Atomic onboarding succeeds');
select is((select username from public.profiles where id=auth.uid()), 'learner_a', 'RPC normalizes username');
select ok((select onboarding_completed_at is not null from public.profiles where id=auth.uid()), 'Completion recorded server-side');
select is((select timezone from public.user_language_profiles where user_id=auth.uid()), 'America/Toronto', 'IANA timezone persisted');
select lives_ok($$select public.complete_onboarding('learner_a', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'B1', 'America/Toronto')$$, 'Retry succeeds');
select is((select count(*) from public.user_language_profiles)::integer, 1, 'Retry produces no duplicate learning record');
select throws_ok($$update public.user_language_profiles set cefr_level='D1' where user_id=auth.uid()$$, '23514', null, 'Invalid CEFR rejected');
select throws_ok($$update public.user_language_profiles set reference_language_id=target_language_id where user_id=auth.uid()$$, '23514', null, 'Equal languages rejected');
select throws_ok($$update public.user_language_profiles set timezone='+02:00' where user_id=auth.uid()$$, '23514', null, 'Timezone offset rejected');
select throws_ok($$update public.user_language_profiles set timezone='Mars/Olympus' where user_id=auth.uid()$$, '23514', null, 'Unknown timezone rejected');
select throws_ok($$update public.user_language_profiles set user_id='10000000-0000-4000-8000-000000000002' where user_id=auth.uid()$$, '42501', null, 'Cannot transfer learning record');
select throws_ok($$update public.profiles set username='invalid name' where id=auth.uid()$$, '23514', null, 'Invalid username rejected');
select throws_ok($$update public.profiles set username=null where id=auth.uid()$$, '23514', null, 'Completed username is required');
select throws_ok($$delete from public.user_language_profiles where user_id=auth.uid()$$, '42501', null, 'Cannot delete completed learning record');
select throws_ok($$insert into public.languages(code,name,native_name) values ('es','Spanish','Español')$$, '42501', null, 'Catalog inserts denied');
select throws_ok($$update public.languages set is_active=false$$, '42501', null, 'Catalog updates denied');
select throws_ok($$delete from public.languages$$, '42501', null, 'Catalog deletes denied');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select is((select count(*) from public.profiles)::integer, 1, 'B sees only own profile');
select is((select count(*) from public.user_language_profiles)::integer, 0, 'B cannot read A learning data');
with changed as (update public.profiles set username='hacked' where id='10000000-0000-4000-8000-000000000001' returning id) select is((select count(*) from changed)::integer, 0, 'B cannot update A profile');
with changed as (update public.user_language_profiles set cefr_level='C2' where user_id='10000000-0000-4000-8000-000000000001' returning id) select is((select count(*) from changed)::integer, 0, 'B cannot update A learning data');
select throws_ok($$insert into public.user_language_profiles(user_id,reference_language_id,target_language_id,cefr_level,timezone) values ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','A1','UTC')$$, '42501', null, 'B cannot create a learning record owned by A');
select throws_ok($$select public.complete_onboarding('LEARNER_A', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'A1', 'UTC')$$, '23505', null, 'Case-insensitive username collision rejected');
select is((select count(*) from public.user_language_profiles)::integer, 0, 'Username failure rolls back the learning write');
select ok((select onboarding_completed_at is null and username is null from public.profiles where id=auth.uid()), 'Failure cannot falsely complete B');
select lives_ok($$insert into public.user_language_profiles(user_id,reference_language_id,target_language_id,cefr_level,timezone) values (auth.uid(),'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','A2','Europe/Paris')$$, 'B may create own learning record');
select lives_ok($$update public.user_language_profiles set cefr_level='B2' where user_id=auth.uid()$$, 'B may update own learning record');
select throws_ok($$insert into public.user_language_profiles(user_id,reference_language_id,target_language_id,cefr_level,timezone) values (auth.uid(),'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','A1','UTC')$$, '23505', null, 'One learning record per user enforced');
select lives_ok($$select public.complete_onboarding('learner_b', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'C2', 'Europe/Paris')$$, 'Partial setup can recover through RPC');
select ok((select onboarding_completed_at is not null from public.profiles where id=auth.uid()), 'Recovered setup is complete');
select throws_ok($$select public.complete_onboarding('changed_b', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'A1', 'Invalid/Zone')$$, '23514', null, 'Invalid retry rejected');
select is((select username from public.profiles where id=auth.uid()), 'learner_b', 'Failed retry preserves previous completed profile');
select is((select cefr_level from public.user_language_profiles where user_id=auth.uid()), 'C2', 'Failed retry preserves previous learning record');

reset role;
update public.languages set is_active=false where code='fr';
set local role authenticated;
select throws_ok($$select public.complete_onboarding('learner_b', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'A1', 'UTC')$$, '23514', null, 'Inactive catalog languages cannot be selected');

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select throws_ok($$select * from public.profiles$$, '42501', null, 'Anonymous profile reads denied');
select throws_ok($$select * from public.user_language_profiles$$, '42501', null, 'Anonymous learning reads denied');
select throws_ok($$select * from public.languages$$, '42501', null, 'Anonymous catalog reads denied');
select throws_ok($$select public.complete_onboarding('anon_user', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'A1', 'UTC')$$, '42501', null, 'Anonymous onboarding RPC denied');
reset role;
select * from finish();
rollback;
