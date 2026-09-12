begin;
-- Additive audit hardening. The installed CLI requires explicit transaction boundaries.
-- Freeze writes during preflight/backfill/constraint installation; never repair
-- ambiguous semantic history by guessing what a term used to mean.
lock table public.daily_challenges, public.vocabulary_terms, public.daily_challenge_words in share row exclusive mode;
do $$
begin
  if exists (
    select 1 from public.daily_challenge_words w
    join public.daily_challenges c on c.id=w.daily_challenge_id
    join public.vocabulary_terms t on t.id=w.vocabulary_term_id
    join public.vocabulary_terms r on r.id=w.reference_term_id
    where t.concept_id<>w.concept_id or r.concept_id<>w.concept_id
      or t.language_id<>c.target_language_id or r.language_id<>c.reference_language_id
  ) then
    raise exception 'Historical vocabulary links must be repaired before this migration';
  end if;
end;
$$;

-- These language snapshots allow real foreign keys to protect meaning/language
-- linkage even under repeatable-read transactions and concurrent catalog edits.
alter table public.daily_challenge_words add column target_language_id uuid;
alter table public.daily_challenge_words add column reference_language_id uuid;
alter table public.daily_challenge_words disable trigger prepare_challenge_word;
update public.daily_challenge_words w set target_language_id=c.target_language_id,
  reference_language_id=c.reference_language_id
from public.daily_challenges c where c.id=w.daily_challenge_id;
set constraints all immediate;
alter table public.daily_challenge_words enable trigger prepare_challenge_word;
alter table public.daily_challenge_words alter column target_language_id set not null;
alter table public.daily_challenge_words alter column reference_language_id set not null;
alter table public.vocabulary_terms add constraint vocabulary_terms_identity_key unique(id,concept_id,language_id);
alter table public.daily_challenges add constraint daily_challenges_languages_key unique(id,target_language_id,reference_language_id);
alter table public.daily_challenge_words add constraint assignment_target_identity_fk
  foreign key(vocabulary_term_id,concept_id,target_language_id) references public.vocabulary_terms(id,concept_id,language_id);
alter table public.daily_challenge_words add constraint assignment_reference_identity_fk
  foreign key(reference_term_id,concept_id,reference_language_id) references public.vocabulary_terms(id,concept_id,language_id);
alter table public.daily_challenge_words add constraint assignment_challenge_languages_fk
  foreign key(daily_challenge_id,target_language_id,reference_language_id)
  references public.daily_challenges(id,target_language_id,reference_language_id) on delete cascade;
create index daily_challenge_words_target_identity on public.daily_challenge_words(vocabulary_term_id,concept_id,target_language_id);
create index daily_challenge_words_reference_identity on public.daily_challenge_words(reference_term_id,concept_id,reference_language_id);
set constraints all deferred;

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
    or target.cefr_level <> private.slot_level(challenge.cefr_level,new.slot)
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

create function private.preserve_assignment_history() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.daily_challenges where id=old.daily_challenge_id for update;
  if found then
    raise exception using errcode='23514',message='assignment_history_immutable';
  end if;
  -- Parent challenge/account deletion still cascades. This is not a retention policy.
  return old;
end;
$$;
create trigger preserve_assignment_history before delete on public.daily_challenge_words
  for each row execute function private.preserve_assignment_history();

create or replace function private.slot_level(level text, slot text) returns text
language plpgsql immutable set search_path = '' as $$
declare levels text[] := array['A1','A2','B1','B2','C1','C2']; position integer;
begin
  position := array_position(levels,level);
  if position is null or slot is null or slot not in ('review','target','stretch') then
    raise exception using errcode='23514',message='invalid_cefr_slot';
  end if;
  return levels[greatest(1,least(6,position + case slot when 'review' then -1 when 'target' then 0 else 1 end))];
end;
$$;
revoke all on function private.preserve_assignment_history(), private.prepare_challenge_word(), private.slot_level(text,text) from public,anon,authenticated;

commit;
