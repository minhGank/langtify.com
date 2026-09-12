-- Phase 3: one semantic catalog, immutable challenge snapshots and atomic RPCs.
create table public.vocabulary_concepts (
  id uuid primary key default gen_random_uuid(),
  concept_key text not null unique check (concept_key ~ '^[A-Z][A-Z0-9_]*$'),
  category text not null check (length(btrim(category)) > 0),
  is_photographable boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.vocabulary_terms (
  id uuid primary key default gen_random_uuid(),
  concept_id uuid not null references public.vocabulary_concepts(id),
  language_id uuid not null references public.languages(id),
  term text not null check (length(btrim(term)) > 0),
  cefr_level text not null check (cefr_level in ('A1','A2','B1','B2','C1','C2')),
  part_of_speech text not null check (length(btrim(part_of_speech)) > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (concept_id, language_id)
);
create index vocabulary_terms_selection on public.vocabulary_terms(language_id, cefr_level) where is_active;

create table public.daily_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  user_language_profile_id uuid not null references public.user_language_profiles(id) on delete cascade,
  local_challenge_date date not null,
  target_language_id uuid not null references public.languages(id),
  reference_language_id uuid not null references public.languages(id),
  cefr_level text not null check (cefr_level in ('A1','A2','B1','B2','C1','C2')),
  timezone text not null,
  created_at timestamptz not null default clock_timestamp(),
  check (target_language_id <> reference_language_id),
  unique (user_language_profile_id, local_challenge_date)
);
create index daily_challenges_owner on public.daily_challenges(user_id);
create table public.daily_challenge_words (
  id uuid primary key default gen_random_uuid(),
  daily_challenge_id uuid not null references public.daily_challenges(id) on delete cascade,
  slot text not null check (slot in ('review','target','stretch')),
  cefr_level text not null check (cefr_level in ('A1','A2','B1','B2','C1','C2')),
  vocabulary_term_id uuid not null references public.vocabulary_terms(id),
  concept_id uuid not null references public.vocabulary_concepts(id),
  reference_term_id uuid not null references public.vocabulary_terms(id),
  target_term text not null check (length(btrim(target_term)) > 0),
  reference_term text not null check (length(btrim(reference_term)) > 0),
  assigned_at timestamptz not null default clock_timestamp(),
  replaced_at timestamptz,
  check (replaced_at is null or replaced_at >= assigned_at),
  unique (daily_challenge_id, concept_id)
);
create unique index daily_challenge_active_slot on public.daily_challenge_words(daily_challenge_id, slot) where replaced_at is null;
create index daily_challenge_concept_history on public.daily_challenge_words(concept_id, assigned_at desc);

create function private.touch_vocabulary() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := clock_timestamp(); return new; end;
$$;
create trigger touch_concept before update on public.vocabulary_concepts for each row execute function private.touch_vocabulary();
create trigger touch_term before update on public.vocabulary_terms for each row execute function private.touch_vocabulary();

create function private.slot_level(level text, slot text) returns text
language sql immutable set search_path = '' as $$
  select (array['A1','A2','B1','B2','C1','C2'])[greatest(1,least(6,
    array_position(array['A1','A2','B1','B2','C1','C2'],level) +
    case slot when 'review' then -1 when 'target' then 0 when 'stretch' then 1 end))];
$$;
create function private.challenge_date(zone text, instant timestamptz) returns date
language sql stable strict set search_path = '' as $$ select (instant at time zone zone)::date; $$;

create function private.prepare_challenge() returns trigger
language plpgsql security definer set search_path = '' as $$
declare learning public.user_language_profiles;
begin
  if tg_op = 'UPDATE' then
    raise exception using errcode='23514', message='challenge_snapshot_immutable';
  end if;
  select * into learning from public.user_language_profiles where id=new.user_language_profile_id for update;
  if not found or learning.user_id <> new.user_id then
    raise exception using errcode='23514', message='challenge_owner_mismatch';
  end if;
  -- The database supplies all configuration; callers cannot forge a snapshot.
  new.target_language_id := learning.target_language_id;
  new.reference_language_id := learning.reference_language_id;
  new.cefr_level := learning.cefr_level;
  new.timezone := learning.timezone;
  new.local_challenge_date := private.challenge_date(new.timezone,new.created_at);
  return new;
end;
$$;
create trigger prepare_challenge before insert or update on public.daily_challenges for each row execute function private.prepare_challenge();

create function private.prepare_challenge_word() returns trigger
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
    or target.cefr_level <> private.slot_level(challenge.cefr_level,new.slot)
    or new.cefr_level <> target.cefr_level then
    raise exception using errcode='23514', message='ineligible_challenge_term';
  end if;
  new.concept_id := concept.id;
  new.reference_term_id := reference.id;
  new.target_term := target.term;
  new.reference_term := reference.term;
  new.assigned_at := clock_timestamp();
  new.replaced_at := null;
  return new;
end;
$$;
create trigger prepare_challenge_word before insert or update on public.daily_challenge_words for each row execute function private.prepare_challenge_word();

-- Uniqueness gives at most one active assignment; deferred checks give exactly three.
create function private.require_challenge_slots() returns trigger
language plpgsql security definer set search_path = '' as $$
declare challenge_id uuid;
begin
  if tg_table_name='daily_challenges' then challenge_id := new.id;
  elsif tg_op='DELETE' then challenge_id := old.daily_challenge_id;
  else challenge_id := new.daily_challenge_id; end if;
  perform 1 from public.daily_challenges where id=challenge_id for update;
  if found and (select count(*) from public.daily_challenge_words where daily_challenge_id=challenge_id and replaced_at is null) <> 3 then
    raise exception using errcode='23514', message='challenge_requires_three_slots';
  end if;
  return null;
end;
$$;
create constraint trigger require_challenge_slots after insert or update on public.daily_challenges
  deferrable initially deferred for each row execute function private.require_challenge_slots();
create constraint trigger require_assignment_slots after insert or update or delete on public.daily_challenge_words
  deferrable initially deferred for each row execute function private.require_challenge_slots();

create function private.assign_challenge_word(challenge_id uuid, requested_slot text) returns void
language plpgsql security definer set search_path = '' as $$
declare challenge public.daily_challenges; selected_id uuid; level text;
begin
  select * into strict challenge from public.daily_challenges where id=challenge_id for update;
  level := private.slot_level(challenge.cefr_level,requested_slot);
  select t.id into selected_id
  from public.vocabulary_terms t
  join public.vocabulary_concepts c on c.id=t.concept_id
  join public.vocabulary_terms r on r.concept_id=c.id and r.language_id=challenge.reference_language_id
  where t.language_id=challenge.target_language_id and t.cefr_level=level
    and t.is_active and r.is_active and c.is_active and c.is_photographable
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

create function private.challenge_payload(challenge_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('challenge',to_jsonb(c),'words',(
    select jsonb_agg(to_jsonb(w) order by case w.slot when 'review' then 1 when 'target' then 2 else 3 end)
    from public.daily_challenge_words w where w.daily_challenge_id=c.id and w.replaced_at is null))
  from public.daily_challenges c where c.id=challenge_id and c.user_id=auth.uid();
$$;

create function public.get_or_create_today_challenge() returns jsonb
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
    insert into public.daily_challenges(user_id,user_language_profile_id,created_at) values(caller,learning.id,instant) returning id into challenge_id;
    perform private.assign_challenge_word(challenge_id,'review');
    perform private.assign_challenge_word(challenge_id,'target');
    perform private.assign_challenge_word(challenge_id,'stretch');
  end if;
  return private.challenge_payload(challenge_id);
end;
$$;

create function public.replace_daily_challenge_word(active_assignment_id uuid) returns jsonb
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
  perform private.assign_challenge_word(challenge_id,assignment.slot);
  return private.challenge_payload(challenge_id);
end;
$$;

alter table public.vocabulary_concepts enable row level security;
alter table public.vocabulary_terms enable row level security;
alter table public.daily_challenges enable row level security;
alter table public.daily_challenge_words enable row level security;
revoke all on public.vocabulary_concepts,public.vocabulary_terms,public.daily_challenges,public.daily_challenge_words from public,anon,authenticated;
grant select on public.vocabulary_concepts,public.vocabulary_terms,public.daily_challenges,public.daily_challenge_words to authenticated;
create policy vocabulary_concepts_read on public.vocabulary_concepts for select to authenticated using(true);
create policy vocabulary_terms_read on public.vocabulary_terms for select to authenticated using(true);
create policy daily_challenges_read_own on public.daily_challenges for select to authenticated using(user_id=(select auth.uid()));
create policy daily_challenge_words_read_own on public.daily_challenge_words for select to authenticated using(
  exists(select 1 from public.daily_challenges c where c.id=daily_challenge_id and c.user_id=(select auth.uid())));
revoke all on all functions in schema private from public,anon,authenticated;
revoke all on function public.get_or_create_today_challenge(), public.replace_daily_challenge_word(uuid) from public,anon,authenticated;
grant execute on function public.get_or_create_today_challenge(), public.replace_daily_challenge_word(uuid) to authenticated;
