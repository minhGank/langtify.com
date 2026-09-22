begin;

-- Avatars have their own lifecycle; challenge image authority is unchanged.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('profile-avatars','profile-avatars',false,1048576,array['image/jpeg'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,
 allowed_mime_types=excluded.allowed_mime_types;

create table if not exists private.avatar_states (
 user_id uuid primary key references auth.users(id) on delete cascade,
 revision bigint not null default 0 check(revision>=0)
);
create table if not exists private.profile_avatars (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null, revision bigint not null check(revision>0),
 storage_path text not null unique,
 status text not null default 'pending' check(status in('pending','current','retired')),
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '1 hour',
 object_id uuid,object_version text,sha256 text,
 width integer check(width between 1 and 512),height integer check(height between 1 and 512),
 unique(user_id,request_id),unique(user_id,revision),
 check(storage_path=id::text||'.jpg'),
 check(status<>'current' or (object_id is not null and object_version is not null
  and sha256 is not null and sha256 ~ '^[0-9a-f]{64}$' and width is not null and height is not null))
);
create unique index if not exists profile_avatars_current on private.profile_avatars(user_id) where status='current';
create unique index if not exists profile_avatars_pending on private.profile_avatars(user_id) where status='pending';
create index if not exists profile_avatars_cleanup on private.profile_avatars(status,expires_at);
create table if not exists private.avatar_cleanup_queue (
 storage_path text primary key,created_at timestamptz not null default clock_timestamp(),
 last_attempt_at timestamptz
);
create index if not exists avatar_cleanup_attempt on private.avatar_cleanup_queue(last_attempt_at nulls first,created_at);

create or replace function private.avatar_owner_active(subject uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users u join public.profiles p on p.id=u.id
 where u.id=subject and u.deleted_at is null
 and (u.banned_until is null or u.banned_until<=statement_timestamp())
 and p.onboarding_completed_at is not null);
$$;
create or replace function private.current_avatar_id(subject uuid) returns uuid
language sql stable security definer set search_path='' as $$
 select a.id from private.profile_avatars a join storage.objects o
 on o.id=a.object_id and o.version=a.object_version and o.bucket_id='profile-avatars' and o.name=a.storage_path
 where a.user_id=subject and a.status='current';
$$;
create or replace function public.get_own_avatar() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=private.safety_actor();
begin return jsonb_build_object('viewer_id',viewer,'avatar_id',private.current_avatar_id(viewer));end;
$$;
create or replace function public.reserve_profile_avatar(request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare viewer uuid:=private.safety_actor();a private.profile_avatars;next_revision bigint;new_id uuid;
begin
 if request_id is null then raise exception using errcode='22023',message='invalid_avatar_request';end if;
 -- Auth deletion/restriction takes the Auth row before cascading to avatar rows.
 perform 1 from auth.users where id=viewer for share;
 if not found or not private.avatar_owner_active(viewer) then raise exception using errcode='42501',message='avatar_unavailable';end if;
 insert into private.avatar_states(user_id) values(viewer) on conflict do nothing;
 perform 1 from private.avatar_states where user_id=viewer for update;
 select * into a from private.profile_avatars where user_id=viewer and profile_avatars.request_id=reserve_profile_avatar.request_id;
 if not found then
  update private.avatar_states set revision=revision+1 where user_id=viewer returning revision into next_revision;
  update private.profile_avatars set status='retired' where user_id=viewer and status='pending';
  new_id:=gen_random_uuid();
  insert into private.profile_avatars(id,user_id,request_id,revision,storage_path)
  values(new_id,viewer,request_id,next_revision,new_id::text||'.jpg') returning * into a;
 end if;
 if a.status='retired' or (a.status='pending' and a.expires_at<=clock_timestamp()) then
  raise exception using errcode='42501',message='avatar_upload_expired';
 end if;
 return jsonb_build_object('viewer_id',viewer,'avatar',jsonb_build_object('id',a.id,'storage_path',a.storage_path,'status',a.status));
end;
$$;
create or replace function public.remove_profile_avatar(expected_avatar_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare viewer uuid:=private.safety_actor();
begin
 perform 1 from auth.users where id=viewer for share;
 if not found or not private.avatar_owner_active(viewer) then raise exception using errcode='42501',message='avatar_unavailable';end if;
 perform 1 from private.avatar_states where user_id=viewer for update;
 -- Compare-and-remove makes a replay unable to remove a newer avatar.
 if exists(select 1 from private.profile_avatars where user_id=viewer and id=expected_avatar_id and status='current') then
  update private.avatar_states set revision=revision+1 where user_id=viewer;
  update private.profile_avatars set status='retired' where user_id=viewer and status in('pending','current');
 end if;
 return jsonb_build_object('viewer_id',viewer,'avatar_id',private.current_avatar_id(viewer));
end;
$$;
create or replace function public.can_upload_avatar_object(object_name text) returns boolean
language plpgsql security definer set search_path='' as $$
declare a private.profile_avatars;
begin
 select * into a from private.profile_avatars where storage_path=object_name and user_id=auth.uid() for share;
 return found and a.status='pending' and a.expires_at>clock_timestamp()
 and private.avatar_owner_active(auth.uid());
end;
$$;
drop policy if exists profile_avatar_upload on storage.objects;
create policy profile_avatar_upload on storage.objects for insert to authenticated with check(
 bucket_id='profile-avatars' and current_setting('storage.operation',true)='storage.object.upload'
 and public.can_upload_avatar_object(name) and (user_metadata is null or user_metadata='{}'::jsonb));

create or replace function private.guard_avatar_object() returns trigger
language plpgsql security definer set search_path='' as $$
declare a private.profile_avatars;
begin
 if tg_op='UPDATE' then
  if (old.bucket_id='profile-avatars' and
   (to_jsonb(new)-array['updated_at','last_accessed_at']) is distinct from (to_jsonb(old)-array['updated_at','last_accessed_at']))
   or (new.bucket_id='profile-avatars' and old.bucket_id is distinct from new.bucket_id) then
   raise exception using errcode='23514',message='avatar_object_immutable';
  end if;return new;
 elsif tg_op='DELETE' then
  if old.bucket_id='profile-avatars' and exists(select 1 from private.profile_avatars where storage_path=old.name and status in('pending','current')) then
   raise exception using errcode='23514',message='avatar_deletion_not_requested';
  end if;return old;
 end if;
 if new.bucket_id<>'profile-avatars' then return new;end if;
 select * into a from private.profile_avatars where storage_path=new.name for share;
 if not found or a.status<>'pending' or a.expires_at<=clock_timestamp() then
  raise exception using errcode='23514',message='avatar_reservation_unavailable';
 end if;
 if new.owner_id is distinct from a.user_id::text
  or (new.user_metadata is not null and new.user_metadata<>'{}'::jsonb) then
  raise exception using errcode='23514',message='invalid_avatar_metadata';
 end if;return new;
end;
$$;
drop trigger if exists langtify_guard_avatar_object on storage.objects;
create trigger langtify_guard_avatar_object before insert or update or delete on storage.objects
 for each row execute function private.guard_avatar_object();

create or replace function public.avatar_verification_target(avatar_id uuid,expected_user_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',a.id,'status',a.status,'storage_path',a.storage_path,'object_id',o.id,'object_version',o.version)
 from private.profile_avatars a left join storage.objects o on o.bucket_id='profile-avatars' and o.name=a.storage_path
 where a.id=avatar_id and a.user_id=expected_user_id and a.status in('pending','current')
 and (a.status='current' or a.expires_at>clock_timestamp()) and private.avatar_owner_active(expected_user_id);
$$;
create or replace function public.activate_profile_avatar(avatar_id uuid,expected_user_id uuid,
 expected_object_id uuid,expected_object_version text,image_sha256 text,image_width integer,image_height integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a private.profile_avatars;latest bigint;
begin
 perform 1 from auth.users where id=expected_user_id for share;
 if not found or not private.avatar_owner_active(expected_user_id) then raise exception using errcode='42501',message='avatar_unavailable';end if;
 select revision into latest from private.avatar_states where user_id=expected_user_id for update;
 select * into a from private.profile_avatars where id=avatar_id and user_id=expected_user_id for update;
 if not found then raise exception using errcode='42501',message='avatar_unavailable';end if;
 if a.status='current' then return jsonb_build_object('viewer_id',expected_user_id,'avatar_id',a.id);end if;
 if a.status<>'pending' or a.revision<>latest or a.expires_at<=clock_timestamp() then
  raise exception using errcode='42501',message='avatar_upload_expired';
 end if;
 perform 1 from storage.objects where id=expected_object_id and version=expected_object_version
  and bucket_id='profile-avatars' and name=a.storage_path and metadata->>'mimetype'='image/jpeg'
  and (metadata->>'size')::bigint between 1 and 1048576 for share;
 if not found then raise exception using errcode='23514',message='avatar_not_uploaded';end if;
 if image_sha256 is null or image_sha256 !~ '^[0-9a-f]{64}$' or image_width is null or image_height is null
  or image_width not between 1 and 512 or image_height not between 1 and 512 then
  raise exception using errcode='23514',message='invalid_avatar';
 end if;
 update private.profile_avatars set status='retired' where user_id=expected_user_id and status='current';
 update private.profile_avatars set status='current',object_id=expected_object_id,object_version=expected_object_version,
  sha256=image_sha256,width=image_width,height=image_height where id=a.id;
 return jsonb_build_object('viewer_id',expected_user_id,'avatar_id',a.id);
end;
$$;
create or replace function public.get_avatar_targets(viewer uuid,avatar_ids uuid[])
returns table(id uuid,storage_path text) language plpgsql stable security definer set search_path='' as $$
begin
 if not private.avatar_owner_active(viewer) then raise exception using errcode='42501',message='avatar_unavailable';end if;
 if avatar_ids is null or cardinality(avatar_ids) not between 1 and 24
  or exists(select 1 from unnest(avatar_ids) x where x is null)
  or (select count(distinct x) from unnest(avatar_ids) x)<>cardinality(avatar_ids) then
  raise exception using errcode='22023',message='invalid_avatar_request';
 end if;
 return query select a.id,a.storage_path from private.profile_avatars a join storage.objects o
 on o.id=a.object_id and o.version=a.object_version and o.bucket_id='profile-avatars' and o.name=a.storage_path
 where a.id=any(avatar_ids) and a.status='current'
 and (a.user_id=viewer or private.social_profile_visible(viewer,a.user_id));
end;
$$;

create or replace function private.queue_retired_avatar() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then insert into private.avatar_cleanup_queue(storage_path) values(old.storage_path) on conflict do nothing;return old;end if;
 if new.status='retired' then insert into private.avatar_cleanup_queue(storage_path) values(new.storage_path) on conflict do nothing;end if;return new;
end;
$$;
drop trigger if exists queue_retired_avatar on private.profile_avatars;
create trigger queue_retired_avatar after update or delete on private.profile_avatars
 for each row execute function private.queue_retired_avatar();
create or replace function public.claim_avatar_cleanup(batch_size integer default 100) returns table(storage_path text)
language plpgsql security definer set search_path='' as $$
begin
 if batch_size is null or batch_size not between 1 and 1000 then raise exception using errcode='22023',message='invalid_batch_size';end if;
 update private.profile_avatars set status='retired' where id in(
  select a.id from private.profile_avatars a where a.status='pending' and a.expires_at<=clock_timestamp()
  order by a.expires_at limit batch_size for update skip locked);
 insert into private.avatar_cleanup_queue(storage_path)
 select o.name from storage.objects o left join private.profile_avatars a on a.storage_path=o.name
 where o.bucket_id='profile-avatars' and (a.id is null or a.status='retired')
 and not exists(select 1 from private.avatar_cleanup_queue q where q.storage_path=o.name)
 limit batch_size on conflict do nothing;
 return query with jobs as(select q.storage_path from private.avatar_cleanup_queue q
  order by q.last_attempt_at nulls first,q.created_at limit batch_size for update skip locked)
 update private.avatar_cleanup_queue q set last_attempt_at=clock_timestamp()
 from jobs where q.storage_path=jobs.storage_path returning q.storage_path;
end;
$$;
create or replace function public.finish_avatar_cleanup(object_path text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from storage.objects where bucket_id='profile-avatars' and name=object_path) then
  raise exception using errcode='23514',message='avatar_object_still_present';end if;
 -- Keep request tombstones: an old reservation retry must never become a new upload.
 delete from private.avatar_cleanup_queue where storage_path=object_path;
end;
$$;

do $$declare t text;f record;begin
 foreach t in array array['avatar_states','profile_avatars','avatar_cleanup_queue'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 end loop;
 for f in select oid::regprocedure signature from pg_proc where pronamespace='private'::regnamespace
 and proname in('avatar_owner_active','current_avatar_id','guard_avatar_object','queue_retired_avatar') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace
 and proname in('get_own_avatar','reserve_profile_avatar','remove_profile_avatar','can_upload_avatar_object') loop
  execute format('revoke all on function %s from public,anon,service_role',f.signature);
  execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace
 and proname in('avatar_verification_target','activate_profile_avatar','get_avatar_targets','claim_avatar_cleanup','finish_avatar_cleanup') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end;$$;

-- Extend only the controlled social projection, never raw profile RLS.
create or replace function public.get_public_profile(profile_id uuid default null,submission_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=private.safety_actor();subject uuid;target uuid;result jsonb;
begin
 target:=private.discover_target(viewer);
 if profile_id is not null and submission_id is not null then raise exception using errcode='22023',message='invalid_profile_query';end if;
 if submission_id is not null then
  select c.owner_id into subject from private.discover_candidates c where c.id=submission_id and c.target_language_id=target and not private.users_blocked(viewer,c.owner_id);
 elsif profile_id is not null then
  select p.id into subject from public.profiles p where p.public_id=profile_id;
 else subject:=viewer;
 end if;
 if not private.social_profile_visible(viewer,subject) then raise exception using errcode='42501',message='profile_unavailable';end if;
 select jsonb_build_object('viewer_id',viewer,'profile',jsonb_build_object(
  'id',p.public_id,'username',p.username,'avatar_id',private.current_avatar_id(p.id),'is_self',p.id=viewer,
  'is_following',exists(select 1 from public.user_follows f where f.follower_user_id=viewer and f.followed_user_id=subject),
  'follower_count',counts.follower_count,'following_count',counts.following_count))
 into result from public.profiles p cross join lateral private.visible_follow_counts(viewer,subject) counts where p.id=subject;
 return result;
end;$$;

create or replace function public.search_public_profiles(prefix text,after_username text default null,after_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=private.safety_actor();needle text:=lower(btrim(prefix));result jsonb;
begin
 perform private.discover_target(viewer);
 if needle is null or char_length(needle) not between 2 and 30 or needle !~ '^[a-z0-9][a-z0-9_]*$'
  or (after_username is null)<>(after_id is null)
  or (after_username is not null and after_username !~ '^[a-z0-9][a-z0-9_]{2,29}$') then
  raise exception using errcode='22023',message='invalid_user_search';
 end if;
 -- Literal C-collation range remains an index condition under generic plans;
 -- '_' is a literal username character, never a LIKE wildcard.
 with page as materialized (
  select p.public_id as id,p.username,private.current_avatar_id(p.id) as avatar_id from public.profiles p
  where p.username is not null and p.onboarding_completed_at is not null
   and p.username collate "C">=needle collate "C" and p.username collate "C"<(needle||'{') collate "C"
   and (p.username collate "C",p.public_id)>(coalesce(after_username,'') collate "C",coalesce(after_id,'00000000-0000-0000-0000-000000000000'::uuid))
   and private.social_profile_visible(viewer,p.id)
  order by p.username collate "C",p.public_id limit 21
 ),shown as(select * from page order by username collate "C",id limit 20)
 select jsonb_build_object('viewer_id',viewer,'items',coalesce((select jsonb_agg(to_jsonb(s) order by username collate "C",id) from shown s),'[]'::jsonb),'has_more',(select count(*)>20 from page)) into result;
 return result;
end;$$;

commit;
