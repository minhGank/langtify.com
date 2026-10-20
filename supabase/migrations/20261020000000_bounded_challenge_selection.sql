begin;

-- Old rows (and trusted legacy fixtures) remain v1. Only the generation RPC opts
-- new challenges into v2. Replay must never upgrade an existing challenge.
alter table public.daily_challenges add column if not exists selection_policy_version
  smallint not null default 1 check(selection_policy_version in (1,2));

create or replace function private.selection_level_allowed(learner text, actual text)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(l is not null and a is not null and a between case when l=6 then 4 else greatest(1,l-1) end
    and least(6,l+1),false)
  from (select array_position(array['A1','A2','B1','B2','C1','C2'],learner) l,
    array_position(array['A1','A2','B1','B2','C1','C2'],actual) a) ranks;
$$;

-- Evaluate the complete multiset, never greedy slot-by-slot availability.
-- Rank: C2 consolidation count, preferred-pattern distance, target-level count,
-- lower total difficulty, then lexical level order. At most 56 sorted patterns.
create or replace function private.challenge_level_plan(learner text, available integer[])
returns text[] language plpgsql immutable set search_path='' as $$
declare levels text[]:=array['A1','A2','B1','B2','C1','C2'];
  l integer:=array_position(levels,learner); result text[];
begin
  if l is null or array_ndims(available) is distinct from 1 or array_length(available,1) is distinct from 6
    or array_lower(available,1) is distinct from 1
    or exists(select 1 from unnest(available) n where n is null or n<0) then
    raise exception using errcode='23514',message='invalid_selection_pool';
  end if;
  select array[levels[a],levels[b],levels[c]] into result
  from generate_series(1,6) a cross join generate_series(1,6) b cross join generate_series(1,6) c
  where a<=b and b<=c
    and private.selection_level_allowed(learner,levels[a])
    and private.selection_level_allowed(learner,levels[b])
    and private.selection_level_allowed(learner,levels[c])
    and (a>l)::integer+(b>l)::integer+(c>l)::integer<=1
    and not exists(select 1 from generate_series(1,6) n
      where (a=n)::integer+(b=n)::integer+(c=n)::integer>available[n])
  order by case when l=6 then (a=4)::integer+(b=4)::integer+(c=4)::integer else 0 end,
    abs(a-greatest(1,l-1))+abs(b-l)+abs(c-least(6,l+1)),
    (a=l)::integer+(b=l)::integer+(c=l)::integer desc,a+b+c,a,b,c limit 1;
  return result;
end;$$;

create or replace function private.assign_challenge_set(challenge_id uuid,
  replacing_slot text default null, previous_level text default null)
returns void language plpgsql security definer set search_path='' as $$
declare challenge public.daily_challenges; levels text[]:=array['A1','A2','B1','B2','C1','C2'];
  slots text[]:=array['review','target','stretch']; available integer[]; plan text[];
  selected record; requested text; learner_rank integer; other_above integer;
  categories text[]:=array[]::text[];
begin
  if (replacing_slot is null)<>(previous_level is null)
    or (replacing_slot is not null and (not replacing_slot=any(slots) or not previous_level=any(levels))) then
    raise exception using errcode='23514',message='invalid_cefr_slot';
  end if;
  select * into strict challenge from public.daily_challenges where id=challenge_id;
  perform 1 from public.profiles where id=challenge.user_id for update;
  insert into private.progress_accounts(user_id) values(challenge.user_id) on conflict do nothing;
  update private.progress_accounts set revision=revision+1 where user_id=challenge.user_id;
  select * into strict challenge from public.daily_challenges where id=challenge_id for update;
  if challenge.selection_policy_version<>2 then
    raise exception using errcode='23514',message='invalid_selection_policy';
  end if;
  learner_rank:=array_position(levels,challenge.cefr_level);
  select count(*) into other_above from public.daily_challenge_words w
    where w.daily_challenge_id=challenge_id and w.replaced_at is null
      and array_position(levels,w.cefr_level)>learner_rank;
  if replacing_slot is null then
    select array_agg(coalesce(p.n,0) order by l.rank) into available
    from unnest(levels) with ordinality l(level,rank)
    left join (
      select t.cefr_level,count(*)::integer n from public.vocabulary_terms t
      join public.vocabulary_concepts c on c.id=t.concept_id
      join public.vocabulary_terms r on r.concept_id=c.id and r.language_id=challenge.reference_language_id
      where t.language_id=challenge.target_language_id and t.is_active and r.is_active
        and c.is_active and c.is_photographable
        and private.selection_level_allowed(challenge.cefr_level,t.cefr_level)
        and not exists(select 1 from private.completed_concepts d where d.user_id=challenge.user_id and d.concept_id=c.id)
        and not exists(select 1 from public.daily_challenge_words w where w.daily_challenge_id=challenge_id and w.concept_id=c.id)
      group by t.cefr_level
    ) p on p.cefr_level=l.level;
    plan:=private.challenge_level_plan(challenge.cefr_level,available);
    if plan is null then raise exception using errcode='P0001',message='insufficient_vocabulary'; end if;
  else
    slots:=array[replacing_slot];
  end if;
  for i in 1..array_length(slots,1) loop
    requested:=case when replacing_slot is null then plan[i] else null end;
    select t.id,t.cefr_level,c.category into selected
    from public.vocabulary_terms t
    join public.vocabulary_concepts c on c.id=t.concept_id
    join public.vocabulary_terms r on r.concept_id=c.id and r.language_id=challenge.reference_language_id
    where t.language_id=challenge.target_language_id and t.is_active and r.is_active
      and c.is_active and c.is_photographable
      and private.selection_level_allowed(challenge.cefr_level,t.cefr_level)
      and (requested is null or t.cefr_level=requested)
      and (replacing_slot is null or other_above+(array_position(levels,t.cefr_level)>learner_rank)::integer<=1)
      and not exists(select 1 from private.completed_concepts d where d.user_id=challenge.user_id and d.concept_id=c.id)
      and not exists(select 1 from public.daily_challenge_words w where w.daily_challenge_id=challenge_id and w.concept_id=c.id)
    order by
      case when replacing_slot is not null and learner_rank=6 then (t.cefr_level='B2')::integer else 0 end,
      case when replacing_slot is not null then (t.cefr_level<>previous_level)::integer else 0 end,
      case when replacing_slot is not null then abs(array_position(levels,t.cefr_level)-array_position(levels,previous_level)) else 0 end,
      case when replacing_slot is not null then array_position(levels,t.cefr_level) else 0 end,
      (select max(w.assigned_at) from public.daily_challenge_words w join public.daily_challenges h on h.id=w.daily_challenge_id
        where h.user_id=challenge.user_id and w.concept_id=c.id) asc nulls first,
      (c.category=any(categories)),
      md5(challenge.user_id::text||to_char(challenge.local_challenge_date,'YYYY-MM-DD')||':2:'||c.id::text),c.id
    limit 1 for share of t,c,r;
    if selected.id is null then raise exception using errcode='P0001',message='insufficient_vocabulary'; end if;
    insert into public.daily_challenge_words(daily_challenge_id,slot,cefr_level,vocabulary_term_id)
      values(challenge_id,slots[i],selected.cefr_level,selected.id);
    categories:=array_append(categories,selected.category);
  end loop;
end;$$;

-- The final set is checked at commit, including trusted direct writes. Retiring
-- one row during replacement may temporarily leave two, never at commit.
create or replace function private.require_selection_policy() returns trigger
language plpgsql security definer set search_path='' as $$
declare cid uuid; challenge public.daily_challenges; levels text[]:=array['A1','A2','B1','B2','C1','C2'];
begin
  if tg_table_name='daily_challenges' then cid:=new.id;
  elsif tg_op='DELETE' then cid:=old.daily_challenge_id;
  else cid:=new.daily_challenge_id; end if;
  select * into challenge from public.daily_challenges where id=cid for update;
  if found and challenge.selection_policy_version=2 and (
    exists(select 1 from public.daily_challenge_words w where w.daily_challenge_id=cid and w.replaced_at is null
      and not private.selection_level_allowed(challenge.cefr_level,w.cefr_level))
    or (select count(*) from public.daily_challenge_words w where w.daily_challenge_id=cid and w.replaced_at is null
      and array_position(levels,w.cefr_level)>array_position(levels,challenge.cefr_level))>1
  ) then raise exception using errcode='23514',message='invalid_selection_mix'; end if;
  return null;
end;$$;
drop trigger if exists require_selection_policy on public.daily_challenge_words;
create constraint trigger require_selection_policy after insert or update or delete on public.daily_challenge_words
  deferrable initially deferred for each row execute function private.require_selection_policy();

create or replace function private.prepare_challenge_word() returns trigger
language plpgsql security definer set search_path = '' as $$
declare challenge public.daily_challenges; target public.vocabulary_terms; reference public.vocabulary_terms; concept public.vocabulary_concepts;
begin
  if tg_op = 'UPDATE' then
    if old.replaced_at is not null or new.replaced_at is null or
       (to_jsonb(new) - 'replaced_at') is distinct from (to_jsonb(old) - 'replaced_at') then
      raise exception using errcode='23514', message='assignment_history_immutable';
    end if;
    new.replaced_at := clock_timestamp();
    return new;
  end if;
  select * into strict challenge from public.daily_challenges where id=new.daily_challenge_id for update;
  select * into target from public.vocabulary_terms where id=new.vocabulary_term_id for share;
  select * into concept from public.vocabulary_concepts where id=target.concept_id for share;
  select * into reference from public.vocabulary_terms where concept_id=target.concept_id and language_id=challenge.reference_language_id for share;
  if target.id is null or reference.id is null or not target.is_active or not reference.is_active
    or not concept.is_active or not concept.is_photographable
    or target.language_id <> challenge.target_language_id
    or (challenge.selection_policy_version=1 and target.cefr_level <> private.slot_level(challenge.cefr_level,new.slot))
    or (challenge.selection_policy_version=2 and (not private.selection_level_allowed(challenge.cefr_level,target.cefr_level)
      or exists(select 1 from private.completed_concepts d where d.user_id=challenge.user_id and d.concept_id=target.concept_id)))
    or new.cefr_level <> target.cefr_level then
    raise exception using errcode='23514', message='ineligible_challenge_term';
  end if;
  new.concept_id := concept.id;
  new.reference_term_id := reference.id;
  new.target_language_id := challenge.target_language_id;
  new.reference_language_id := challenge.reference_language_id;
  new.target_term := target.term;
  new.reference_term := reference.term;
  new.assigned_at := clock_timestamp();
  new.replaced_at := null;
  return new;
end;
$$;


create or replace function public.get_or_create_today_challenge() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); learning public.user_language_profiles; challenge_id uuid; day date; instant timestamptz;
begin
  if caller is null then raise exception using errcode='42501',message='authentication_required'; end if;
  -- Same lock order as onboarding, then learning row, then challenge row.
  perform 1 from public.profiles where id=caller and onboarding_completed_at is not null for update;
  if not found then raise exception using errcode='P0001',message='onboarding_required'; end if;
  select * into learning from public.user_language_profiles where user_id=caller for update;
  if not found then raise exception using errcode='P0001',message='onboarding_required'; end if;
  instant := clock_timestamp();
  day := private.challenge_date(learning.timezone,instant);
  select id into challenge_id from public.daily_challenges where user_language_profile_id=learning.id and local_challenge_date=day;
  if challenge_id is not null and not exists(select 1 from public.daily_challenges where id=challenge_id and user_id=caller) then
    raise exception using errcode='42501',message='challenge_owner_mismatch';
  end if;
  if challenge_id is null then
    insert into public.daily_challenges(user_id,user_language_profile_id,created_at,selection_policy_version) values(caller,learning.id,instant,2) returning id into challenge_id;
    perform private.assign_challenge_set(challenge_id);
  end if;
  return private.challenge_payload(challenge_id);
end;
$$;

create or replace function public.replace_daily_challenge_word(active_assignment_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); assignment public.daily_challenge_words; challenge_id uuid;
begin
  if caller is null then raise exception using errcode='42501',message='authentication_required'; end if;
  -- Serialize all of this user's generation/replacement history and settings writes.
  perform 1 from public.profiles where id=caller and onboarding_completed_at is not null for update;
  if not found then raise exception using errcode='P0001',message='onboarding_required'; end if;
  select c.id into challenge_id from public.daily_challenges c join public.daily_challenge_words w on w.daily_challenge_id=c.id
    where w.id=active_assignment_id and c.user_id=caller;
  if challenge_id is null then raise exception using errcode='P0001',message='assignment_unavailable'; end if;
  perform 1 from public.daily_challenges where id=challenge_id for update;
  select * into assignment from public.daily_challenge_words where id=active_assignment_id for update;
  if assignment.replaced_at is not null then raise exception using errcode='P0001',message='assignment_unavailable'; end if;
  update public.daily_challenge_words set replaced_at=clock_timestamp() where id=assignment.id;
  if (select selection_policy_version from public.daily_challenges where id=challenge_id)=1 then
    perform private.assign_challenge_word(challenge_id,assignment.slot);
  else
    perform private.assign_challenge_set(challenge_id,assignment.slot,assignment.cefr_level);
  end if;
  return private.challenge_payload(challenge_id);
end;
$$;

revoke all on function private.selection_level_allowed(text,text),private.challenge_level_plan(text,integer[]),
  private.assign_challenge_set(uuid,text,text),private.require_selection_policy()
  from public,anon,authenticated,service_role;
-- Replaced public RPCs and existing trigger helpers retain their existing ACLs.
commit;
