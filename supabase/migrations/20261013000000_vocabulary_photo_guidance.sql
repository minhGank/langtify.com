begin;

-- Localized editorial help belongs to a semantic concept, never a user or term.
-- Existing catalog rows and assignment snapshots need no backfill.
create table if not exists public.vocabulary_photo_guidance (
  concept_id uuid not null references public.vocabulary_concepts(id) on delete cascade,
  locale text not null check (locale in ('en','fr')),
  primary_idea text not null check ((length(primary_idea) between 1 and 2000 and length(btrim(primary_idea)) > 0)),
  representation_mode text not null check (representation_mode in ('literal','interpretive')),
  alternative_idea text check (alternative_idea is null or (length(alternative_idea) between 1 and 2000 and length(btrim(alternative_idea)) > 0)),
  alternative_mode text check (alternative_mode in ('literal','interpretive')),
  accessibility_guidance text not null check ((length(accessibility_guidance) between 1 and 2000 and length(btrim(accessibility_guidance)) > 0)),
  safety_guidance text not null check ((length(safety_guidance) between 1 and 2000 and length(btrim(safety_guidance)) > 0)),
  primary key (concept_id,locale),
  constraint guidance_alternative_pair check ((alternative_idea is null) = (alternative_mode is null))
);
alter table public.vocabulary_photo_guidance enable row level security;
revoke all on public.vocabulary_photo_guidance from public, anon, authenticated, service_role;
grant select on public.vocabulary_photo_guidance to authenticated;
grant select, insert, update, delete on public.vocabulary_photo_guidance to service_role;
drop policy if exists guidance_catalog_read on public.vocabulary_photo_guidance;
create policy guidance_catalog_read on public.vocabulary_photo_guidance for select to authenticated
  using (auth.uid() is not null and exists (
    select 1 from public.vocabulary_concepts c where c.id=concept_id
      and c.is_active and c.is_photographable
  ));

-- Return a whole locale row: never mix a translated example with untranslated safety.
-- English UI uses English instructions today. A localized UI can request French;
-- absent French falls back to English; absent English returns null, not French.
create or replace function private.concept_photo_guidance(requested_concept uuid, requested_locale text)
returns jsonb language sql stable security invoker set search_path='' as $$
  select to_jsonb(g) from public.vocabulary_photo_guidance g
  join public.vocabulary_concepts c on c.id=g.concept_id
  where g.concept_id=requested_concept and c.is_active and c.is_photographable
    and g.locale in (requested_locale,'en')
  order by (g.locale=requested_locale) desc limit 1;
$$;
revoke all on function private.concept_photo_guidance(uuid,text) from public,anon,authenticated,service_role;

-- Same owner filter, active assignments, immutable word snapshots, ordering and
-- submission/capture projection as the existing payload. Selection is untouched.
create or replace function private.challenge_payload(challenge_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('challenge',to_jsonb(c),'words',(
    select jsonb_agg(to_jsonb(w)||jsonb_build_object('submission',
      (select jsonb_build_object('id',s.id,'status',s.status,'submitted_at',s.submitted_at,'capture_kind',s.capture_kind)
       from public.submissions s where s.daily_challenge_word_id=w.id and s.status<>'deleted'),
      'photo_guidance',private.concept_photo_guidance(w.concept_id,'en'))
      order by case w.slot when 'review' then 1 when 'target' then 2 else 3 end)
    from public.daily_challenge_words w where w.daily_challenge_id=c.id and w.replaced_at is null))
  from public.daily_challenges c where c.id=challenge_id and c.user_id=auth.uid();
$$;
-- Preserve the existing helper's ACL; it is not a new client/service RPC.
revoke all on function private.challenge_payload(uuid) from public,anon,authenticated;
commit;
