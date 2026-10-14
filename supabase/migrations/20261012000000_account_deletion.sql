begin;

-- Transaction-local erasure authority. Only the Auth deletion trigger can populate
-- this table; clients (including service_role) cannot mint an audit-erasure scope.
create table if not exists private.account_erasure_scope (user_id uuid primary key);
alter table private.account_erasure_scope enable row level security;
revoke all on private.account_erasure_scope from public, anon, authenticated, service_role;

create or replace function private.reject_audit_mutation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' and exists (
    select 1 from private.account_erasure_scope e
    where not exists(select 1 from auth.users u where u.id=e.user_id)
      and (old.moderator_user_id=e.user_id or exists (
        select 1 from public.safety_reports r where r.id=old.report_id
          and (r.reporter_user_id=e.user_id or r.subject_user_id=e.user_id)
      ))
  ) then return old; end if;
  raise exception using errcode='42501',message='immutable_moderation_audit';
end;
$$;
revoke all on function private.reject_audit_mutation() from public,anon,authenticated,service_role;

create or replace function private.erase_account_residue() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  -- These Auth records do not all have a user FK (legacy tokens/PKCE state).
  delete from auth.refresh_tokens where user_id=old.id::text;
  delete from auth.flow_state where user_id=old.id or linking_target_id=old.id;
  insert into private.account_erasure_scope values(old.id);
  delete from public.moderation_audit a where a.moderator_user_id=old.id
    or exists(select 1 from public.safety_reports r where r.id=a.report_id
      and (r.reporter_user_id=old.id or r.subject_user_id=old.id));
  delete from public.safety_reports where reporter_user_id=old.id or subject_user_id=old.id;
  delete from private.account_erasure_scope where user_id=old.id;
  return old;
end;
$$;
revoke all on function private.erase_account_residue() from public,anon,authenticated,service_role;
drop trigger if exists erase_account_residue on auth.users;
create trigger erase_account_residue after delete on auth.users
for each row execute function private.erase_account_residue();

-- No caller-selected identity, paths, buckets or service credential. Auth sessions
-- and all FK-owned product data disappear in the SAME transaction as the user.
-- Storage metadata/bytes are never deleted with SQL. Existing durable queues and
-- Storage guards authorize subsequent physical removal through the Storage API.
create or replace function public.delete_my_account() returns boolean
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); session_uuid uuid;
begin
  if actor is null then raise exception using errcode='42501',message='authentication_required';end if;
  perform 1 from auth.users where id=actor for update;
  if not found then return true; end if; -- authenticated retry after a lost ACK
  begin session_uuid:=(auth.jwt()->>'session_id')::uuid;
  exception when invalid_text_representation then session_uuid:=null;end;
  if not exists(select 1 from auth.sessions where id=session_uuid and user_id=actor
    and (not_after is null or not_after>clock_timestamp())) then
    raise exception using errcode='42501',message='authentication_required';
  end if;
  -- Also preserve cleanup work for already-orphaned objects owned by this user.
  insert into private.photo_cleanup_queue(storage_path)
    select name from storage.objects where bucket_id='challenge-submissions' and owner_id=actor::text
    on conflict do nothing;
  insert into private.avatar_cleanup_queue(storage_path)
    select name from storage.objects where bucket_id='profile-avatars' and owner_id=actor::text
    on conflict do nothing;
  delete from auth.users where id=actor;
  return true;
end;
$$;
revoke all on function public.delete_my_account() from public,anon,authenticated,service_role;
grant execute on function public.delete_my_account() to authenticated;
commit;
