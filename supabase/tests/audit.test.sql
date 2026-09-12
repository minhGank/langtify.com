begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
insert into auth.users(id,email) values
  ('20000000-0000-4000-8000-000000000001','audit-a@example.test'),
  ('20000000-0000-4000-8000-000000000002','audit-b@example.test');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
select public.complete_onboarding('audit_a','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','B1','UTC');

-- Check deferred invariant at transaction boundaries, not only client grants.
select throws_ok($$delete from public.user_language_profiles where user_id='20000000-0000-4000-8000-000000000001'; set constraints all immediate;$$,
  '23514', 'learning_profile_required', 'Privileged delete cannot leave a falsely completed profile');
set constraints all deferred;
select throws_ok($$update public.user_language_profiles set user_id='20000000-0000-4000-8000-000000000002' where user_id='20000000-0000-4000-8000-000000000001'; set constraints all immediate;$$,
  '23514', 'learning_profile_required', 'Privileged ownership transfer cannot orphan completed data');
set constraints all deferred;
select lives_ok($$delete from public.user_language_profiles where user_id='20000000-0000-4000-8000-000000000001';
  insert into public.user_language_profiles(user_id,reference_language_id,target_language_id,cefr_level,timezone)
  values ('20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','C1','Europe/Paris');
  set constraints all immediate;$$, 'Atomic replacement of the learning record remains possible');
set constraints all deferred;
select lives_ok($$delete from auth.users where id='20000000-0000-4000-8000-000000000001'; set constraints all immediate;$$,
  'Auth-user deletion still cascades cleanly');
select is((select count(*) from public.profiles where id='20000000-0000-4000-8000-000000000001')::integer,0,'Deleted auth user leaves no profile');

set local role authenticated;
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select public.complete_onboarding('audit_nobody','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','A1','UTC')$$,
  '42501','authentication_required','An authenticated role without a subject cannot call onboarding');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
select throws_ok($$insert into public.user_language_profiles(user_id,reference_language_id,target_language_id,cefr_level,timezone)
  values (auth.uid(),'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',null,'UTC')$$,
  '23502',null,'CEFR cannot be null');
select throws_ok($$select public.complete_onboarding('audit_b','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','A1',null)$$,
  '23514',null,'Timezone cannot be null');
select throws_ok($$update public.profiles set id='20000000-0000-4000-8000-000000000001' where id=auth.uid()$$,
  '42501',null,'Profile ownership cannot be reassigned');
select throws_ok($$update public.profiles set created_at=now() where id=auth.uid()$$,
  '42501',null,'Client cannot forge timestamps');
reset role;
select ok(not has_function_privilege('authenticated','private.handle_new_user()','EXECUTE'),'Auth trigger function is not directly callable');
select ok(not has_function_privilege('authenticated','private.preserve_completed_learning_profile()','EXECUTE'),'Invariant function is not directly callable');

select * from finish();
rollback;
