begin;
lock table public.submissions in share row exclusive mode;

-- Backend-only source facts. A deletion retains the fact and its original day.
create table private.word_completions (
  submission_id uuid primary key references public.submissions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  assignment_id uuid not null references public.daily_challenge_words(id) on delete cascade,
  challenge_id uuid not null references public.daily_challenges(id) on delete cascade,
  completed_at timestamptz not null,
  timezone text not null,
  local_date date not null,
  revoked_at timestamptz,
  time_source text not null check(time_source in ('server','legacy_challenge_snapshot')),
  check(local_date=(completed_at at time zone timezone)::date)
);
create index word_completions_days on private.word_completions(user_id,local_date) where revoked_at is null;
create unique index word_completions_live_assignment on private.word_completions(assignment_id) where revoked_at is null;
create index word_completions_owner_assignment on private.word_completions(user_id,assignment_id);
create index word_completions_challenge on private.word_completions(challenge_id);
create table private.progress_accounts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  revision bigint not null default 0 check(revision>=0)
);
-- Never delete these day identities when a photo is deleted/re-submitted.
create table private.qualified_days_seen (
  user_id uuid not null references public.profiles(id) on delete cascade,
  local_date date not null,
  primary key(user_id,local_date)
);
create table private.streak_milestones (
  user_id uuid not null references public.profiles(id) on delete cascade,
  milestone integer not null check(milestone in (3,7,14,30,60,100)),
  window_start date not null,
  window_end date not null,
  source_submission_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(user_id,milestone,window_end),
  check(window_end-window_start=milestone-1)
);
create table private.xp_awards (
  user_id uuid not null references public.profiles(id) on delete cascade,
  source_key text not null,
  event_type text not null check(event_type in ('WORD_COMPLETED','DAILY_CHALLENGE_BONUS','STREAK_MILESTONE')),
  reward integer not null check(reward in (10,25,40,75,125,200)),
  balance integer not null default 0,
  revision bigint not null default 0,
  last_submission_id uuid,
  primary key(user_id,source_key),
  check(balance=0 or balance=reward),
  check(event_type='STREAK_MILESTONE' or reward=10),
  check(revision>=0)
);
create table public.xp_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check(event_type in ('WORD_COMPLETED','DAILY_CHALLENGE_BONUS','STREAK_MILESTONE')),
  source_key text not null,
  source_revision bigint not null check(source_revision>0),
  amount integer not null check(amount<>0 and abs(amount) in (10,25,40,75,125,200)),
  cause_submission_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(user_id,source_key,source_revision),
  check(event_type='STREAK_MILESTONE' or abs(amount)=10)
);
create index xp_events_owner on public.xp_events(user_id,created_at,id);
alter table public.xp_events enable row level security;
revoke all on public.xp_events from public,anon,authenticated;
grant select on public.xp_events to authenticated;
create policy xp_events_read_own on public.xp_events for select to authenticated using(user_id=(select auth.uid()));
revoke all on private.word_completions,private.progress_accounts,private.qualified_days_seen,private.streak_milestones,private.xp_awards from public,anon,authenticated;

create function private.progress_time() returns timestamptz language sql volatile set search_path='' as $$select clock_timestamp()$$;
create function private.milestone_reward(days integer) returns integer language sql immutable set search_path='' as $$
  select case days when 3 then 10 when 7 then 25 when 14 then 40 when 30 then 75 when 60 then 125 when 100 then 200 end;
$$;
create function private.level_progress(total_xp bigint) returns jsonb language plpgsql stable set search_path='' as $$
declare level_number integer; level_start numeric; next_start numeric;
begin
  if total_xp is null or total_xp<0 then raise exception 'invalid_xp_total'; end if;
  level_number:=floor((sqrt(9+4*total_xp::numeric/25)-3)/2)::integer;
  level_start:=25::numeric*level_number*(level_number+3);
  next_start:=25::numeric*(level_number+1)*(level_number+4);
  return jsonb_build_object('level',level_number,'level_start_xp',level_start,'next_level_xp',next_start,
    'xp_into_level',total_xp-level_start,'xp_for_next_level',100+level_number::bigint*50);
end;
$$;
create function private.progress_runs(owner_id uuid) returns table(start_day date,end_day date,days integer)
language sql stable security definer set search_path='' as $$
  with qualified as(select distinct local_date from private.word_completions where user_id=owner_id and revoked_at is null),
  numbered as(select local_date,local_date-row_number() over(order by local_date)::integer as run from qualified)
  select min(local_date),max(local_date),count(*)::integer from numbered group by run;
$$;
create function private.set_xp_award(owner_id uuid,kind text,source text,reward_xp integer,eligible boolean,cause_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare award private.xp_awards; desired integer;
begin
  if eligible is null or cause_id is null or reward_xp is null then raise exception 'invalid_xp_source'; end if;
  desired:=case when eligible then reward_xp else 0 end;
  if desired=0 and not exists(select 1 from private.xp_awards where user_id=owner_id and source_key=source) then return; end if;
  insert into private.xp_awards(user_id,source_key,event_type,reward) values(owner_id,source,kind,reward_xp) on conflict do nothing;
  select * into strict award from private.xp_awards where user_id=owner_id and source_key=source for update;
  if award.reward<>reward_xp or award.event_type<>kind then raise exception 'xp_source_conflict'; end if;
  if award.balance=desired then return; end if;
  insert into public.xp_events(user_id,event_type,source_key,source_revision,amount,cause_submission_id)
    values(owner_id,kind,source,award.revision+1,desired-award.balance,cause_id);
  update private.xp_awards set balance=desired,revision=revision+1,last_submission_id=cause_id
    where user_id=owner_id and source_key=source;
end;
$$;
create function private.guard_xp_event() returns trigger language plpgsql security definer set search_path='' as $$
declare award private.xp_awards;
begin
  if tg_op='DELETE' and not exists(select 1 from public.profiles where id=old.user_id) then return old; end if;
  if tg_op<>'INSERT' then raise exception using errcode='23514',message='xp_history_immutable'; end if;
  select * into award from private.xp_awards where user_id=new.user_id and source_key=new.source_key for update;
  if not found or new.source_revision<>award.revision+1 or new.event_type<>award.event_type
    or new.amount<>(case when award.balance=0 then award.reward else -award.reward end) then
    raise exception using errcode='23514',message='invalid_xp_event'; end if;
  return new;
end;
$$;
create trigger guard_xp_event before insert or update or delete on public.xp_events for each row execute function private.guard_xp_event();

create function private.reconcile_progress(owner_id uuid,cause_id uuid,new_day date default null)
returns void language plpgsql security definer set search_path='' as $$
declare entry record; first_day boolean:=false; run_start date; run_length integer;
begin
  perform 1 from public.profiles where id=owner_id for update;
  if not found then return; end if;
  insert into private.progress_accounts(user_id) values(owner_id) on conflict do nothing;
  -- A real row version change also makes stale REPEATABLE READ writers abort.
  update private.progress_accounts set revision=revision+1 where user_id=owner_id;
  if new_day is not null then
    insert into private.qualified_days_seen(user_id,local_date) values(owner_id,new_day) on conflict do nothing;
    first_day:=found;
    if first_day then
      select r.start_day,(new_day-r.start_day+1) into run_start,run_length
        from private.progress_runs(owner_id) r where new_day between r.start_day and r.end_day;
      if private.milestone_reward(run_length) is not null then
        insert into private.streak_milestones(user_id,milestone,window_start,window_end,source_submission_id)
        values(owner_id,run_length,run_start,new_day,cause_id) on conflict do nothing;
      end if;
    end if;
  end if;
  -- Reconcile sources that exist now and previously earned sources no longer present.
  for entry in
    select 'WORD_COMPLETED'::text kind,'word:'||w.assignment_id::text source,10 reward,bool_or(w.revoked_at is null) eligible
      from private.word_completions w where w.user_id=owner_id group by w.assignment_id
    union all
    select 'DAILY_CHALLENGE_BONUS','challenge:'||w.challenge_id::text,10,count(*) filter(where w.revoked_at is null)=3
      from private.word_completions w where w.user_id=owner_id group by w.challenge_id
  loop
    perform private.set_xp_award(owner_id,entry.kind,entry.source,entry.reward,entry.eligible,cause_id);
  end loop;
  for entry in select a.* from private.xp_awards a where a.user_id=owner_id and a.balance>0 and (
      (a.event_type='WORD_COMPLETED' and not exists(select 1 from private.word_completions w where w.user_id=owner_id and 'word:'||w.assignment_id::text=a.source_key)) or
      (a.event_type='DAILY_CHALLENGE_BONUS' and not exists(select 1 from private.word_completions w where w.user_id=owner_id and 'challenge:'||w.challenge_id::text=a.source_key))) loop
    perform private.set_xp_award(owner_id,entry.event_type,entry.source_key,entry.reward,false,cause_id);
  end loop;
  -- A historical deletion can invalidate a window, but cannot manufacture awards.
  -- If timezone travel merges runs, retain only one eligible reward per threshold/run.
  for entry in
    with eligible as (
      select m.milestone,m.window_end,row_number() over(partition by r.start_day,m.milestone order by m.created_at,m.window_end) priority
      from private.streak_milestones m join private.progress_runs(owner_id) r
        on m.window_start>=r.start_day and m.window_end<=r.end_day where m.user_id=owner_id
    ) select m.*,coalesce(e.priority=1,false) eligible from private.streak_milestones m
      left join eligible e using(milestone,window_end) where m.user_id=owner_id
  loop
    perform private.set_xp_award(owner_id,'STREAK_MILESTONE','milestone:'||entry.milestone::text||':'||entry.window_end::text,
      private.milestone_reward(entry.milestone),entry.eligible,cause_id);
  end loop;
end;
$$;

create function private.submission_progress() returns trigger language plpgsql security definer set search_path='' as $$
declare stamp timestamptz; zone text; day date;
begin
  if tg_op='DELETE' then
    delete from private.word_completions where submission_id=old.id;
    if old.submitted_at is not null then perform private.reconcile_progress(old.user_id,old.id); end if;
    return old;
  end if;
  if old.status='pending' and new.status='completed' then
    -- No caller date, timezone or XP amount is accepted.
    stamp:=private.progress_time();
    select timezone into strict zone from public.user_language_profiles where user_id=new.user_id;
    day:=(stamp at time zone zone)::date;
    insert into private.word_completions(submission_id,user_id,assignment_id,challenge_id,completed_at,timezone,local_date,time_source)
    values(new.id,new.user_id,new.daily_challenge_word_id,new.daily_challenge_id,stamp,zone,day,'server');
    perform private.reconcile_progress(new.user_id,new.id,day);
  elsif new.status='deleted' and old.submitted_at is not null then
    update private.word_completions set revoked_at=new.deleted_at where submission_id=new.id and revoked_at is null;
    perform private.reconcile_progress(new.user_id,new.id);
  end if;
  return new;
end;
$$;
create trigger submission_progress after update of status or delete on public.submissions for each row execute function private.submission_progress();

-- Cleanup must acquire the same owner/assignment locks as owner finalization.
create or replace function public.finish_photo_cleanup(object_path text) returns void
language plpgsql security definer set search_path='' as $$
declare s public.submissions;
begin
  select * into s from public.submissions where storage_path=object_path;
  if found then
    perform 1 from public.profiles where id=s.user_id for update;
    perform 1 from public.daily_challenge_words where id=s.daily_challenge_word_id for update;
  end if;
  if private.submission_object_exists(object_path) then raise exception using errcode='23514',message='photo_not_deleted'; end if;
  update public.submissions set status='deleted' where storage_path=object_path and status='deleting';
  delete from private.photo_cleanup_queue where storage_path=object_path;
end;
$$;

create function public.get_my_progress(challenge_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid(); zone text; today date; xp bigint; current_days integer:=0; longest integer:=0; completed integer:=0; challenge uuid:=challenge_id;
begin
  perform 1 from public.profiles where id=caller and onboarding_completed_at is not null for update;
  if not found then raise exception using errcode='42501',message='onboarding_required'; end if;
  select timezone into strict zone from public.user_language_profiles where user_id=caller;
  today:=(private.progress_time() at time zone zone)::date;
  if challenge is not null and not exists(select 1 from public.daily_challenges c where c.id=challenge and c.user_id=caller) then
    raise exception using errcode='42501',message='challenge_unavailable'; end if;
  if challenge is null then select c.id into challenge from public.daily_challenges c where c.user_id=caller and c.local_challenge_date=today; end if;
  select count(*) into completed from private.word_completions w where w.user_id=caller and w.challenge_id=challenge and w.revoked_at is null;
  select coalesce(sum(amount),0) into xp from public.xp_events where user_id=caller;
  select coalesce(max(days),0) into longest from private.progress_runs(caller);
  select coalesce(max(least(r.end_day,today)-r.start_day+1),0) into current_days
    from private.progress_runs(caller) r where r.start_day<=today and r.end_day>=today-1;
  return private.level_progress(xp)||jsonb_build_object('user_id',caller,'local_date',today,'timezone',zone,'challenge_id',challenge,
    'completed_words',completed,'total_xp',xp,'current_streak',current_days,'longest_streak',longest,
    'total_words_completed',(select count(*) from private.word_completions where user_id=caller and revoked_at is null),
    'total_challenges_completed',(select count(*) from (select w.challenge_id from private.word_completions w
      where w.user_id=caller and w.revoked_at is null group by w.challenge_id having count(*)=3) full_challenges));
end;
$$;
create function public.get_submission_xp(submission_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.submissions; word_xp integer; bonus integer; milestones integer;
begin
  select * into s from public.submissions where id=submission_id and user_id=auth.uid();
  if not found then raise exception using errcode='42501',message='submission_unavailable'; end if;
  select coalesce(sum(balance) filter(where event_type='WORD_COMPLETED'),0),
    coalesce(sum(balance) filter(where event_type='DAILY_CHALLENGE_BONUS'),0),
    coalesce(sum(balance) filter(where event_type='STREAK_MILESTONE'),0)
    into word_xp,bonus,milestones from private.xp_awards where user_id=s.user_id and last_submission_id=s.id;
  return jsonb_build_object('user_id',s.user_id,'submission_id',s.id,'word_xp',word_xp,'challenge_bonus_xp',bonus,'milestone_xp',milestones,
    'total_awarded_xp',word_xp+bonus+milestones);
end;
$$;
revoke all on function public.get_my_progress(uuid),public.get_submission_xp(uuid) from public,anon,authenticated;
grant execute on function public.get_my_progress(uuid),public.get_submission_xp(uuid) to authenticated;
revoke all on all functions in schema private from public,anon,authenticated;

-- Phase 4 did not snapshot the finalization timezone. Use the saved challenge
-- timezone, explicitly label the approximation, and replay both lifecycle events.
-- Replaying completion before its later deletion preserves non-farmable identities.
do $$ declare e record; s record; day date; begin
  for e in
    select id,submitted_at stamp,false revoked from public.submissions where submitted_at is not null
    union all select id,deleted_at,true from public.submissions where submitted_at is not null and deleted_at is not null
    order by stamp,revoked,id
  loop
    select sub.*,c.timezone into strict s from public.submissions sub join public.daily_challenges c on c.id=sub.daily_challenge_id where sub.id=e.id;
    if e.revoked then
      update private.word_completions set revoked_at=s.deleted_at where submission_id=s.id;
      perform private.reconcile_progress(s.user_id,s.id);
    else
      day:=(s.submitted_at at time zone s.timezone)::date;
      insert into private.word_completions(submission_id,user_id,assignment_id,challenge_id,completed_at,timezone,local_date,time_source)
        values(s.id,s.user_id,s.daily_challenge_word_id,s.daily_challenge_id,s.submitted_at,s.timezone,day,'legacy_challenge_snapshot');
      perform private.reconcile_progress(s.user_id,s.id,day);
    end if;
  end loop;
end $$;
commit;
