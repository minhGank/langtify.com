begin;

-- Existing reservations retain daily semantics, including interrupted uploads.
-- New historical reservations are explicit; neither image source nor caller time
-- controls their learning effects. The existing immutable-identity trigger also
-- prevents changing capture_kind after the reservation has been created.
lock table public.submissions in share row exclusive mode;
alter table public.submissions add column if not exists capture_kind text not null
  default 'daily' check(capture_kind in ('daily','historical'));

create table if not exists private.historical_captures (
  submission_id uuid primary key references public.submissions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  assignment_id uuid not null references public.daily_challenge_words(id) on delete cascade,
  challenge_id uuid not null references public.daily_challenges(id) on delete cascade,
  captured_at timestamptz not null,
  revoked_at timestamptz
);
create unique index if not exists historical_captures_live_assignment
  on private.historical_captures(assignment_id) where revoked_at is null;
create index if not exists historical_captures_owner_assignment
  on private.historical_captures(user_id,assignment_id);
alter table private.historical_captures enable row level security;
revoke all on private.historical_captures from public,anon,authenticated;

create or replace function private.guard_historical_capture() returns trigger
language plpgsql security definer set search_path='' as $$
declare s public.submissions;
begin
  if tg_op='DELETE' then
    if exists(select 1 from public.submissions where id=old.submission_id)
      and exists(select 1 from public.profiles where id=old.user_id)
      and exists(select 1 from public.daily_challenges where id=old.challenge_id) then
      raise exception using errcode='23514',message='historical_capture_immutable';
    end if;
    return old;
  end if;
  select * into s from public.submissions where id=new.submission_id;
  if s.id is null or s.capture_kind<>'historical' or s.user_id<>new.user_id
    or s.daily_challenge_word_id<>new.assignment_id or s.daily_challenge_id<>new.challenge_id then
    raise exception using errcode='23514',message='invalid_historical_capture';
  end if;
  if tg_op='INSERT' then
    if s.status<>'completed' or new.revoked_at is not null
      or exists(select 1 from private.word_completions where assignment_id=new.assignment_id and revoked_at is null) then
      raise exception using errcode='23514',message='invalid_historical_capture';
    end if;
  elsif (to_jsonb(new)-'revoked_at') is distinct from (to_jsonb(old)-'revoked_at')
    or old.revoked_at is not null or s.status<>'deleted' or new.revoked_at is distinct from s.deleted_at then
    raise exception using errcode='23514',message='historical_capture_immutable';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_historical_capture on private.historical_captures;
create trigger guard_historical_capture before insert or update or delete on private.historical_captures
  for each row execute function private.guard_historical_capture();

create index if not exists daily_challenges_past_owner_date
  on public.daily_challenges(user_id,local_challenge_date desc,id);
create index if not exists daily_challenge_words_past_page
  on public.daily_challenge_words(daily_challenge_id,id desc) where replaced_at is null;

-- Private derived read index, never an XP authority. It lets missing-first pages
-- seek directly into a long owner's history instead of sorting all assignments.
create table if not exists private.past_word_entries (
  assignment_id uuid primary key references public.daily_challenge_words(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  challenge_date date not null,
  has_capture boolean not null default false
);
create index if not exists past_word_entries_page on private.past_word_entries
  (user_id,has_capture,challenge_date desc,assignment_id desc);
alter table private.past_word_entries enable row level security;
revoke all on private.past_word_entries from public,anon,authenticated;

create or replace function private.index_past_word_assignment() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.replaced_at is not null then
    delete from private.past_word_entries where assignment_id=new.id;
  else
    insert into private.past_word_entries(assignment_id,user_id,challenge_date)
      select new.id,c.user_id,c.local_challenge_date from public.daily_challenges c where c.id=new.daily_challenge_id
      on conflict(assignment_id) do nothing;
  end if;
  return new;
end;
$$;


drop trigger if exists index_past_word_assignment on public.daily_challenge_words;
create trigger index_past_word_assignment after insert or update of replaced_at on public.daily_challenge_words
  for each row execute function private.index_past_word_assignment();

create or replace function private.index_past_word_capture() returns trigger
language plpgsql security definer set search_path='' as $$
declare assignment uuid;
begin
  assignment:=case when tg_op='DELETE' then old.daily_challenge_word_id else new.daily_challenge_word_id end;
  update private.past_word_entries set has_capture=exists(
    select 1 from public.submissions s where s.daily_challenge_word_id=assignment
      and s.status in ('completed','deleting') and s.submitted_at is not null)
    where assignment_id=assignment;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists index_past_word_capture on public.submissions;
create trigger index_past_word_capture after insert or update of status or delete on public.submissions
  for each row execute function private.index_past_word_capture();

insert into private.past_word_entries(assignment_id,user_id,challenge_date,has_capture)
  select w.id,c.user_id,c.local_challenge_date,exists(select 1 from public.submissions s
    where s.daily_challenge_word_id=w.id and s.status in ('completed','deleting') and s.submitted_at is not null)
  from public.daily_challenge_words w join public.daily_challenges c on c.id=w.daily_challenge_id where w.replaced_at is null
  on conflict(assignment_id) do update set has_capture=excluded.has_capture;

-- Called only after the existing profile/assignment lock. The persisted learning
-- timezone is authoritative and the same server clock drives progress reads.
create or replace function private.photo_local_date(owner_id uuid) returns date
language sql volatile security definer set search_path='' as $$
  select (private.progress_time() at time zone l.timezone)::date
  from public.user_language_profiles l where l.user_id=owner_id;
$$;

create or replace function public.reserve_submission(assignment_id uuid) returns public.submissions
language plpgsql security definer set search_path='' as $$
declare s public.submissions; assigned_date date;
begin
  perform private.lock_photo_assignment(assignment_id);
  select * into s from public.submissions where daily_challenge_word_id=assignment_id and status<>'deleted' for update;
  if found then
    if s.capture_kind<>'daily' then raise exception using errcode='23514',message='capture_kind_conflict'; end if;
    return s;
  end if;
  select c.local_challenge_date into strict assigned_date
    from public.daily_challenge_words w join public.daily_challenges c on c.id=w.daily_challenge_id where w.id=assignment_id;
  if assigned_date is distinct from private.photo_local_date(auth.uid()) then
    raise exception using errcode='23514',message='past_word_requires_historical_capture';
  end if;
  insert into public.submissions(daily_challenge_word_id,capture_kind) values(assignment_id,'daily') returning * into s;
  return s;
end;
$$;

create or replace function public.reserve_historical_submission(assignment_id uuid) returns public.submissions
language plpgsql security definer set search_path='' as $$
declare s public.submissions; assigned_date date; today date;
begin
  perform private.lock_photo_assignment(assignment_id);
  select * into s from public.submissions where daily_challenge_word_id=assignment_id and status<>'deleted' for update;
  if found then
    if s.capture_kind<>'historical' then raise exception using errcode='23514',message='capture_kind_conflict'; end if;
    return s;
  end if;
  select c.local_challenge_date into strict assigned_date
    from public.daily_challenge_words w join public.daily_challenges c on c.id=w.daily_challenge_id where w.id=assignment_id;
  today:=private.photo_local_date(auth.uid());
  if today is null or assigned_date>=today then
    raise exception using errcode='23514',message='historical_assignment_required';
  end if;
  insert into public.submissions(daily_challenge_word_id,capture_kind) values(assignment_id,'historical') returning * into s;
  return s;
end;
$$;

create or replace function public.get_assignment_photo(assignment_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare today date;
begin
  perform private.lock_photo_assignment(assignment_id);
  today:=private.photo_local_date(auth.uid());
  return (select jsonb_build_object('assignment',to_jsonb(w),'challenge',to_jsonb(c),'submission',to_jsonb(s),
    'current_local_date',today,
    'can_capture_daily',case when s.id is null then c.local_challenge_date=today else s.status='pending' and s.capture_kind='daily' end,
    'can_capture_historical',case when s.id is null then c.local_challenge_date<today else s.status='pending' and s.capture_kind='historical' end)
    from public.daily_challenge_words w join public.daily_challenges c on c.id=w.daily_challenge_id
    left join public.submissions s on s.daily_challenge_word_id=w.id and s.status<>'deleted'
    where w.id=assignment_id);
end;
$$;

-- One assignment entitlement is shared across daily and historical facts. Daily
-- full bonuses, streak days and milestone windows continue to read ONLY the
-- original daily completion facts, never historical_captures.
create or replace function private.reconcile_progress(owner_id uuid,cause_id uuid,new_day date default null)
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
      from (
        select assignment_id,revoked_at from private.word_completions where user_id=owner_id
        union all select assignment_id,revoked_at from private.historical_captures where user_id=owner_id
      ) w group by w.assignment_id
    union all
    select 'DAILY_CHALLENGE_BONUS','challenge:'||w.challenge_id::text,10,count(*) filter(where w.revoked_at is null)=3
      from private.word_completions w where w.user_id=owner_id group by w.challenge_id
  loop
    perform private.set_xp_award(owner_id,entry.kind,entry.source,entry.reward,entry.eligible,cause_id);
  end loop;
  for entry in select a.* from private.xp_awards a where a.user_id=owner_id and a.balance>0 and (
      (a.event_type='WORD_COMPLETED' and not exists(select 1 from private.word_completions w where w.user_id=owner_id and 'word:'||w.assignment_id::text=a.source_key) and not exists(select 1 from private.historical_captures h where h.user_id=owner_id and 'word:'||h.assignment_id::text=a.source_key)) or
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
    perform private.set_xp_award(owner_id,'STREAK_MILESTONE','milestone:'||entry.milestone::text||':'||to_char(entry.window_end::timestamp,'YYYY-MM-DD'),
      private.milestone_reward(entry.milestone),entry.eligible,cause_id);
  end loop;
end;
$$;

create or replace function public.get_my_past_words(
  search_text text default '',
  requested_level text default null,
  before_captured boolean default null,
  before_date date default null,
  before_id uuid default null,
  page_size integer default 20
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); today date; result jsonb;
begin
  if viewer is null then raise exception using errcode='42501',message='authentication_required'; end if;
  perform 1 from public.profiles where id=viewer and onboarding_completed_at is not null;
  if not found then raise exception using errcode='42501',message='onboarding_required'; end if;
  if page_size is null or page_size not between 1 and 40 or length(coalesce(search_text,''))>64
    or (requested_level is not null and requested_level not in ('A1','A2','B1','B2','C1','C2'))
    or (before_captured is null)<>(before_date is null) or (before_date is null)<>(before_id is null)
    or (before_date is not null and not isfinite(before_date)) then
    raise exception using errcode='22023',message='invalid_past_words_query';
  end if;
  today:=private.photo_local_date(viewer);
  -- Seek each capture partition independently. At most 2*(page_size+1) rows
  -- reach the final ordering, including under a generic prepared query plan.
  with page as materialized (
    select item.* from (values(false),(true)) capture_partition(captured)
    cross join lateral (
      select e.assignment_id,w.concept_id,e.challenge_date,w.target_term,w.reference_term,w.cefr_level,
        e.has_capture,s.id as submission_id,s.status as submission_status,s.capture_kind
      from private.past_word_entries e join public.daily_challenge_words w on w.id=e.assignment_id
      left join public.submissions s on s.daily_challenge_word_id=e.assignment_id and s.status<>'deleted'
      where e.user_id=viewer and e.has_capture=capture_partition.captured and e.challenge_date<today
        and (before_captured is null or capture_partition.captured>=before_captured)
        and (e.challenge_date,e.assignment_id)<(
          case when capture_partition.captured=before_captured then before_date else 'infinity'::date end,
          case when capture_partition.captured=before_captured then before_id else 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid end)
        and w.replaced_at is null
        and (requested_level is null or w.cefr_level=requested_level)
        and (strpos(lower(w.target_term),lower(btrim(coalesce(search_text,''))))>0
          or strpos(lower(w.reference_term),lower(btrim(coalesce(search_text,''))))>0)
      order by e.challenge_date desc,e.assignment_id desc limit page_size+1
    ) item
    order by item.has_capture,item.challenge_date desc,item.assignment_id desc limit page_size+1
  ), shown as (select * from page order by has_capture,challenge_date desc,assignment_id desc limit page_size)
  select jsonb_build_object('user_id',viewer,'current_local_date',today,
    'items',coalesce((select jsonb_agg(to_jsonb(s) order by has_capture,challenge_date desc,assignment_id desc) from shown s),'[]'::jsonb),
    'has_more',(select count(*)>page_size from page)) into result;
  return result;
end;
$$;

create or replace function private.submission_progress() returns trigger
language plpgsql security definer set search_path='' as $$
declare stamp timestamptz; zone text; day date;
begin
  if tg_op='DELETE' then
    delete from private.word_completions where submission_id=old.id;
    delete from private.historical_captures where submission_id=old.id;
    if old.submitted_at is not null then perform private.reconcile_progress(old.user_id,old.id); end if;
    return old;
  end if;
  if old.status='pending' and new.status='completed' then
    stamp:=private.progress_time();
    if new.capture_kind='historical' then
      insert into private.historical_captures(submission_id,user_id,assignment_id,challenge_id,captured_at)
        values(new.id,new.user_id,new.daily_challenge_word_id,new.daily_challenge_id,stamp);
      -- Never supply a qualifying date or create a daily completion fact here.
      perform private.reconcile_progress(new.user_id,new.id);
    else
      select timezone into strict zone from public.user_language_profiles where user_id=new.user_id;
      day:=(stamp at time zone zone)::date;
      insert into private.word_completions(submission_id,user_id,assignment_id,challenge_id,completed_at,timezone,local_date,time_source)
        values(new.id,new.user_id,new.daily_challenge_word_id,new.daily_challenge_id,stamp,zone,day,'server');
      perform private.reconcile_progress(new.user_id,new.id,day);
    end if;
  elsif new.status='deleted' and old.submitted_at is not null then
    update private.word_completions set revoked_at=new.deleted_at where submission_id=new.id and revoked_at is null;
    update private.historical_captures set revoked_at=new.deleted_at where submission_id=new.id and revoked_at is null;
    perform private.reconcile_progress(new.user_id,new.id);
  end if;
  return new;
end;
$$;

-- Timezone travel may make an admitted historical assignment today's challenge
-- again. Expose its immutable photo kind so the existing card can distinguish a
-- saved dictionary photo from a daily completion without changing either fact.
create or replace function private.challenge_payload(challenge_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('challenge',to_jsonb(c),'words',(
    select jsonb_agg(to_jsonb(w)||jsonb_build_object('submission',
      (select jsonb_build_object('id',s.id,'status',s.status,'submitted_at',s.submitted_at,'capture_kind',s.capture_kind)
       from public.submissions s where s.daily_challenge_word_id=w.id and s.status<>'deleted'))
      order by case w.slot when 'review' then 1 when 'target' then 2 else 3 end)
    from public.daily_challenge_words w where w.daily_challenge_id=c.id and w.replaced_at is null))
  from public.daily_challenges c where c.id=challenge_id and c.user_id=auth.uid();
$$;

revoke all on function private.photo_local_date(uuid),private.index_past_word_assignment(),private.index_past_word_capture(),private.guard_historical_capture(),private.challenge_payload(uuid),
  private.submission_progress(),private.reconcile_progress(uuid,uuid,date) from public,anon,authenticated;
revoke all on function public.get_my_past_words(text,text,boolean,date,uuid,integer),public.reserve_historical_submission(uuid),
  public.reserve_submission(uuid),public.get_assignment_photo(uuid) from public,anon,authenticated;
grant execute on function public.get_my_past_words(text,text,boolean,date,uuid,integer),public.reserve_historical_submission(uuid),
  public.reserve_submission(uuid),public.get_assignment_photo(uuid) to authenticated;
commit;
