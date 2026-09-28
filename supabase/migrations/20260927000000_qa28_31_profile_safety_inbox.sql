begin;

-- The sole public progression value; use the same signed ledger and level helper
-- as owner progress. Callers must admit the profile before returning this value.
create or replace function private.public_profile_level(subject uuid) returns integer
language sql stable security definer set search_path='' as $$
 select (private.level_progress(coalesce(sum(e.amount),0)::bigint)->>'level')::integer
 from public.xp_events e where e.user_id=subject;
$$;

create or replace function private.social_profile_projection(viewer uuid,subject uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',p.public_id,'username',p.username,
  'level',private.public_profile_level(p.id),'avatar_id',private.current_avatar_id(p.id),'is_self',p.id=viewer,
  'is_following',exists(select 1 from public.user_follows f where f.follower_user_id=viewer and f.followed_user_id=subject),
  'follower_count',counts.follower_count,'following_count',counts.following_count)
 from public.profiles p cross join lateral private.visible_follow_counts(viewer,subject) counts
 where p.id=subject and private.social_profile_visible(viewer,subject);
$$;

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
  'id',p.public_id,'username',p.username,'level',private.public_profile_level(p.id),'avatar_id',private.current_avatar_id(p.id),'is_self',p.id=viewer,
  'is_following',exists(select 1 from public.user_follows f where f.follower_user_id=viewer and f.followed_user_id=subject),
  'follower_count',counts.follower_count,'following_count',counts.following_count))
 into result from public.profiles p cross join lateral private.visible_follow_counts(viewer,subject) counts where p.id=subject;
 return result;
end;$$;

-- Recognition is a separate, owner-of-block capability. It never admits posts,
-- follows, counts, XP, comments, search or ordinary avatar access across a block.
create or replace function private.blocked_avatar_visible(viewer uuid,subject uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.avatar_owner_active(viewer) and private.avatar_owner_active(subject)
 and exists(select 1 from public.user_blocks b where b.blocker_user_id=viewer and b.blocked_user_id=subject)
 and not exists(select 1 from private.safety_accounts a where a.user_id in(viewer,subject) and a.restricted);
$$;

create or replace function private.blocked_profile_projection(viewer uuid,block_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',b.id,'username',p.username,
  'avatar_id',case when private.blocked_avatar_visible(viewer,p.id) then private.current_avatar_id(p.id) end)
 from public.user_blocks b join public.profiles p on p.id=b.blocked_user_id
 where b.id=block_id and b.blocker_user_id=viewer;
$$;

create or replace function public.get_blocked_users(before_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=private.safety_actor();result jsonb;
begin
 with page as materialized (
  select b.id from public.user_blocks b where b.blocker_user_id=viewer
   and b.id<coalesce(before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)
  order by b.id desc limit 21
 ),shown as(select * from page order by id desc limit 20)
 select jsonb_build_object('viewer_id',viewer,
  'items',coalesce((select jsonb_agg(private.blocked_profile_projection(viewer,s.id) order by s.id desc) from shown s),'[]'::jsonb),
  'has_more',(select count(*)>20 from page)) into result;
 return result;
end;$$;

create or replace function public.get_blocked_profile(block_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=private.safety_actor();result jsonb;
begin
 result:=private.blocked_profile_projection(viewer,block_id);
 if result is null then raise exception using errcode='42501',message='blocked_profile_unavailable';end if;
 return jsonb_build_object('viewer_id',viewer,'profile',result);
end;$$;

-- Service-only, called by avatar-authority after authenticating the real caller.
-- Keep the ordinary get_avatar_targets function and its block denial unchanged.
create or replace function public.get_blocked_avatar_targets(viewer uuid,avatar_ids uuid[])
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
 where a.id=any(avatar_ids) and a.status='current' and private.blocked_avatar_visible(viewer,a.user_id);
end;$$;

-- A durable admission receipt prevents an uncertain old open request from later
-- clearing new events. Its ID is only an idempotency key, never a caller cutoff.
create table if not exists private.inbox_openings (
 user_id uuid not null references public.profiles(id) on delete cascade,
 request_id uuid not null,
 opened_at timestamptz not null check(isfinite(opened_at)),
 primary key(user_id,request_id)
);
alter table private.inbox_openings enable row level security;
revoke all on private.inbox_openings from public,anon,authenticated,service_role;

create or replace function public.open_notification_inbox(request_id uuid,displayed_ids uuid[] default '{}'::uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare viewer uuid:=private.safety_actor();cutoff timestamptz;
begin
 if request_id is null or displayed_ids is null or cardinality(displayed_ids)>60
  or exists(select 1 from unnest(displayed_ids) x where x is null)
  or (select count(distinct x) from unnest(displayed_ids) x)<>cardinality(displayed_ids) then
  raise exception using errcode='22023',message='invalid_inbox_open';end if;
 -- Own Auth row precedes all FK/notification locks, matching account erasure.
 perform 1 from auth.users where id=viewer for share;
 if not found then raise exception using errcode='42501',message='account_unavailable';end if;
 -- Serialize only inbox opens for this owner, not social producers. Capturing
 -- membership in the UPDATE statement snapshot leaves uncommitted inserts unread.
 perform pg_advisory_xact_lock(hashtextextended('inbox-open:'||viewer::text,0));
 select o.opened_at into cutoff from private.inbox_openings o
 where o.user_id=viewer and o.request_id=open_notification_inbox.request_id;
 if not found then
  perform private.ensure_daily_in_app_notification(viewer);
  cutoff:=clock_timestamp();
  with candidates as materialized (
   select n.id from public.in_app_notifications n where n.user_id=viewer
    and n.read_at is null and n.created_at<=cutoff and private.in_app_notification_visible(viewer,n)
   order by n.id for update
  )
  update public.in_app_notifications n set read_at=greatest(cutoff,n.created_at)
  from candidates c where n.id=c.id and n.user_id=viewer and n.read_at is null;
  insert into private.inbox_openings(user_id,request_id,opened_at)
  values(viewer,request_id,cutoff);
 end if;
 return private.in_app_notification_summary(viewer)||jsonb_build_object('ok',true,'opened_at',cutoff,
  'read_states',coalesce((select jsonb_agg(jsonb_build_object('id',n.id,'read',n.read_at is not null))
   from public.in_app_notifications n where n.user_id=viewer and n.id=any(displayed_ids)
    and private.in_app_notification_visible(viewer,n)),'[]'::jsonb));
end;$$;

revoke all on function private.public_profile_level(uuid),private.blocked_avatar_visible(uuid,uuid),private.blocked_profile_projection(uuid,uuid)
 from public,anon,authenticated,service_role;
revoke all on function public.get_blocked_profile(uuid),public.open_notification_inbox(uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.get_blocked_profile(uuid),public.open_notification_inbox(uuid,uuid[]) to authenticated;
revoke all on function public.get_blocked_avatar_targets(uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.get_blocked_avatar_targets(uuid,uuid[]) to service_role;

create or replace function public.get_explore_concept(concept_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=private.safety_actor();target uuid;reference uuid;item jsonb;
begin
 target:=private.discover_target(viewer);
 select reference_language_id into reference from public.user_language_profiles where user_id=viewer;
 if concept_id is null then raise exception using errcode='22023',message='invalid_explore_concept';end if;
 select jsonb_build_object('concept_id',t.concept_id,'target_term',t.term,'reference_term',r.term,'cefr_level',t.cefr_level,
  'has_captures',exists(select 1 from public.submissions s where s.user_id=viewer and s.concept_id=t.concept_id and s.status='completed')) into item
 from public.vocabulary_terms t
 join public.vocabulary_concepts c on c.id=t.concept_id and c.is_active and c.is_photographable
 join public.vocabulary_terms r on r.concept_id=t.concept_id and r.language_id=reference and r.is_active
 join public.languages tl on tl.id=t.language_id and tl.is_active
 join public.languages rl on rl.id=r.language_id and rl.is_active
 where t.concept_id=get_explore_concept.concept_id and t.language_id=target and t.is_active;
 return jsonb_build_object('viewer_id',viewer,'target_language_id',target,'reference_language_id',reference,'item',item);
end;$$;

create or replace function public.resolve_notification_target(notification_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=private.safety_actor();result jsonb;
begin
 select jsonb_build_object('viewer_id',viewer,'kind',n.kind,
  'profile_id',case when n.kind='NEW_FOLLOWER' then p.public_id end,
  'submission_id',s.id,'assignment_id',s.daily_challenge_word_id,'challenge_id',n.challenge_id) into result
 from public.in_app_notifications n left join public.profiles p on p.id=n.actor_user_id and n.kind='NEW_FOLLOWER'
 left join public.submissions s on s.id=n.submission_id
 where n.id=notification_id and n.user_id=viewer and private.in_app_notification_visible(viewer,n);
 if result is null then raise exception using errcode='42501',message='notification_unavailable';end if;
 return result;
end;$$;

commit;
