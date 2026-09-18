begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Privileged, transaction-scoped clock instrumentation only. The deployed RPCs
-- always call clock_timestamp(); no application-controlled clock is introduced.
do $$declare signature text; definition text;begin
 foreach signature in array array['public.claim_notification_attempts(integer)','public.authorize_notification_attempt(uuid)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  definition:=replace(definition,'clock_timestamp()', $q$current_setting('tests.notification_clock')::timestamptz$q$);
  definition:=replace(definition,'public.get_or_create_today_challenge()', $q$current_setting('tests.notification_challenge')::jsonb$q$);
  execute definition;
 end loop;
end;$$;
insert into auth.users(id,email) values('82000000-0000-4000-8000-000000000001','notification_audit@example.test');
insert into auth.sessions(id,user_id) values('82000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claim.sub','82000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"82000000-0000-4000-8000-000000000001","session_id":"82000000-0000-4000-8000-000000000002"}',true);
select public.complete_onboarding('notification_audit','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','B1','America/Toronto');
select set_config('tests.notification_challenge',public.get_or_create_today_challenge()::text,true);
select public.sync_push_installation('82000000-0000-4000-8000-000000000003',repeat('a',64),1,'ExpoPushToken[auditfixturetoken]','ios');
update public.notification_preferences set enabled=false where user_id<>'82000000-0000-4000-8000-000000000001';
create function pg_temp.check_dst(before_time timestamptz, due_time timestamptz, wall_time time, label text) returns setof text language plpgsql as $$
declare payload jsonb; result jsonb; attempt uuid;begin
 payload:=jsonb_set(current_setting('tests.notification_challenge')::jsonb,'{challenge,local_challenge_date}',to_jsonb((due_time at time zone 'America/Toronto')::date));
 perform set_config('tests.notification_challenge',payload::text,true);
 perform public.save_notification_preferences(true,true,false,to_char(wall_time,'HH24:MI'),'19:00');
 perform set_config('tests.notification_clock',before_time::text,true);
 result:=public.claim_notification_attempts();
 return next is(jsonb_array_length(result->'attempts'),0,label||': no early claim after registration/settings refresh');
 return next is((result->>'failed')::integer,0,label||': no premature challenge preparation');
 return next is((select next_check_at from public.notification_preferences where user_id='82000000-0000-4000-8000-000000000001'),due_time,label||': next check agrees with due instant');
 -- A queued claim must use the same resolved instant for final send admission.
 insert into private.notification_deliveries(user_id,kind,local_date,timezone,challenge_id,title,body,words,state,blocked_reason,attempt_started_at,installation_id,installation_revision,token_hash)
 values('82000000-0000-4000-8000-000000000001','DAILY_WORDS',(due_time at time zone 'America/Toronto')::date,'America/Toronto',(payload->'challenge'->>'id')::uuid,'Fixture','Fixture',array['one','two','three'],'attempting',null,before_time,'82000000-0000-4000-8000-000000000003',1,encode(extensions.digest('ExpoPushToken[auditfixturetoken]','sha256'),'hex'))
 on conflict(user_id,kind,local_date) do update set send_authorized_at=null returning id into attempt;
 return next is(public.authorize_notification_attempt(attempt),false,label||': no early send authorization');
 perform set_config('tests.notification_clock',due_time::text,true);
 return next is(public.authorize_notification_attempt(attempt),true,label||': authorization at resolved instant');
 return next is(public.authorize_notification_attempt(attempt),false,label||': authorization remains one-use');
end;$$;
select * from pg_temp.check_dst('2026-03-08 07:05Z','2026-03-08 07:30Z','02:30','Spring gap');
select * from pg_temp.check_dst('2026-11-01 05:45Z','2026-11-01 06:30Z','01:30','Fall fold');
select * from finish();
rollback;
