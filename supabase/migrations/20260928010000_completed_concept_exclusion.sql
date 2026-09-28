-- Permanently exclude verified completions from new daily assignments/replacements.
begin;
-- Drain owner mutations before backfill; maintain owner -> submission lock order.
lock table public.profiles in exclusive mode;
lock table public.submissions in share row exclusive mode;

-- Never guess a semantic identity if trusted legacy maintenance erased both
-- submission and assignment. Abort atomically for reviewed repair on first install.
do $$begin
  if to_regclass('private.completed_concepts') is null and exists(
    select 1 from public.xp_events e
    left join public.submissions s on s.id=e.cause_submission_id and s.user_id=e.user_id
    left join public.daily_challenge_words w on e.source_key='word:'||w.id::text
    left join public.daily_challenges c on c.id=w.daily_challenge_id and c.user_id=e.user_id
    where e.event_type='WORD_COMPLETED' and e.amount>0
      and s.id is null and c.id is null
  ) then raise exception 'completed_concept_history_requires_review'; end if;
end $$;

create table if not exists private.completed_concepts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  concept_id uuid not null references public.vocabulary_concepts(id),
  first_submission_id uuid not null,
  first_completed_at timestamptz not null check(isfinite(first_completed_at)),
  primary key(user_id,concept_id)
);
alter table private.completed_concepts enable row level security;
revoke all on private.completed_concepts from public,anon,authenticated;

-- submitted_at survives soft deletion. Signed positive word events additionally
-- recover identity after a hard photo deletion while its assignment still exists.
insert into private.completed_concepts(user_id,concept_id,first_submission_id,first_completed_at)
select distinct on(user_id,concept_id) user_id,concept_id,submission_id,completed_at from (
  select s.user_id,s.concept_id,s.id submission_id,s.submitted_at completed_at
    from public.submissions s where s.submitted_at is not null
  union all
  select e.user_id,w.concept_id,e.cause_submission_id,e.created_at
    from public.xp_events e join public.daily_challenge_words w on e.source_key='word:'||w.id::text
    join public.daily_challenges c on c.id=w.daily_challenge_id and c.user_id=e.user_id
    where e.event_type='WORD_COMPLETED' and e.amount>0
) evidence order by user_id,concept_id,completed_at,submission_id
on conflict(user_id,concept_id) do nothing;

create or replace function private.remember_completed_concept() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  -- The existing byte attestation/lifecycle/commit guards authorize this transition.
  -- Any later transaction failure rolls back this fact too. Never key off visibility.
  insert into private.completed_concepts(user_id,concept_id,first_submission_id,first_completed_at)
    values(new.user_id,new.concept_id,new.id,new.submitted_at)
    on conflict(user_id,concept_id) do nothing;
  return new;
end;$$;
drop trigger if exists remember_completed_concept on public.submissions;
create trigger remember_completed_concept after update of status on public.submissions
  for each row when(old.status='pending' and new.status='completed')
  execute function private.remember_completed_concept();

create or replace function private.preserve_completed_concept() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' or exists(select 1 from public.profiles where id=old.user_id) then
    raise exception using errcode='23514',message='completed_concept_immutable';
  end if;
  return old;
end;$$;
drop trigger if exists preserve_completed_concept on private.completed_concepts;
create trigger preserve_completed_concept before update or delete on private.completed_concepts
  for each row execute function private.preserve_completed_concept();

create or replace function private.assign_challenge_word(challenge_id uuid, requested_slot text) returns void
language plpgsql security definer set search_path = '' as $$
declare challenge public.daily_challenges; selected_id uuid; level text;
begin
  -- Share the existing owner/revision lock order with photo finalization. A real
  -- revision update rejects pre-completion REPEATABLE READ selection snapshots.
  select * into strict challenge from public.daily_challenges where id=challenge_id;
  perform 1 from public.profiles where id=challenge.user_id for update;
  insert into private.progress_accounts(user_id) values(challenge.user_id) on conflict do nothing;
  update private.progress_accounts set revision=revision+1 where user_id=challenge.user_id;
  select * into strict challenge from public.daily_challenges where id=challenge_id for update;
  level := private.slot_level(challenge.cefr_level,requested_slot);
  select t.id into selected_id
  from public.vocabulary_terms t
  join public.vocabulary_concepts c on c.id=t.concept_id
  join public.vocabulary_terms r on r.concept_id=c.id and r.language_id=challenge.reference_language_id
  where t.language_id=challenge.target_language_id and t.cefr_level=level
    and t.is_active and r.is_active and c.is_active and c.is_photographable
    and not exists(select 1 from private.completed_concepts done
      where done.user_id=challenge.user_id and done.concept_id=c.id)
    and not exists(select 1 from public.daily_challenge_words w where w.daily_challenge_id=challenge.id and w.concept_id=c.id)
  order by (select max(w.assigned_at) from public.daily_challenge_words w
    join public.daily_challenges h on h.id=w.daily_challenge_id
    where h.user_id=challenge.user_id and w.concept_id=c.id) asc nulls first, random()
  limit 1 for share of t,c,r;
  if selected_id is null then
    raise exception using errcode='P0001', message='insufficient_vocabulary';
  end if;
  insert into public.daily_challenge_words(daily_challenge_id,slot,cefr_level,vocabulary_term_id)
    values (challenge.id,requested_slot,level,selected_id);
end;
$$;

revoke all on function private.assign_challenge_word(uuid,text),private.remember_completed_concept(),
  private.preserve_completed_concept() from public,anon,authenticated;
commit;
