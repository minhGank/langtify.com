begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select ok(not has_function_privilege('anon','public.delete_my_account()','execute'),'anonymous deletion denied');
select ok(not has_function_privilege('service_role','public.delete_my_account()','execute'),'no service identity override');
select ok(has_function_privilege('authenticated','public.delete_my_account()','execute'),'self deletion available');
select ok(not has_table_privilege('authenticated','private.account_erasure_scope','insert'),'clients cannot mint audit erasure');
select ok(not has_table_privilege('service_role','private.account_erasure_scope','insert'),'service cannot mint audit erasure');
select throws_ok($$select delete_my_account()$$,'42501','authentication_required','missing identity rejected');
insert into auth.users(id,email) values
 ('ac000000-0000-4000-8000-000000000001','erase_a@example.test'),
 ('ac000000-0000-4000-8000-000000000002','erase_b@example.test');
insert into auth.sessions(id,user_id) values
 ('ac000000-0000-4000-8000-000000000011','ac000000-0000-4000-8000-000000000001'),
 ('ac000000-0000-4000-8000-000000000012','ac000000-0000-4000-8000-000000000002');
select set_config('request.jwt.claim.sub','ac000000-0000-4000-8000-000000000002',true);
select complete_onboarding('erase_b','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','B1','UTC');
select set_config('request.jwt.claim.sub','ac000000-0000-4000-8000-000000000001',true);
select complete_onboarding('erase_a','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','B1','UTC');
select throws_ok($$select delete_my_account()$$,'42501','authentication_required','missing session rejected');
select set_config('request.jwt.claims','{"session_id":"ac000000-0000-4000-8000-000000000012"}',true);
select throws_ok($$select delete_my_account()$$,'42501','authentication_required','another account session rejected');
select set_config('request.jwt.claims','{"session_id":"ac000000-0000-4000-8000-000000000011"}',true);
insert into auth.refresh_tokens(user_id,token) values(auth.uid()::text,'erasure-fixture-legacy-token');
insert into auth.flow_state(id,user_id,provider_type,authentication_method) values(gen_random_uuid(),auth.uid(),'google','oauth');
create temp table fixture as select get_or_create_today_challenge() payload;
create temp table photo as select (reserve_submission((select (payload->'words'->0->>'id')::uuid from fixture))).*;
insert into storage.objects(bucket_id,name,owner_id,version,metadata)
 select 'challenge-submissions',storage_path,user_id::text,'v1','{"mimetype":"image/jpeg","size":100}' from photo;
select attest_submission_photo(p.id,p.user_id,o.id,o.version,repeat('a',64),16,16)
 from photo p join storage.objects o on o.name=p.storage_path;
select finalize_submission((select id from photo));
create temp table avatar as select reserve_profile_avatar('ac000000-0000-4000-8000-000000000021') payload;
insert into storage.objects(bucket_id,name,owner_id,version,metadata)
 select 'profile-avatars',payload->'avatar'->>'storage_path',auth.uid()::text,'v1','{"mimetype":"image/jpeg","size":100}' from avatar;
select activate_profile_avatar((a.payload->'avatar'->>'id')::uuid,auth.uid(),o.id,o.version,repeat('b',64),16,16)
 from avatar a join storage.objects o on o.name=a.payload->'avatar'->>'storage_path';
insert into public.user_follows(follower_user_id,followed_user_id) values(auth.uid(),'ac000000-0000-4000-8000-000000000002');
insert into public.safety_reports(id,reporter_user_id,target_kind,target_id,context_submission_id,subject_user_id,username_snapshot,word_snapshot,reason)
 values('ac000000-0000-4000-8000-000000000031','ac000000-0000-4000-8000-000000000002','user',auth.uid(),(select id from photo),auth.uid(),'erase_a','word','privacy');
insert into public.moderation_audit(moderator_user_id,request_id,report_id,action,target_kind,target_id)
 values('ac000000-0000-4000-8000-000000000002',gen_random_uuid(),'ac000000-0000-4000-8000-000000000031','resolve_report','report','ac000000-0000-4000-8000-000000000031');
select throws_ok($$delete from public.moderation_audit where report_id='ac000000-0000-4000-8000-000000000031'$$,'42501','immutable_moderation_audit','ordinary audit deletion still denied');
insert into auth.users(id,email) values('ac000000-0000-4000-8000-000000000003','erase_c@example.test');
insert into public.safety_reports(id,reporter_user_id,target_kind,target_id,context_submission_id,subject_user_id,username_snapshot,word_snapshot,reason)
 values('ac000000-0000-4000-8000-000000000032','ac000000-0000-4000-8000-000000000002','user','ac000000-0000-4000-8000-000000000003',gen_random_uuid(),'ac000000-0000-4000-8000-000000000003','unrelated','word','privacy');
insert into public.moderation_audit(moderator_user_id,request_id,report_id,action,target_kind,target_id)
 values('ac000000-0000-4000-8000-000000000002',gen_random_uuid(),'ac000000-0000-4000-8000-000000000032','resolve_report','report','ac000000-0000-4000-8000-000000000032');
-- A failed cascade must roll back Auth deletion AND queue admission.
create function pg_temp.fail_erasure() returns trigger language plpgsql as $$begin raise exception 'fixture_failure';end;$$;
create trigger fail_erasure before delete on public.safety_reports for each row execute function pg_temp.fail_erasure();
select throws_ok($$select delete_my_account()$$,'P0001','fixture_failure','partial failure rolls back');
select ok(exists(select 1 from auth.users where id=auth.uid()),'Auth account survives rollback');
select ok(exists(select 1 from public.submissions where user_id=auth.uid()),'photo metadata survives rollback');
select ok(not exists(select 1 from private.photo_cleanup_queue where storage_path=(select storage_path from photo)),'rollback does not authorize cleanup');
drop trigger fail_erasure on public.safety_reports;
set local role authenticated;
select is(delete_my_account(),true,'authenticated caller deletes own account');
select is(delete_my_account(),true,'lost acknowledgement can be retried safely');
reset role;
set constraints all immediate;
select ok(not exists(select 1 from auth.users where id=auth.uid()),'Auth account removed');
select ok(not exists(select 1 from auth.sessions where user_id=auth.uid()),'sessions removed');
select ok(not exists(select 1 from auth.refresh_tokens where user_id=auth.uid()::text),'legacy refresh tokens removed');
select ok(not exists(select 1 from auth.flow_state where user_id=auth.uid()),'pending PKCE state removed');
select ok(not exists(select 1 from public.profiles where id=auth.uid()),'profile removed');
select ok(not exists(select 1 from public.user_language_profiles where user_id=auth.uid()),'learning removed');
select ok(not exists(select 1 from public.daily_challenges where user_id=auth.uid()),'challenges removed');
select ok(not exists(select 1 from public.xp_events where user_id=auth.uid()),'XP removed');
select ok(not exists(select 1 from private.qualified_days_seen where user_id=auth.uid()),'streak day history removed');
select ok(not exists(select 1 from private.streak_milestones where user_id=auth.uid()),'streak milestones removed');
select ok(not exists(select 1 from private.profile_avatars where user_id=auth.uid()),'avatar metadata removed');
select ok(not exists(select 1 from public.submissions where user_id=auth.uid()),'photo metadata removed');
select ok(not exists(select 1 from private.completed_concepts where user_id=auth.uid()),'completed concept history removed');
select ok(not exists(select 1 from public.user_follows where follower_user_id=auth.uid()),'social activity removed');
select ok(not exists(select 1 from public.in_app_notifications where actor_user_id=auth.uid()),'social inbox references removed');
select ok(not exists(select 1 from public.safety_reports where subject_user_id=auth.uid()),'identifying safety snapshots removed');
select ok(not exists(select 1 from public.moderation_audit where report_id='ac000000-0000-4000-8000-000000000031'),'associated audit removed only during erasure');
select ok(not exists(select 1 from private.account_erasure_scope),'erasure authority never persists');
select ok(exists(select 1 from public.safety_reports where id='ac000000-0000-4000-8000-000000000032'),'unrelated report retained');
select ok(exists(select 1 from public.moderation_audit where report_id='ac000000-0000-4000-8000-000000000032'),'unrelated audit retained');
select throws_ok($$delete from public.moderation_audit where report_id='ac000000-0000-4000-8000-000000000032'$$,'42501','immutable_moderation_audit','audit protection restored after erasure');
select ok(exists(select 1 from auth.users where id='ac000000-0000-4000-8000-000000000002'),'other account unaffected');
select ok(exists(select 1 from private.photo_cleanup_queue where storage_path=(select storage_path from photo)),'photo cleanup durable');
select ok(exists(select 1 from private.avatar_cleanup_queue where storage_path=(select payload->'avatar'->>'storage_path' from avatar)),'avatar cleanup durable');
select ok(exists(select 1 from storage.objects where owner_id=auth.uid()::text),'SQL never deletes Storage objects');
select throws_ok($$select finish_photo_cleanup((select storage_path from photo))$$,'23514',null,'lost Storage removal cannot finalize early');
select ok(not can_upload_submission_object((select storage_path from photo)),'stale session cannot upload deleted reservation');
select ok(not can_upload_avatar_object((select payload->'avatar'->>'storage_path' from avatar)),'stale session cannot upload deleted avatar');
select * from finish();
rollback;
