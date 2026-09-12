-- Phase 2 only. Functions with elevated privileges have a fixed empty search_path.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  onboarding_completed_at timestamptz,
  constraint profiles_username_format check (
    username is null or (username = lower(btrim(username)) and username ~ '^[a-z0-9][a-z0-9_]{2,29}$')
  ),
  constraint profiles_completed_username check (onboarding_completed_at is null or username is not null)
);
create unique index profiles_username_unique on public.profiles (lower(username));

create table public.languages (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  name text not null check (length(btrim(name)) > 0),
  native_name text not null check (length(btrim(native_name)) > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.user_language_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  reference_language_id uuid not null references public.languages(id),
  target_language_id uuid not null references public.languages(id),
  cefr_level text not null check (cefr_level in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  timezone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint learning_languages_differ check (reference_language_id <> target_language_id)
);

create function private.prepare_profile() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.username := lower(btrim(new.username));
  new.updated_at := now();
  return new;
end;
$$;
create trigger prepare_profile before insert or update on public.profiles
for each row execute function private.prepare_profile();

create function private.prepare_learning_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from pg_catalog.pg_timezone_names where name = new.timezone
      and (name = 'UTC' or (position('/' in name) > 0 and name not like 'posix/%' and name not like 'right/%'))
  ) then
    raise exception using errcode = '23514', message = 'invalid_timezone';
  end if;
  if not exists (select 1 from public.languages where id = new.reference_language_id and is_active)
    or not exists (select 1 from public.languages where id = new.target_language_id and is_active) then
    raise exception using errcode = '23514', message = 'inactive_language';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger prepare_learning_profile before insert or update on public.user_language_profiles
for each row execute function private.prepare_learning_profile();

create function private.require_completed_learning_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.onboarding_completed_at is not null and not exists (
    select 1 from public.user_language_profiles where user_id = new.id
  ) then
    raise exception using errcode = '23514', message = 'learning_profile_required';
  end if;
  return new;
end;
$$;
create trigger require_completed_learning_profile before insert or update on public.profiles
for each row execute function private.require_completed_learning_profile();

create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id) values (new.id);
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
for each row execute function private.handle_new_user();

alter table public.profiles enable row level security;
alter table public.languages enable row level security;
alter table public.user_language_profiles enable row level security;
revoke all on public.profiles, public.languages, public.user_language_profiles from public, anon, authenticated;
grant select on public.profiles, public.languages, public.user_language_profiles to authenticated;
grant update(username) on public.profiles to authenticated;
grant insert(user_id, reference_language_id, target_language_id, cefr_level, timezone)
  on public.user_language_profiles to authenticated;
grant update(reference_language_id, target_language_id, cefr_level, timezone)
  on public.user_language_profiles to authenticated;

create policy profiles_read_own on public.profiles for select to authenticated
using ((select auth.uid()) = id);
create policy profiles_update_own on public.profiles for update to authenticated
using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy languages_read_authenticated on public.languages for select to authenticated using (true);
create policy learning_read_own on public.user_language_profiles for select to authenticated
using ((select auth.uid()) = user_id);
create policy learning_insert_own on public.user_language_profiles for insert to authenticated
with check ((select auth.uid()) = user_id);
create policy learning_update_own on public.user_language_profiles for update to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create function public.complete_onboarding(
  p_username text,
  p_reference_language_id uuid,
  p_target_language_id uuid,
  p_cefr_level text,
  p_timezone text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if p_username is null or lower(btrim(p_username)) !~ '^[a-z0-9][a-z0-9_]{2,29}$' then
    raise exception using errcode = '23514', message = 'invalid_username';
  end if;
  -- Recover pre-migration users and serialize retries for the same account.
  insert into public.profiles(id) values (caller) on conflict (id) do nothing;
  perform 1 from public.profiles where id = caller for update;
  insert into public.user_language_profiles (
    user_id, reference_language_id, target_language_id, cefr_level, timezone
  ) values (caller, p_reference_language_id, p_target_language_id, p_cefr_level, p_timezone)
  on conflict (user_id) do update set
    reference_language_id = excluded.reference_language_id,
    target_language_id = excluded.target_language_id,
    cefr_level = excluded.cefr_level,
    timezone = excluded.timezone;
  update public.profiles set username = p_username,
    onboarding_completed_at = coalesce(onboarding_completed_at, now()) where id = caller;
end;
$$;
revoke all on function public.complete_onboarding(text, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.complete_onboarding(text, uuid, uuid, text, text) to authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
