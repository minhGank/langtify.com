begin;
-- Audit: preserve lifecycle lock order across every user in a scheduler batch.
-- No attempt, preference, binding or learning history is rewritten.
create or replace function public.claim_notification_attempts(batch_size integer default 50) returns jsonb
language plpgsql security definer set search_path='' as $$
declare candidate record;candidate_ids uuid[];p public.notification_preferences;zone text;instant timestamptz;day date;
 payload jsonb;words text[];cid uuid;run_days integer;device private.push_installations;attempt_id uuid;items jsonb:='[]'::jsonb;before_items jsonb;n integer:=0;before_count integer;failures integer:=0;next_due timestamptz;old_claims text;old_sub text;
begin
 if batch_size is null or batch_size not between 1 and 50 then raise exception using errcode='22023',message='invalid_notification_batch';end if;
 if not pg_try_advisory_xact_lock(101018001) then return jsonb_build_object('attempts','[]'::jsonb,'failed',0);end if;
 old_claims:=current_setting('request.jwt.claims',true);old_sub:=current_setting('request.jwt.claim.sub',true);
 -- Acquire the whole bounded batch's upstream lifecycle locks before holding
 -- any preference rows. Otherwise B preferences -> A profile -> A installation
 -- -> B preferences can cycle with cross-account registration and authorization.
 select array_agg(d.user_id order by d.next_check_at,d.user_id) into candidate_ids
 from (select user_id,next_check_at from public.notification_preferences
       where enabled and next_check_at<=now() order by next_check_at,user_id limit batch_size) d;
 perform 1 from auth.users where id=any(candidate_ids) order by id for key share;
 perform 1 from public.profiles where id=any(candidate_ids) order by id for update;
 perform 1 from public.user_language_profiles where user_id=any(candidate_ids) order by user_id for update;
 for candidate in select user_id from unnest(candidate_ids) with ordinality u(user_id,ord) order by ord loop
  before_count:=n;before_items:=items;
  begin
   -- Match challenge/settings/lifecycle order: profile, learning, preferences.
   perform 1 from auth.users where id=candidate.user_id for key share;
   perform 1 from public.profiles where id=candidate.user_id for update;
   select timezone into zone from public.user_language_profiles where user_id=candidate.user_id for update;
   select * into p from public.notification_preferences where user_id=candidate.user_id for update;
   instant:=clock_timestamp();day:=(instant at time zone zone)::date;
   if p.enabled and zone is not null and exists(select 1 from auth.users u join public.profiles pr on pr.id=u.id where u.id=p.user_id and u.deleted_at is null and (u.banned_until is null or u.banned_until<=instant) and pr.onboarding_completed_at is not null)
    and exists(select 1 from private.push_installations i join auth.sessions s on s.id=i.session_id and s.user_id=i.user_id where i.user_id=p.user_id and i.token is not null and (s.not_after is null or s.not_after>instant)) then
    -- The binding is snapshotted for admission. Revocation after commit cannot
    -- retract a network/OS message already in flight.
    select i.* into device from private.push_installations i
    join auth.sessions s on s.id=i.session_id and s.user_id=i.user_id
    where i.user_id=p.user_id and i.token is not null and (s.not_after is null or s.not_after>instant)
    order by i.updated_at desc,i.id desc limit 1;
    if device.id is null then continue;end if;
    if p.daily_words and instant>=((day+p.daily_time) at time zone zone) and not exists(select 1 from private.notification_deliveries where user_id=p.user_id and kind='DAILY_WORDS' and local_date=day) then
     -- Delegate generation to the audited Auth-derived implementation; this RPC
     -- is service-only and restores the transaction's identity afterward.
     perform set_config('request.jwt.claim.sub',p.user_id::text,true);
     perform set_config('request.jwt.claims',jsonb_build_object('sub',p.user_id)::text,true);
     payload:=public.get_or_create_today_challenge();cid:=(payload->'challenge'->>'id')::uuid;
     if (payload->'challenge'->>'local_challenge_date')::date<>day or (clock_timestamp() at time zone zone)::date<>day then raise exception 'notification_day_changed';end if;
     select array_agg(w->>'target_term' order by ord) into words from jsonb_array_elements(payload->'words') with ordinality e(w,ord);
     if cardinality(words)<>3 or array_position(words,null) is not null then raise exception 'incomplete_notification_challenge';end if;
     insert into private.notification_deliveries(user_id,kind,local_date,timezone,challenge_id,title,body,words,state,blocked_reason,attempt_started_at,installation_id,installation_revision,token_hash)
      values(p.user_id,'DAILY_WORDS',day,zone,cid,'Today''s 3 words are ready',array_to_string(words,' · ')||E'\nOpen Langtify and find them in your day.',words,'attempting',null,clock_timestamp(),device.id,device.revision,encode(extensions.digest(device.token,'sha256'),'hex'))
      on conflict do nothing returning id into attempt_id;
     if found then
      items:=items||jsonb_build_array(private.notification_attempt_payload(attempt_id,device.token));
      n:=n+1;
     end if;
    end if;
    if p.streak_reminder and instant>=((day+p.streak_time) at time zone zone) and not exists(select 1 from private.word_completions where user_id=p.user_id and local_date=day and revoked_at is null) then
     select coalesce(max(end_day-start_day+1),0) into run_days from private.progress_runs(p.user_id) where end_day=day-1;
     if run_days>0 then
      insert into private.notification_deliveries(user_id,kind,local_date,timezone,title,body,state,blocked_reason,attempt_started_at,installation_id,installation_revision,token_hash)
       values(p.user_id,'STREAK_AT_RISK',day,zone,'Keep your '||run_days||'-day streak alive','Complete 1 word before today ends.','attempting',null,clock_timestamp(),device.id,device.revision,encode(extensions.digest(device.token,'sha256'),'hex'))
       on conflict do nothing returning id into attempt_id;
      if found then
       items:=items||jsonb_build_array(private.notification_attempt_payload(attempt_id,device.token));
       n:=n+1;
      end if;
     end if;
    end if;
   end if;
   next_due:=private.next_notification_check(zone,instant,case when p.daily_words then p.daily_time end,case when p.streak_reminder then p.streak_time end);
   update public.notification_preferences set next_check_at=coalesce(next_due,instant+interval '1 day') where user_id=candidate.user_id;
  exception when others then
   n:=before_count;items:=before_items;
   -- One insufficient catalog or invalid account cannot starve later users.
   update public.notification_preferences set next_check_at=now()+interval '15 minutes' where user_id=candidate.user_id;
   failures:=failures+1;
  end;
 end loop;
 perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
 perform set_config('request.jwt.claims',coalesce(old_claims,''),true);
 return jsonb_build_object('attempts',items,'failed',failures);
end;$$;
revoke all on function public.claim_notification_attempts(integer) from public,anon,authenticated;
grant execute on function public.claim_notification_attempts(integer) to service_role;
commit;
