begin;

-- Storage is enabled before applying this migration. Never publish this bucket.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('challenge-submissions','challenge-submissions',false,5242880,array['image/jpeg'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

alter table public.daily_challenges add constraint daily_challenges_owner_key unique(id,user_id);
alter table public.daily_challenge_words add constraint daily_challenge_words_submission_key
  unique(id,daily_challenge_id,concept_id,vocabulary_term_id,reference_term_id);
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  daily_challenge_id uuid not null,
  daily_challenge_word_id uuid not null,
  concept_id uuid not null,
  vocabulary_term_id uuid not null,
  reference_term_id uuid not null,
  target_term text not null,
  reference_term text not null,
  storage_path text not null unique,
  visibility text not null default 'private' check(visibility in ('private','public')),
  status text not null default 'pending' check(status in ('pending','completed','deleting','deleted')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp()+interval '24 hours',
  submitted_at timestamptz,
  deleted_at timestamptz,
  foreign key(daily_challenge_id,user_id) references public.daily_challenges(id,user_id) on delete cascade,
  foreign key(daily_challenge_word_id,daily_challenge_id,concept_id,vocabulary_term_id,reference_term_id)
    references public.daily_challenge_words(id,daily_challenge_id,concept_id,vocabulary_term_id,reference_term_id) on delete cascade,
  check(storage_path=user_id::text||'/'||id::text||'.jpg'),
  check((status='completed' and submitted_at is not null) or status<>'completed'),
  check((status='deleted')=(deleted_at is not null)),
  check(status<>'pending' or submitted_at is null)
);
create unique index submissions_one_live_assignment on public.submissions(daily_challenge_word_id) where status<>'deleted';
create index submissions_owner on public.submissions(user_id,created_at desc);
create index submissions_assignment_history on public.submissions(daily_challenge_word_id);
create index submissions_challenge on public.submissions(daily_challenge_id,user_id);
create index submissions_cleanup on public.submissions(status,expires_at) where status in ('pending','deleting');

-- Outlives account/challenge cascades; never exposed through the Data API.
create table private.photo_cleanup_queue (
  storage_path text primary key,
  created_at timestamptz not null default clock_timestamp()
);
create index photo_cleanup_queue_age on private.photo_cleanup_queue(created_at);
revoke all on private.photo_cleanup_queue from public,anon,authenticated;

create function private.submission_object_exists(path text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from storage.objects where bucket_id='challenge-submissions' and name=path);
$$;
create function private.prepare_submission() returns trigger
language plpgsql security definer set search_path='' as $$
declare w public.daily_challenge_words; c public.daily_challenges;
begin
  if tg_op='INSERT' then
    select * into strict w from public.daily_challenge_words where id=new.daily_challenge_word_id for update;
    select * into strict c from public.daily_challenges where id=w.daily_challenge_id;
    if w.replaced_at is not null then raise exception using errcode='23514',message='assignment_unavailable'; end if;
    new.user_id:=c.user_id; new.daily_challenge_id:=c.id;
    new.concept_id:=w.concept_id; new.vocabulary_term_id:=w.vocabulary_term_id; new.reference_term_id:=w.reference_term_id;
    new.target_term:=w.target_term; new.reference_term:=w.reference_term;
    new.storage_path:=c.user_id::text||'/'||new.id::text||'.jpg';
    new.visibility:='private'; new.status:='pending'; new.submitted_at:=null; new.deleted_at:=null;
    new.created_at:=clock_timestamp(); new.expires_at:=new.created_at+interval '24 hours';
  else
    if (to_jsonb(new)-array['visibility','status','updated_at','submitted_at','deleted_at']) is distinct from
       (to_jsonb(old)-array['visibility','status','updated_at','submitted_at','deleted_at']) then
      raise exception using errcode='23514',message='submission_identity_immutable';
    end if;
    new.submitted_at:=old.submitted_at; new.deleted_at:=old.deleted_at;
    if new.status is distinct from old.status then
      if old.status='pending' and new.status='completed' then
        perform 1 from public.daily_challenge_words where id=old.daily_challenge_word_id and replaced_at is null for update;
        if not found or old.expires_at<=clock_timestamp() then raise exception using errcode='23514',message='upload_expired'; end if;
        perform 1 from storage.objects where bucket_id='challenge-submissions' and name=old.storage_path
          and metadata->>'mimetype'='image/jpeg' and (metadata->>'size')::bigint between 1 and 5242880 for share;
        if not found then raise exception using errcode='23514',message='photo_not_uploaded'; end if;
        new.submitted_at:=clock_timestamp();
      elsif old.status in ('pending','completed') and new.status='deleting' then null;
      elsif old.status='deleting' and new.status='deleted' then
        if private.submission_object_exists(old.storage_path) then raise exception using errcode='23514',message='photo_not_deleted'; end if;
        new.deleted_at:=clock_timestamp();
      else raise exception using errcode='23514',message='invalid_submission_transition'; end if;
    end if;
    if new.visibility is distinct from old.visibility and new.status<>'completed' then
      raise exception using errcode='23514',message='submission_unavailable';
    end if;
  end if;
  new.updated_at:=clock_timestamp(); return new;
end;
$$;
create trigger prepare_submission before insert or update on public.submissions for each row execute function private.prepare_submission();
create function private.queue_submission_cleanup() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into private.photo_cleanup_queue(storage_path) values(old.storage_path) on conflict do nothing;
  return old;
end;
$$;
create trigger queue_submission_cleanup before delete on public.submissions for each row execute function private.queue_submission_cleanup();

-- The assignment lock also serializes direct privileged maintenance with completion.
create function private.block_submitted_replacement() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.submissions where daily_challenge_word_id=old.id and status<>'deleted') then
    raise exception using errcode='23514',message='assignment_has_submission';
  end if;
  return new;
end;
$$;
create trigger block_submitted_replacement before update on public.daily_challenge_words
  for each row when(old.replaced_at is null and new.replaced_at is not null)
  execute function private.block_submitted_replacement();

-- Lock order for user RPCs: profile -> assignment -> submission. No client identity inputs.
create function private.lock_photo_assignment(assignment_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required'; end if;
  perform 1 from public.profiles where id=auth.uid() and onboarding_completed_at is not null for update;
  if not found then raise exception using errcode='42501',message='onboarding_required'; end if;
  perform 1 from public.daily_challenge_words w join public.daily_challenges c on c.id=w.daily_challenge_id
    where w.id=assignment_id and c.user_id=auth.uid() and w.replaced_at is null for update of w;
  if not found then raise exception using errcode='42501',message='assignment_unavailable'; end if;
end;
$$;
create function private.lock_owned_submission(submission_id uuid) returns public.submissions
language plpgsql security definer set search_path='' as $$
declare s public.submissions;
begin
  select * into s from public.submissions where id=submission_id and user_id=auth.uid();
  if not found then raise exception using errcode='42501',message='submission_unavailable'; end if;
  perform private.lock_photo_assignment(s.daily_challenge_word_id);
  select * into strict s from public.submissions where id=submission_id for update;
  return s;
end;
$$;
create function public.get_assignment_photo(assignment_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.lock_photo_assignment(assignment_id);
  return (select jsonb_build_object('assignment',to_jsonb(w),'challenge',to_jsonb(c),'submission',
    (select to_jsonb(s) from public.submissions s where s.daily_challenge_word_id=w.id and s.status<>'deleted'))
    from public.daily_challenge_words w join public.daily_challenges c on c.id=w.daily_challenge_id where w.id=assignment_id);
end;
$$;
create function public.reserve_submission(assignment_id uuid) returns public.submissions
language plpgsql security definer set search_path='' as $$
declare s public.submissions;
begin
  perform private.lock_photo_assignment(assignment_id);
  select * into s from public.submissions where daily_challenge_word_id=assignment_id and status<>'deleted' for update;
  if not found then insert into public.submissions(daily_challenge_word_id) values(assignment_id) returning * into s; end if;
  return s;
end;
$$;
create function public.finalize_submission(submission_id uuid, requested_visibility text default 'private') returns public.submissions
language plpgsql security definer set search_path='' as $$
declare s public.submissions;
begin
  s:=private.lock_owned_submission(submission_id);
  if s.status='completed' then return s; end if;
  if s.status<>'pending' then raise exception using errcode='23514',message='submission_unavailable'; end if;
  if requested_visibility is null or requested_visibility not in ('private','public') then raise exception using errcode='23514',message='invalid_visibility'; end if;
  update public.submissions set status='completed',visibility=requested_visibility where id=s.id returning * into s;
  return s;
end;
$$;
create function public.set_submission_visibility(submission_id uuid, requested_visibility text) returns public.submissions
language plpgsql security definer set search_path='' as $$
declare s public.submissions;
begin
  s:=private.lock_owned_submission(submission_id);
  if s.status<>'completed' then raise exception using errcode='23514',message='submission_unavailable'; end if;
  if requested_visibility is null or requested_visibility not in ('private','public') then raise exception using errcode='23514',message='invalid_visibility'; end if;
  update public.submissions set visibility=requested_visibility where id=s.id returning * into s; return s;
end;
$$;
create function public.begin_submission_deletion(submission_id uuid) returns public.submissions
language plpgsql security definer set search_path='' as $$
declare s public.submissions;
begin
  select * into s from public.submissions where id=submission_id and user_id=auth.uid();
  if s.status='deleted' then return s; end if;
  s:=private.lock_owned_submission(submission_id);
  if s.status in ('pending','completed') then update public.submissions set status='deleting' where id=s.id returning * into s; end if;
  return s;
end;
$$;
create function public.finish_submission_deletion(submission_id uuid) returns public.submissions
language plpgsql security definer set search_path='' as $$
declare s public.submissions;
begin
  -- A retried delete stays idempotent even if the now-incomplete assignment was replaced.
  select * into s from public.submissions where id=submission_id and user_id=auth.uid();
  if s.status='deleted' then return s; end if;
  s:=private.lock_owned_submission(submission_id);
  if s.status<>'deleting' then raise exception using errcode='23514',message='submission_unavailable'; end if;
  update public.submissions set status='deleted' where id=s.id returning * into s; return s;
end;
$$;

alter table public.submissions enable row level security;
revoke all on public.submissions from public,anon,authenticated;
grant select on public.submissions to authenticated;
create policy submissions_read_own on public.submissions for select to authenticated using(user_id=(select auth.uid()));

-- RLS evaluates the exact reservation, not merely a user-controlled folder prefix.
-- A row lock makes revoking an upload reservation serialize with Storage's insert.
create function public.can_upload_submission_object(object_path text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.submissions where storage_path=object_path and user_id=auth.uid()
    and status='pending' and expires_at>clock_timestamp() for share;
  return found;
end;
$$;
create policy submission_photo_upload on storage.objects for insert to authenticated
  with check(bucket_id='challenge-submissions' and public.can_upload_submission_object(name)
    and (user_metadata is null or user_metadata='{}'::jsonb));
create policy submission_photo_read on storage.objects for select to authenticated using(
  bucket_id='challenge-submissions' and exists(select 1 from public.submissions s
    where s.storage_path=name and s.user_id=(select auth.uid()) and s.status in ('pending','completed','deleting')));
create policy submission_photo_delete on storage.objects for delete to authenticated using(
  bucket_id='challenge-submissions' and exists(select 1 from public.submissions s
    where s.storage_path=name and s.user_id=(select auth.uid()) and s.status='deleting'));
-- No UPDATE policy: no upsert, overwrite or move, including completed photos.

create or replace function private.challenge_payload(challenge_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('challenge',to_jsonb(c),'words',(
    select jsonb_agg(to_jsonb(w)||jsonb_build_object('submission',
      (select jsonb_build_object('id',s.id,'status',s.status,'submitted_at',s.submitted_at)
       from public.submissions s where s.daily_challenge_word_id=w.id and s.status<>'deleted'))
      order by case w.slot when 'review' then 1 when 'target' then 2 else 3 end)
    from public.daily_challenge_words w where w.daily_challenge_id=c.id and w.replaced_at is null))
  from public.daily_challenges c where c.id=challenge_id and c.user_id=auth.uid();
$$;

-- Server-only maintenance API. The worker uses Storage API deletion, never SQL
-- DELETE on storage.objects (which would leave the physical bytes behind).
create function public.claim_photo_cleanup(batch_size integer default 100) returns table(storage_path text)
language plpgsql security definer set search_path='' as $$
declare s public.submissions;
begin
  if batch_size is null or batch_size<1 or batch_size>1000 then raise exception 'invalid_batch_size'; end if;
  for s in select * from public.submissions
    where status='deleting' or (status='pending' and expires_at<=clock_timestamp())
    order by updated_at limit batch_size for update skip locked loop
    if s.status='pending' then update public.submissions set status='deleting' where id=s.id; end if;
    insert into private.photo_cleanup_queue(storage_path) values(s.storage_path) on conflict do nothing;
  end loop;
  -- Sweep late-arriving uploads and objects left by privileged/account cascades.
  -- This also repairs an interrupted Storage request that outlives cancellation.
  insert into private.photo_cleanup_queue(storage_path)
    select o.name from storage.objects o left join public.submissions stored on stored.storage_path=o.name
    where o.bucket_id='challenge-submissions' and (stored.id is null or stored.status='deleted')
    limit batch_size on conflict do nothing;
  return query select q.storage_path from private.photo_cleanup_queue q order by q.created_at limit batch_size;
end;
$$;
create function public.finish_photo_cleanup(object_path text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if private.submission_object_exists(object_path) then raise exception using errcode='23514',message='photo_not_deleted'; end if;
  update public.submissions set status='deleted' where storage_path=object_path and status='deleting';
  delete from private.photo_cleanup_queue where storage_path=object_path;
end;
$$;
revoke all on all functions in schema private from public,anon,authenticated;
revoke all on function public.get_assignment_photo(uuid),public.reserve_submission(uuid),public.finalize_submission(uuid,text),
  public.set_submission_visibility(uuid,text),public.begin_submission_deletion(uuid),public.finish_submission_deletion(uuid),
  public.can_upload_submission_object(text),public.claim_photo_cleanup(integer),public.finish_photo_cleanup(text) from public,anon,authenticated;
grant execute on function public.get_assignment_photo(uuid),public.reserve_submission(uuid),public.finalize_submission(uuid,text),
  public.set_submission_visibility(uuid,text),public.begin_submission_deletion(uuid),public.finish_submission_deletion(uuid),
  public.can_upload_submission_object(text) to authenticated;
grant execute on function public.claim_photo_cleanup(integer),public.finish_photo_cleanup(text) to service_role;
commit;
