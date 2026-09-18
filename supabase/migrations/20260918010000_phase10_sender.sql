begin;
-- Explicitly approved contract: consume one attempt before provider I/O. Never
-- automatically resend, including if the process dies before reaching the network.
-- Existing blocked rows remain terminal; they are not a stale delivery backlog.
alter table private.notification_deliveries
 alter column blocked_reason drop not null,
 drop constraint if exists notification_deliveries_state_check,
 drop constraint if exists notification_deliveries_blocked_reason_check,
 add column if not exists attempt_started_at timestamptz,
 add column if not exists send_authorized_at timestamptz,
 add column if not exists installation_id uuid,
 add column if not exists installation_revision bigint,
 add column if not exists token_hash text,
 add column if not exists ticket_id uuid,
 add column if not exists result_at timestamptz,
 add column if not exists error_code text,
 add column if not exists next_receipt_at timestamptz;
do $$begin
 if not exists(select 1 from pg_constraint where conrelid='private.notification_deliveries'::regclass and conname='notification_attempt_state') then
  alter table private.notification_deliveries add constraint notification_attempt_state check (
   (state='blocked' and blocked_reason is not null and blocked_reason='delivery_guarantee_unavailable' and attempt_started_at is null and ticket_id is null)
   or (state in('attempting','uncertain','send_rejected','ticket_accepted','provider_accepted','provider_rejected','receipt_unavailable')
    and blocked_reason is null and attempt_started_at is not null and installation_id is not null
    and installation_revision is not null and installation_revision>0 and token_hash is not null and token_hash ~ '^[0-9a-f]{64}$'
    and ((state in('ticket_accepted','provider_accepted','provider_rejected','receipt_unavailable'))=(ticket_id is not null))
    and ((state='ticket_accepted')=(next_receipt_at is not null)))
  );
 end if;
end;$$;
do $$begin
 if not exists(select 1 from pg_constraint where conrelid='private.notification_deliveries'::regclass and conname='notification_authorized_ticket') then
  alter table private.notification_deliveries add constraint notification_authorized_ticket check(ticket_id is null or send_authorized_at is not null);
 end if;
end;$$;
create unique index if not exists notification_ticket_identity on private.notification_deliveries(ticket_id) where ticket_id is not null;
create index if not exists notification_receipts_due on private.notification_deliveries(next_receipt_at,id) where state='ticket_accepted';
create index if not exists notification_uncertain_due on private.notification_deliveries(attempt_started_at,id) where state='attempting';
create table if not exists private.notification_attempt_events (
 id bigint generated always as identity primary key,
 notification_id uuid not null references private.notification_deliveries(id) on delete cascade,
 state text not null check(state in('attempting','uncertain','send_rejected','ticket_accepted','provider_accepted','provider_rejected','receipt_unavailable')),
 recorded_at timestamptz not null default clock_timestamp(),
 error_code text, unique(notification_id,state)
);
alter table private.notification_attempt_events enable row level security;
revoke all on private.notification_attempt_events from public,anon,authenticated,service_role;
create or replace function private.log_notification_attempt() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.state<>'blocked' and (tg_op='INSERT' or new.state is distinct from old.state) then
  insert into private.notification_attempt_events(notification_id,state,error_code) values(new.id,new.state,new.error_code) on conflict do nothing;
 end if;
 return new;
end;$$;
drop trigger if exists notification_attempt_event on private.notification_deliveries;
create trigger notification_attempt_event after insert or update on private.notification_deliveries for each row execute function private.log_notification_attempt();

create or replace function private.notification_attempt_payload(attempt uuid,push_token text) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',n.id,'token',push_token,'title',n.title,'body',n.body,
  'type',n.kind,'userId',n.user_id,
  'expiresAt',extract(epoch from ((n.local_date+1)::timestamp at time zone n.timezone))::bigint)
 from private.notification_deliveries n where n.id=attempt;
$$;
create or replace function public.claim_notification_attempts(batch_size integer default 50) returns jsonb
language plpgsql security definer set search_path='' as $$
declare candidate record;p public.notification_preferences;zone text;instant timestamptz;day date;local_time time;
 payload jsonb;words text[];cid uuid;run_days integer;device private.push_installations;attempt_id uuid;items jsonb:='[]'::jsonb;before_items jsonb;n integer:=0;before_count integer;failures integer:=0;next_due timestamptz;old_claims text;old_sub text;
begin
 if batch_size is null or batch_size not between 1 and 50 then raise exception using errcode='22023',message='invalid_notification_batch';end if;
 if not pg_try_advisory_xact_lock(101018001) then return jsonb_build_object('attempts','[]'::jsonb,'failed',0);end if;
 old_claims:=current_setting('request.jwt.claims',true);old_sub:=current_setting('request.jwt.claim.sub',true);
 for candidate in select user_id from public.notification_preferences where enabled and next_check_at<=now() order by next_check_at,user_id limit batch_size loop
  before_count:=n;before_items:=items;
  begin
   -- Match challenge/settings/lifecycle order: profile, learning, preferences.
   perform 1 from auth.users where id=candidate.user_id for key share;
   perform 1 from public.profiles where id=candidate.user_id for update;
   select timezone into zone from public.user_language_profiles where user_id=candidate.user_id for update;
   select * into p from public.notification_preferences where user_id=candidate.user_id for update;
   instant:=clock_timestamp();day:=(instant at time zone zone)::date;local_time:=(instant at time zone zone)::time;
   if p.enabled and zone is not null and exists(select 1 from auth.users u join public.profiles pr on pr.id=u.id where u.id=p.user_id and u.deleted_at is null and (u.banned_until is null or u.banned_until<=instant) and pr.onboarding_completed_at is not null)
    and exists(select 1 from private.push_installations i join auth.sessions s on s.id=i.session_id and s.user_id=i.user_id where i.user_id=p.user_id and i.token is not null and (s.not_after is null or s.not_after>instant)) then
    -- The binding is snapshotted for admission. Revocation after commit cannot
    -- retract a network/OS message already in flight.
    select i.* into device from private.push_installations i
    join auth.sessions s on s.id=i.session_id and s.user_id=i.user_id
    where i.user_id=p.user_id and i.token is not null and (s.not_after is null or s.not_after>instant)
    order by i.updated_at desc,i.id desc limit 1;
    if device.id is null then continue;end if;
    if p.daily_words and local_time>=p.daily_time and not exists(select 1 from private.notification_deliveries where user_id=p.user_id and kind='DAILY_WORDS' and local_date=day) then
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
    if p.streak_reminder and local_time>=p.streak_time and not exists(select 1 from private.word_completions where user_id=p.user_id and local_date=day and revoked_at is null) then
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
-- A one-use last eligibility check closes the claim-to-send processing window.
-- It cannot retract an already admitted provider call after this transaction ends.
create or replace function public.authorize_notification_attempt(notification_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare n private.notification_deliveries;device private.push_installations;p public.notification_preferences;zone text;instant timestamptz;
begin
 select * into n from private.notification_deliveries where id=notification_id;
 if not found or n.state<>'attempting' or n.send_authorized_at is not null then return false;end if;
 perform 1 from auth.users where id=n.user_id for key share;
 perform 1 from public.profiles where id=n.user_id for update;
 select timezone into zone from public.user_language_profiles where user_id=n.user_id for update;
 select * into device from private.push_installations where id=n.installation_id for update;
 select * into p from public.notification_preferences where user_id=n.user_id for update;
 select * into n from private.notification_deliveries where id=notification_id for update;
 instant:=clock_timestamp();
 if not found or n.state<>'attempting' or n.send_authorized_at is not null then return false;end if;
 if not coalesce(p.enabled and zone=n.timezone and (instant at time zone zone)::date=n.local_date
  and device.user_id=n.user_id and device.revision=n.installation_revision
  and encode(extensions.digest(device.token,'sha256'),'hex')=n.token_hash
  and exists(select 1 from auth.sessions s where s.id=device.session_id and s.user_id=n.user_id and (s.not_after is null or s.not_after>instant))
  and exists(select 1 from auth.users u join public.profiles pr on pr.id=u.id where u.id=n.user_id and u.deleted_at is null and (u.banned_until is null or u.banned_until<=instant) and pr.onboarding_completed_at is not null)
  and ((n.kind='DAILY_WORDS' and p.daily_words and (instant at time zone zone)::time>=p.daily_time)
    or (n.kind='STREAK_AT_RISK' and p.streak_reminder and (instant at time zone zone)::time>=p.streak_time
      and not exists(select 1 from private.word_completions where user_id=n.user_id and local_date=n.local_date and revoked_at is null)
      and exists(select 1 from private.progress_runs(n.user_id) where end_day=n.local_date-1))),false) then return false;end if;
 update private.notification_deliveries set send_authorized_at=instant where id=n.id;
 return true;
end;$$;
-- Receipt/result writes are repeatable metadata operations, never send authority.
create or replace function public.record_notification_result(notification_id uuid,result_status text,provider_ticket uuid default null,provider_error text default null) returns void
language plpgsql security definer set search_path='' as $$
declare n private.notification_deliveries;
begin
 if result_status is null or result_status not in('ticket_accepted','send_rejected','uncertain')
 or (result_status='ticket_accepted') is distinct from (provider_ticket is not null)
 or (result_status='ticket_accepted' and provider_error is not null)
 or (result_status<>'ticket_accepted' and provider_error is null)
 or (provider_error is not null and provider_error !~ '^(DeviceNotRegistered|MessageTooBig|MessageRateExceeded|MismatchSenderId|InvalidCredentials|UNAUTHORIZED|ProviderError|NetworkError|MalformedResponse|WindowExpired|EligibilityChanged|HTTP_[1-5][0-9]{2})$') then
  raise exception using errcode='22023',message='invalid_notification_result';
 end if;
 select * into n from private.notification_deliveries where id=notification_id;
 if not found then return;end if;
 -- Shared deletion/registration order: Auth user, installation, notification.
 perform 1 from auth.users where id=n.user_id for key share;
 perform 1 from private.push_installations where id=n.installation_id for update;
 select * into n from private.notification_deliveries where id=notification_id for update;
 if not found or n.state not in('attempting','uncertain') then return;end if;
 if n.state='uncertain' and result_status='uncertain' then return;end if;
 if provider_error='EligibilityChanged' and n.send_authorized_at is not null then return;end if;
 update private.notification_deliveries set state=result_status,ticket_id=provider_ticket,
  error_code=provider_error,result_at=clock_timestamp(),
  next_receipt_at=case when result_status='ticket_accepted' then now()+interval '15 minutes' end
 where id=n.id;
 if provider_error='DeviceNotRegistered' then
  update private.push_installations set token=null,session_id=null,user_id=null,platform=null
  where id=n.installation_id and user_id=n.user_id and revision=n.installation_revision
   and encode(extensions.digest(token,'sha256'),'hex')=n.token_hash;
 end if;
end;$$;

create or replace function public.claim_notification_receipts(batch_size integer default 100) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n private.notification_deliveries;items jsonb:='[]'::jsonb;
begin
 if batch_size is null or batch_size not between 1 and 100 then
  raise exception using errcode='22023',message='invalid_notification_batch';end if;
 -- Lost workers never make a notification sendable again. Recovery is bounded.
 for n in select * from private.notification_deliveries where state='attempting'
  and attempt_started_at<now()-interval '10 minutes' order by attempt_started_at,id limit batch_size for update skip locked loop
  update private.notification_deliveries set state='uncertain',error_code='WorkerInterrupted',result_at=clock_timestamp() where id=n.id;
 end loop;
 for n in select * from private.notification_deliveries where state='ticket_accepted'
  and next_receipt_at<=now() order by next_receipt_at,id limit batch_size for update skip locked loop
  if n.attempt_started_at<=now()-interval '24 hours' then
   update private.notification_deliveries set state='receipt_unavailable',next_receipt_at=null,
    error_code='ReceiptExpired',result_at=clock_timestamp() where id=n.id;
  else
   -- Lease only the read. Expiry permits another receipt lookup, never a resend.
   update private.notification_deliveries set next_receipt_at=now()+interval '15 minutes' where id=n.id;
   items:=items||jsonb_build_array(jsonb_build_object('id',n.id,'ticketId',n.ticket_id));
  end if;
 end loop;
 return items;
end;$$;
create or replace function public.record_notification_receipt(notification_id uuid,provider_ticket uuid,receipt_status text,provider_error text default null) returns void
language plpgsql security definer set search_path='' as $$
declare n private.notification_deliveries;
begin
 if receipt_status is null or receipt_status not in('ok','error') or provider_ticket is null
 or (receipt_status='ok' and provider_error is not null)
 or (receipt_status='error' and provider_error is null)
 or (provider_error is not null and provider_error !~ '^(DeviceNotRegistered|MessageTooBig|MessageRateExceeded|MismatchSenderId|InvalidCredentials|UNAUTHORIZED|ProviderError)$') then
  raise exception using errcode='22023',message='invalid_notification_receipt';end if;
 select * into n from private.notification_deliveries where id=notification_id;
 if not found then return;end if;
 perform 1 from auth.users where id=n.user_id for key share;
 perform 1 from private.push_installations where id=n.installation_id for update;
 select * into n from private.notification_deliveries where id=notification_id for update;
 if not found or n.state<>'ticket_accepted' or n.ticket_id<>provider_ticket then return;end if;
 update private.notification_deliveries set state=case when receipt_status='ok' then 'provider_accepted' else 'provider_rejected' end,
  error_code=provider_error,result_at=clock_timestamp(),next_receipt_at=null where id=n.id;
 if provider_error='DeviceNotRegistered' then
  update private.push_installations set token=null,session_id=null,user_id=null,platform=null
  where id=n.installation_id and user_id=n.user_id and revision=n.installation_revision
   and encode(extensions.digest(token,'sha256'),'hex')=n.token_hash;
 end if;
end;$$;

create or replace function public.get_notification_preferences() returns jsonb
language plpgsql security definer set search_path='' as $$
declare viewer uuid:=private.safety_actor();p public.notification_preferences;
begin
 insert into public.notification_preferences(user_id) values(viewer) on conflict do nothing;
 select * into strict p from public.notification_preferences where user_id=viewer;
 return to_jsonb(p)-'next_check_at'||jsonb_build_object('timezone',(select timezone from public.user_language_profiles where user_id=viewer),'delivery_available',true,'delivery_contract','at_most_one_attempt');
end;$$;
-- Retire the old blocked-preparation entry point; existing records stay terminal.
revoke all on function public.prepare_due_notifications(integer) from service_role;
revoke all on function private.log_notification_attempt(),private.notification_attempt_payload(uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.authorize_notification_attempt(uuid),public.claim_notification_attempts(integer),public.claim_notification_receipts(integer),public.record_notification_result(uuid,text,uuid,text),public.record_notification_receipt(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.authorize_notification_attempt(uuid),public.claim_notification_attempts(integer),public.claim_notification_receipts(integer),public.record_notification_result(uuid,text,uuid,text),public.record_notification_receipt(uuid,uuid,text,text) to service_role;
commit;
