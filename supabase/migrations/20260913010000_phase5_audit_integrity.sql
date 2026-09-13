begin;
lock table public.submissions in share row exclusive mode;
lock table private.xp_awards,public.xp_events,private.streak_milestones in share row exclusive mode;

-- Preserve durable history. A previously non-ISO session may have minted aliases;
-- locale-dependent dates can be ambiguous, so do not guess or rewrite the ledger.
-- Refuse inconsistent existing state atomically for reviewed signed reconciliation.
do $$ begin
  if exists (
    select 1 from private.xp_awards a where a.event_type='STREAK_MILESTONE' and not exists (
      select 1 from private.streak_milestones m where m.user_id=a.user_id
        and a.source_key='milestone:'||m.milestone::text||':'||to_char(m.window_end::timestamp,'YYYY-MM-DD')
        and a.reward=private.milestone_reward(m.milestone)
    )
  ) then raise exception 'Existing milestone source keys require reviewed reconciliation before Phase 5 audit'; end if;
  if exists (
    select 1 from private.xp_awards a full join (
      select user_id,source_key,sum(amount) balance,max(source_revision) revision,count(*) events
      from public.xp_events group by user_id,source_key
    ) e using(user_id,source_key)
    where a.user_id is null or a.balance<>coalesce(e.balance,0)
      or a.revision<>coalesce(e.revision,0) or a.revision<>coalesce(e.events,0)
  ) then raise exception 'Existing XP ledger and source balances require reviewed reconciliation before Phase 5 audit'; end if;
end $$;

create or replace function private.level_progress(total_xp bigint) returns jsonb language plpgsql stable set search_path='' as $$
declare level_number integer; level_start numeric; next_start numeric;
begin
  if total_xp is null or total_xp<0 then raise exception 'invalid_xp_total'; end if;
  level_number:=floor((sqrt(9+4*total_xp::numeric/25)-3)/2)::integer;
  -- Numeric sqrt can round upward near very large thresholds. Use it only as
  -- an estimate, then compare exact integer-valued numeric thresholds.
  while 25::numeric*level_number*(level_number+3)>total_xp loop
    level_number:=level_number-1;
  end loop;
  while 25::numeric*(level_number+1)*(level_number+4)<=total_xp loop
    level_number:=level_number+1;
  end loop;
  level_start:=25::numeric*level_number*(level_number+3);
  next_start:=25::numeric*(level_number+1)*(level_number+4);
  return jsonb_build_object('level',level_number,'level_start_xp',level_start,'next_level_xp',next_start,
    'xp_into_level',total_xp-level_start,'xp_for_next_level',100+level_number::bigint*50);
end;
$$;
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
    perform private.set_xp_award(owner_id,'STREAK_MILESTONE','milestone:'||entry.milestone::text||':'||to_char(entry.window_end::timestamp,'YYYY-MM-DD'),
      private.milestone_reward(entry.milestone),entry.eligible,cause_id);
  end loop;
end;
$$;

-- Function replacement preserves existing grants; make the private boundary explicit.
revoke all on function private.level_progress(bigint),private.reconcile_progress(uuid,uuid,date) from public,anon,authenticated;
commit;
