begin;
-- Actual provider dispatch remains disabled: the user requires stronger delivery
-- guarantees than Expo provides. These are preparation records, never sent claims.
create table if not exists public.notification_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 enabled boolean not null default true, daily_words boolean not null default true,
 streak_reminder boolean not null default true,
 daily_time time not null default '08:00', streak_time time not null default '19:00',
 next_check_at timestamptz not null default now(),
 check(extract(second from daily_time)=0 and daily_time<'24:00'),
 check(extract(second from streak_time)=0 and streak_time<'24:00')
);
create index if not exists notification_preferences_due on public.notification_preferences(next_check_at,user_id) where enabled;
create table if not exists private.push_installations (
 id uuid primary key, secret_hash text not null, revision bigint not null check(revision>0),
 user_id uuid references auth.users(id) on delete set null,
 session_id uuid, token text unique, platform text check(platform in('ios','android')),
 updated_at timestamptz not null default now(),
 check((token is null) or (user_id is not null and session_id is not null and platform is not null)),
 check(token is null or token ~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$')
);
create index if not exists push_installations_owner on private.push_installations(user_id) where token is not null;
create or replace function private.clear_deleted_push_owner() returns trigger language plpgsql security definer set search_path='' as $$
begin update private.push_installations set user_id=null,session_id=null,token=null,platform=null where user_id=old.id;return old;end;$$;
drop trigger if exists clear_deleted_push_owner on auth.users;
create trigger clear_deleted_push_owner before delete on auth.users for each row execute function private.clear_deleted_push_owner();
-- No FK to auth.sessions: retain the capability tombstone when a session ends;
-- every preparation checks the real session table, never just JWT expiration.
create table if not exists private.notification_deliveries (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in('DAILY_WORDS','STREAK_AT_RISK')), local_date date not null,
 timezone text not null, challenge_id uuid references public.daily_challenges(id) on delete cascade,
 title text not null, body text not null, words text[],
 state text not null default 'blocked' check(state='blocked'),
 blocked_reason text not null default 'delivery_guarantee_unavailable' check(blocked_reason='delivery_guarantee_unavailable'),
 prepared_at timestamptz not null default now(), unique(user_id,kind,local_date),
 check((kind='DAILY_WORDS' and cardinality(words)=3 and challenge_id is not null) or (kind='STREAK_AT_RISK' and words is null))
);
alter table public.notification_preferences enable row level security;
do $$begin
 if not exists(select 1 from pg_constraint where conrelid='private.notification_deliveries'::regclass and conname='notification_word_snapshot') then
  alter table private.notification_deliveries add constraint notification_word_snapshot check(kind<>'DAILY_WORDS' or
   (words is not null and cardinality(words)=3 and array_position(words,null) is null and array_position(words,'') is null));
 end if;
end;$$;
alter table private.push_installations enable row level security;
alter table private.notification_deliveries enable row level security;
revoke all on public.notification_preferences,private.push_installations,private.notification_deliveries from public,anon,authenticated,service_role;

create or replace function public.get_notification_preferences() returns jsonb
language plpgsql security definer set search_path='' as $$
declare viewer uuid:=private.safety_actor();p public.notification_preferences;
begin
 insert into public.notification_preferences(user_id) values(viewer) on conflict do nothing;
 select * into strict p from public.notification_preferences where user_id=viewer;
 return to_jsonb(p)-'next_check_at'||jsonb_build_object('timezone',(select timezone from public.user_language_profiles where user_id=viewer),'delivery_available',false);
end;$$;
create or replace function public.save_notification_preferences(notifications_enabled boolean,daily_enabled boolean,streak_enabled boolean,daily_at text,streak_at text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare viewer uuid:=private.safety_actor();
begin
 if notifications_enabled is null or daily_enabled is null or streak_enabled is null or daily_at is null or streak_at is null
 or daily_at !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or streak_at !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
 raise exception using errcode='22023',message='invalid_notification_preferences';end if;
 insert into public.notification_preferences(user_id,enabled,daily_words,streak_reminder,daily_time,streak_time)
 values(viewer,notifications_enabled,daily_enabled,streak_enabled,daily_at::time,streak_at::time)
 on conflict(user_id) do update set enabled=excluded.enabled,daily_words=excluded.daily_words,streak_reminder=excluded.streak_reminder,
 daily_time=excluded.daily_time,streak_time=excluded.streak_time,next_check_at=now();
 return public.get_notification_preferences();
end;$$;

create or replace function public.sync_push_installation(installation_id uuid,installation_secret text,installation_revision bigint,push_token text default null,device_platform text default null) returns void
language plpgsql security definer set search_path='' as $$
declare viewer uuid;sid uuid;existing private.push_installations;hashed text;
begin
 if installation_id is null or installation_secret is null or installation_secret !~ '^[0-9a-f]{64}$'
 or installation_revision is null or installation_revision<1 or installation_revision>9007199254740991 then raise exception using errcode='22023',message='invalid_push_installation';end if;
 hashed:=encode(extensions.digest(installation_secret,'sha256'),'hex');
 if push_token is not null then
  viewer:=private.safety_actor();
  perform 1 from auth.users where id=viewer for key share;
  sid:=nullif(auth.jwt()->>'session_id','')::uuid;
  if not exists(select 1 from auth.sessions s where s.id=sid and s.user_id=viewer and (s.not_after is null or s.not_after>now())) then
   raise exception using errcode='42501',message='notification_session_unavailable';end if;
  if device_platform is null or device_platform not in('ios','android') or push_token !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$' then raise exception using errcode='22023',message='invalid_push_token';end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(installation_id::text,1010));
 select * into existing from private.push_installations where id=installation_id for update;
 if found then
  if existing.secret_hash<>hashed then raise exception using errcode='42501',message='installation_unavailable';end if;
  if installation_revision<existing.revision then raise exception using errcode='40001',message='stale_installation_revision';end if;
  if installation_revision=existing.revision then
   if (existing.user_id,existing.session_id,existing.token,existing.platform) is distinct from(viewer,sid,push_token,case when push_token is not null then device_platform end) then
    raise exception using errcode='40001',message='stale_installation_revision';end if;
   return;
  end if;
 end if;
 -- A token belonging to another installation cannot be stolen or reassigned.
 insert into private.push_installations(id,secret_hash,revision,user_id,session_id,token,platform)
 values(installation_id,hashed,installation_revision,viewer,sid,push_token,case when push_token is not null then device_platform end)
 on conflict(id) do update set revision=excluded.revision,user_id=excluded.user_id,session_id=excluded.session_id,
 token=excluded.token,platform=excluded.platform,updated_at=now();
 if viewer is not null then
  insert into public.notification_preferences(user_id) values(viewer) on conflict(user_id) do update set next_check_at=now();
 end if;
end;$$;

create or replace function private.notification_timezone_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin update public.notification_preferences set next_check_at=now() where user_id=new.user_id;return new;end;$$;
drop trigger if exists notification_timezone_changed on public.user_language_profiles;
create trigger notification_timezone_changed after update of timezone on public.user_language_profiles for each row execute function private.notification_timezone_changed();

create or replace function private.next_notification_check(zone text,instant timestamptz,daily_at time,streak_at time) returns timestamptz
language sql stable set search_path='' as $$
 select coalesce(min(t),instant+interval '1 day') from (
  select (((instant at time zone zone)::date+offset_day)+at_time) at time zone zone t
  from generate_series(0,1) offset_day cross join lateral (values(daily_at),(streak_at)) times(at_time)
 ) due where t>instant;
$$;
create or replace function public.prepare_due_notifications(batch_size integer default 50) returns jsonb
language plpgsql security definer set search_path='' as $$
declare candidate record;p public.notification_preferences;zone text;instant timestamptz;day date;local_time time;
 payload jsonb;words text[];cid uuid;run_days integer;n integer:=0;before_count integer;failures integer:=0;next_due timestamptz;old_claims text;old_sub text;
begin
 if batch_size is null or batch_size not between 1 and 100 then raise exception using errcode='22023',message='invalid_notification_batch';end if;
 if not pg_try_advisory_xact_lock(101018001) then return jsonb_build_object('prepared',0,'failed',0,'delivery_available',false);end if;
 old_claims:=current_setting('request.jwt.claims',true);old_sub:=current_setting('request.jwt.claim.sub',true);
 for candidate in select user_id from public.notification_preferences where enabled and next_check_at<=now() order by next_check_at,user_id limit batch_size loop
  before_count:=n;
  begin
   -- Match challenge/settings/lifecycle order: profile, learning, preferences.
   perform 1 from public.profiles where id=candidate.user_id for update;
   select timezone into zone from public.user_language_profiles where user_id=candidate.user_id for update;
   select * into p from public.notification_preferences where user_id=candidate.user_id for update;
   instant:=clock_timestamp();day:=(instant at time zone zone)::date;local_time:=(instant at time zone zone)::time;
   if p.enabled and zone is not null and exists(select 1 from auth.users u join public.profiles pr on pr.id=u.id where u.id=p.user_id and u.deleted_at is null and (u.banned_until is null or u.banned_until<=instant) and pr.onboarding_completed_at is not null)
    and exists(select 1 from private.push_installations i join auth.sessions s on s.id=i.session_id and s.user_id=i.user_id where i.user_id=p.user_id and i.token is not null and (s.not_after is null or s.not_after>instant)) then
    if p.daily_words and local_time>=p.daily_time and not exists(select 1 from private.notification_deliveries where user_id=p.user_id and kind='DAILY_WORDS' and local_date=day) then
     -- Delegate generation to the audited Auth-derived implementation; this RPC
     -- is service-only and restores the transaction's identity afterward.
     perform set_config('request.jwt.claim.sub',p.user_id::text,true);
     perform set_config('request.jwt.claims',jsonb_build_object('sub',p.user_id)::text,true);
     payload:=public.get_or_create_today_challenge();cid:=(payload->'challenge'->>'id')::uuid;
     if (payload->'challenge'->>'local_challenge_date')::date<>day or (clock_timestamp() at time zone zone)::date<>day then raise exception 'notification_day_changed';end if;
     select array_agg(w->>'target_term' order by ord) into words from jsonb_array_elements(payload->'words') with ordinality e(w,ord);
     if cardinality(words)<>3 or array_position(words,null) is not null then raise exception 'incomplete_notification_challenge';end if;
     insert into private.notification_deliveries(user_id,kind,local_date,timezone,challenge_id,title,body,words)
      values(p.user_id,'DAILY_WORDS',day,zone,cid,'Today''s 3 words are ready',array_to_string(words,' · ')||E'\nOpen Langtify and find them in your day.',words) on conflict do nothing;
     n:=n+1;
    end if;
    if p.streak_reminder and local_time>=p.streak_time and not exists(select 1 from private.word_completions where user_id=p.user_id and local_date=day and revoked_at is null) then
     select coalesce(max(end_day-start_day+1),0) into run_days from private.progress_runs(p.user_id) where end_day=day-1;
     if run_days>0 then
      insert into private.notification_deliveries(user_id,kind,local_date,timezone,title,body)
       values(p.user_id,'STREAK_AT_RISK',day,zone,'Keep your '||run_days||'-day streak alive','Complete 1 word before today ends.') on conflict do nothing;
      if found then n:=n+1;end if;
     end if;
    end if;
   end if;
   next_due:=private.next_notification_check(zone,instant,case when p.daily_words then p.daily_time end,case when p.streak_reminder then p.streak_time end);
   update public.notification_preferences set next_check_at=coalesce(next_due,instant+interval '1 day') where user_id=candidate.user_id;
  exception when others then
   n:=before_count;
   -- One insufficient catalog or invalid account cannot starve later users.
   update public.notification_preferences set next_check_at=now()+interval '15 minutes' where user_id=candidate.user_id;
   failures:=failures+1;
  end;
 end loop;
 perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
 perform set_config('request.jwt.claims',coalesce(old_claims,''),true);
 return jsonb_build_object('prepared',n,'failed',failures,'delivery_available',false);
end;$$;
revoke all on function private.notification_timezone_changed() from public,anon,authenticated,service_role;
revoke all on function private.clear_deleted_push_owner() from public,anon,authenticated,service_role;
revoke all on function private.next_notification_check(text,timestamptz,time,time) from public,anon,authenticated,service_role;
revoke all on function public.get_notification_preferences(),public.save_notification_preferences(boolean,boolean,boolean,text,text) from public,anon,service_role;
grant execute on function public.get_notification_preferences(),public.save_notification_preferences(boolean,boolean,boolean,text,text) to authenticated;
revoke all on function public.sync_push_installation(uuid,text,bigint,text,text) from public,service_role;
-- Anonymous possession may only revoke; registering always verifies Auth/session.
grant execute on function public.sync_push_installation(uuid,text,bigint,text,text) to anon,authenticated;
revoke all on function public.prepare_due_notifications(integer) from public,anon,authenticated;
grant execute on function public.prepare_due_notifications(integer) to service_role;
commit;
