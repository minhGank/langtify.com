begin;
lock table public.submissions in share row exclusive mode;
-- Never silently bless pre-audit images from their client-declared MIME type.
do $$ begin
  if exists(select 1 from public.submissions where status='completed') then
    raise exception 'Existing completed photos require a verified backfill before this migration; no data was changed';
  end if;
end $$;

create table private.photo_verifications (
  submission_id uuid primary key references public.submissions(id) on delete cascade,
  object_id uuid not null,
  object_version text not null,
  sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
  width integer not null check(width between 1 and 1600),
  height integer not null check(height between 1 and 1600),
  verified_at timestamptz not null default clock_timestamp()
);
revoke all on private.photo_verifications from public,anon,authenticated;

-- Storage checks RLS before receiving bytes, then commits with an elevated role.
-- Recheck at commit, including signed-upload replay and concurrent upload races.
create function private.guard_submission_object() returns trigger
language plpgsql security definer set search_path='' as $$
declare s public.submissions;
begin
  if tg_op='UPDATE' then
    if old.bucket_id='challenge-submissions' and
      (to_jsonb(new)-array['updated_at','last_accessed_at']) is distinct from
      (to_jsonb(old)-array['updated_at','last_accessed_at']) then
      raise exception using errcode='23514',message='photo_object_immutable';
    end if;
    if new.bucket_id='challenge-submissions' and old.bucket_id is distinct from new.bucket_id then
      raise exception using errcode='23514',message='photo_object_immutable';
    end if;
    return new;
  elsif tg_op='DELETE' then
    if old.bucket_id='challenge-submissions' and exists(
      select 1 from public.submissions where storage_path=old.name and status in ('pending','completed')
    ) then raise exception using errcode='23514',message='photo_deletion_not_requested'; end if;
    return old;
  end if;
  if new.bucket_id<>'challenge-submissions' then return new; end if;
  select * into s from public.submissions where storage_path=new.name for share;
  if not found or s.status<>'pending' or s.expires_at<=clock_timestamp() then
    raise exception using errcode='23514',message='photo_reservation_unavailable';
  end if;
  if new.owner_id is distinct from s.user_id::text or
    (new.user_metadata is not null and new.user_metadata<>'{}'::jsonb) then
    raise exception using errcode='23514',message='invalid_photo_metadata';
  end if;
  return new;
end;
$$;
create trigger langtify_guard_submission_object before insert or update or delete on storage.objects
for each row execute function private.guard_submission_object();

create function private.require_verified_photo() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status='completed' and old.status<>'completed' and not exists(
    select 1 from private.photo_verifications v join storage.objects o
      on o.id=v.object_id and o.version=v.object_version
    where v.submission_id=new.id and o.bucket_id='challenge-submissions' and o.name=new.storage_path
  ) then raise exception using errcode='23514',message='photo_not_verified'; end if;
  return new;
end;
$$;
create trigger require_verified_photo before update on public.submissions
for each row execute function private.require_verified_photo();

create function public.photo_verification_target(submission_id uuid, expected_user_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',o.id,'version',o.version) from public.submissions s
  join storage.objects o on o.bucket_id='challenge-submissions' and o.name=s.storage_path
  where s.id=submission_id and s.user_id=expected_user_id and s.status='pending' and s.expires_at>clock_timestamp();
$$;
create function public.attest_submission_photo(submission_id uuid,expected_user_id uuid,
  expected_object_id uuid,expected_object_version text,image_sha256 text,image_width integer,image_height integer)
returns void language plpgsql security definer set search_path='' as $$
declare s public.submissions;
begin
  -- Same lock order as the owner RPCs; identity comes from verified server Auth.
  perform 1 from public.profiles where id=expected_user_id and onboarding_completed_at is not null for update;
  if not found then raise exception using errcode='42501',message='submission_unavailable'; end if;
  select * into s from public.submissions where id=submission_id and user_id=expected_user_id;
  if not found then raise exception using errcode='42501',message='submission_unavailable'; end if;
  perform 1 from public.daily_challenge_words where id=s.daily_challenge_word_id and replaced_at is null for update;
  if not found then raise exception using errcode='23514',message='assignment_unavailable'; end if;
  select * into strict s from public.submissions where id=submission_id for update;
  if s.status='completed' then return; end if;
  if s.status<>'pending' or s.expires_at<=clock_timestamp() then
    raise exception using errcode='23514',message='upload_expired'; end if;
  perform 1 from storage.objects where id=expected_object_id and version=expected_object_version
    and bucket_id='challenge-submissions' and name=s.storage_path
    and metadata->>'mimetype'='image/jpeg' and (metadata->>'size')::bigint between 1 and 5242880 for share;
  if not found then raise exception using errcode='23514',message='photo_not_uploaded'; end if;
  insert into private.photo_verifications(submission_id,object_id,object_version,sha256,width,height)
  values(s.id,expected_object_id,expected_object_version,image_sha256,image_width,image_height)
  on conflict on constraint photo_verifications_pkey do nothing;
end;
$$;
-- Only the trusted verifier may attest bytes. Owner finalization still runs as the
-- user's JWT and cannot succeed without an attestation for the immutable object.
revoke all on function public.photo_verification_target(uuid,uuid),
  public.attest_submission_photo(uuid,uuid,uuid,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.photo_verification_target(uuid,uuid),
  public.attest_submission_photo(uuid,uuid,uuid,text,text,integer,integer) to service_role;
revoke all on function private.guard_submission_object(),private.require_verified_photo() from public,anon,authenticated;

-- Signing is mediated by the function so callers cannot request a longer TTL.
-- Reads/deletion retain owner checks; unknown Storage operations fail closed.
alter policy submission_photo_read on storage.objects using(
  bucket_id='challenge-submissions' and current_setting('storage.operation',true)=any(array[
    'storage.object.get_authenticated','storage.object.info_authenticated',
    'storage.object.delete','storage.object.delete_many','storage.object.list','storage.object.list_v2'
  ]) and exists(select 1 from public.submissions s where s.storage_path=name
    and s.user_id=(select auth.uid()) and s.status in ('pending','completed','deleting')));
-- This flow uses standard uploads, never reusable upload capabilities or copy.
alter policy submission_photo_upload on storage.objects with check(
  bucket_id='challenge-submissions' and current_setting('storage.operation',true)='storage.object.upload'
  and public.can_upload_submission_object(name) and (user_metadata is null or user_metadata='{}'::jsonb));
-- Failed jobs remain durable without monopolizing every future batch.
alter table private.photo_cleanup_queue add column last_attempt_at timestamptz;
create index photo_cleanup_queue_attempt on private.photo_cleanup_queue(last_attempt_at nulls first,created_at);
create or replace function public.claim_photo_cleanup(batch_size integer default 100) returns table(storage_path text)
language plpgsql security definer set search_path='' as $$
declare pending_row public.submissions;
begin
  if batch_size is null or batch_size<1 or batch_size>1000 then raise exception 'invalid_batch_size'; end if;
  for pending_row in select candidate.* from public.submissions candidate
    where (candidate.status='deleting' or (candidate.status='pending' and candidate.expires_at<=clock_timestamp()))
      and not exists(select 1 from private.photo_cleanup_queue queued where queued.storage_path=candidate.storage_path)
    order by candidate.updated_at limit batch_size for update of candidate skip locked loop
    if pending_row.status='pending' then update public.submissions set status='deleting' where id=pending_row.id; end if;
    insert into private.photo_cleanup_queue(storage_path) values(pending_row.storage_path) on conflict do nothing;
  end loop;
  insert into private.photo_cleanup_queue(storage_path)
    select o.name from storage.objects o left join public.submissions stored on stored.storage_path=o.name
    where o.bucket_id='challenge-submissions' and (stored.id is null or stored.status='deleted')
      and not exists(select 1 from private.photo_cleanup_queue queued where queued.storage_path=o.name)
    limit batch_size on conflict do nothing;
  return query with candidates as (
    select queued.storage_path from private.photo_cleanup_queue queued
    order by queued.last_attempt_at nulls first,queued.created_at
    limit batch_size for update skip locked
  ) update private.photo_cleanup_queue queued set last_attempt_at=clock_timestamp()
    from candidates where queued.storage_path=candidates.storage_path returning queued.storage_path;
end;
$$;
commit;
