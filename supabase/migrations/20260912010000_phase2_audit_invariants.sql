begin;
-- Apply as one transaction (the Supabase migration runner does this). Prevent a
-- concurrent write from invalidating the check before the trigger is installed.
lock table public.profiles, public.user_language_profiles in share row exclusive mode;

-- Preserve existing data; fail visibly if a preexisting row needs repair.
do $$
begin
  if exists (
    select 1 from public.profiles p where p.onboarding_completed_at is not null
      and not exists (select 1 from public.user_language_profiles l where l.user_id = p.id)
  ) then
    raise exception 'Completed profiles without learning records must be repaired before this migration';
  end if;
end;
$$;

-- The original profile trigger guards completion writes. This guards the other
-- side of the relationship, including privileged maintenance deletes/transfers.
create or replace function private.preserve_completed_learning_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  completion timestamptz;
begin
  -- Serialize with concurrent profile completion. Read final transaction state,
  -- allowing an atomic delete/reinsert or an auth-user cascade deletion.
  select onboarding_completed_at into completion from public.profiles
    where id = old.user_id for update;
  if completion is not null and not exists (
    select 1 from public.user_language_profiles where user_id = old.user_id
  ) then
    raise exception using errcode = '23514', message = 'learning_profile_required';
  end if;
  return null;
end;
$$;
revoke all on function private.preserve_completed_learning_profile() from public, anon, authenticated;
drop trigger if exists preserve_completed_learning_profile on public.user_language_profiles;
create constraint trigger preserve_completed_learning_profile
  after delete or update on public.user_language_profiles
  deferrable initially deferred for each row
  execute function private.preserve_completed_learning_profile();

commit;
