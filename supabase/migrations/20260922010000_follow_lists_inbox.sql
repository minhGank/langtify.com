begin;

-- The first index column isolates one profile's relationships before paging.
create index if not exists user_follows_followers_page
 on public.user_follows(followed_user_id,created_at desc,follower_user_id);
create index if not exists user_follows_following_page
 on public.user_follows(follower_user_id,created_at desc,followed_user_id);

create or replace function private.social_profile_projection(viewer uuid,subject uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',p.public_id,'username',p.username,
  'avatar_id',private.current_avatar_id(p.id),'is_self',p.id=viewer,
  'is_following',exists(select 1 from public.user_follows f where f.follower_user_id=viewer and f.followed_user_id=subject),
  'follower_count',counts.follower_count,'following_count',counts.following_count)
 from public.profiles p cross join lateral private.visible_follow_counts(viewer,subject) counts
 where p.id=subject and private.social_profile_visible(viewer,subject);
$$;

create or replace function public.get_profile_connections(
 profile_id uuid,list_kind text,before_time timestamptz default null,before_id uuid default null,page_size integer default 20
) returns jsonb language plpgsql security definer set search_path='' as $$
declare viewer uuid:=private.safety_actor();subject uuid;result jsonb;
begin
 perform private.discover_target(viewer);
 if profile_id is null or list_kind is null or list_kind not in('followers','following')
  or page_size is null or page_size not between 1 and 24
  or (before_time is null)<>(before_id is null)
  or (before_time is not null and not isfinite(before_time)) then
  raise exception using errcode='22023',message='invalid_connections_query';
 end if;
 select p.id into subject from public.profiles p where p.public_id=profile_id;
 if not private.social_profile_visible(viewer,subject) then raise exception using errcode='42501',message='profile_unavailable';end if;
 with edges as (
  select f.follower_user_id as other_id,f.created_at from public.user_follows f
   where list_kind='followers' and f.followed_user_id=subject and f.created_at<=coalesce(before_time,'infinity'::timestamptz)
  union all
  select f.followed_user_id,f.created_at from public.user_follows f
   where list_kind='following' and f.follower_user_id=subject and f.created_at<=coalesce(before_time,'infinity'::timestamptz)
 ),page as materialized (
  select p.public_id as id,p.username,p.id as owner_id,e.created_at as followed_at,
   p.id=viewer as is_self,exists(select 1 from public.user_follows own where own.follower_user_id=viewer and own.followed_user_id=p.id) as is_following
  from edges e join public.profiles p on p.id=e.other_id
  where private.social_profile_visible(viewer,p.id) and private.social_profile_visible(subject,p.id)
   and (e.created_at,p.public_id)<(coalesce(before_time,'infinity'::timestamptz),coalesce(before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
  order by e.created_at desc,p.public_id desc limit page_size+1
 ),shown as(select * from page order by followed_at desc,id desc limit page_size)
 select jsonb_build_object('viewer_id',viewer,'profile',private.social_profile_projection(viewer,subject),
  'items',coalesce((select jsonb_agg((to_jsonb(s)-'owner_id')||jsonb_build_object('avatar_id',private.current_avatar_id(s.owner_id)) order by followed_at desc,id desc) from shown s),'[]'::jsonb),
  'has_more',(select count(*)>page_size from page)) into result;
 return result;
end;$$;

create or replace function public.set_follow(profile_id uuid,following boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare viewer uuid:=private.safety_actor();subject uuid;
begin
 if following is null then raise exception using errcode='22023',message='invalid_follow';end if;
 select p.id into subject from public.profiles p where p.public_id=profile_id;
 if subject is null or subject=viewer then raise exception using errcode='42501',message='follow_unavailable';end if;
 perform private.lock_social_users(array[viewer,subject]);
 if following then
  perform private.discover_target(viewer);
  if not private.social_profile_visible(viewer,subject) then raise exception using errcode='42501',message='follow_unavailable';end if;
  insert into public.user_follows(follower_user_id,followed_user_id) values(viewer,subject) on conflict do nothing;
 else
  delete from public.user_follows f where f.follower_user_id=viewer and f.followed_user_id=subject;
 end if;
 return jsonb_build_object('viewer_id',viewer,'ok',true,
  'profile',private.social_profile_projection(viewer,subject),'viewer_profile',private.social_profile_projection(viewer,viewer),
  'followed_at',(select f.created_at from public.user_follows f where f.follower_user_id=viewer and f.followed_user_id=subject));
end;$$;

-- Inbox events are not push jobs. No provider/token/preference tables or sender
-- types are changed. The durable source key survives unfollow/refollow retries.
create table if not exists public.in_app_notifications (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 kind text not null check(kind in('NEW_FOLLOWER','NEW_RATING','DAILY_WORDS_READY')),
 source_key text not null check(length(source_key) between 1 and 160),
 actor_user_id uuid references auth.users(id) on delete cascade,
 submission_id uuid references public.submissions(id) on delete cascade,
 challenge_id uuid references public.daily_challenges(id) on delete cascade,
 created_at timestamptz not null default clock_timestamp(),
 read_at timestamptz,
 unique(user_id,kind,source_key),
 check(actor_user_id is null or actor_user_id<>user_id),
 check(read_at is null or read_at>=created_at),
 check((kind='NEW_FOLLOWER' and actor_user_id is not null and submission_id is null and challenge_id is null)
  or (kind='NEW_RATING' and actor_user_id is not null and submission_id is not null and challenge_id is null)
  or (kind='DAILY_WORDS_READY' and actor_user_id is null and submission_id is null and challenge_id is not null))
);
create index if not exists in_app_notifications_owner_page on public.in_app_notifications(user_id,created_at desc,id desc);
create index if not exists in_app_notifications_unread on public.in_app_notifications(user_id,created_at desc,id desc) where read_at is null;
create index if not exists in_app_notifications_actor on public.in_app_notifications(actor_user_id) where actor_user_id is not null;
create index if not exists in_app_notifications_submission on public.in_app_notifications(submission_id) where submission_id is not null;
create index if not exists in_app_notifications_challenge on public.in_app_notifications(challenge_id) where challenge_id is not null;
alter table public.in_app_notifications enable row level security;
revoke all on public.in_app_notifications from public,anon,authenticated,service_role;

create or replace function private.preserve_in_app_notification() returns trigger
language plpgsql set search_path='' as $$
begin
 if (new.id,new.user_id,new.kind,new.source_key,new.actor_user_id,new.submission_id,new.challenge_id,new.created_at)
  is distinct from (old.id,old.user_id,old.kind,old.source_key,old.actor_user_id,old.submission_id,old.challenge_id,old.created_at) then
  raise exception using errcode='23514',message='immutable_notification_source';
 end if;
 return new;
end;$$;
drop trigger if exists preserve_in_app_notification on public.in_app_notifications;
create trigger preserve_in_app_notification before update on public.in_app_notifications
 for each row execute function private.preserve_in_app_notification();

create or replace function private.notify_new_follower() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.in_app_notifications(user_id,kind,source_key,actor_user_id)
 values(new.followed_user_id,'NEW_FOLLOWER',new.follower_user_id::text,new.follower_user_id) on conflict do nothing;
 return new;
end;$$;
drop trigger if exists notify_new_follower on public.user_follows;
create trigger notify_new_follower after insert on public.user_follows for each row execute function private.notify_new_follower();

create or replace function private.notify_new_rating() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.in_app_notifications(user_id,kind,source_key,actor_user_id,submission_id)
 select s.user_id,'NEW_RATING',new.rater_user_id::text||':'||new.submission_id::text,new.rater_user_id,s.id
 from public.submissions s where s.id=new.submission_id and s.user_id<>new.rater_user_id
 on conflict do nothing;
 return new;
end;$$;
drop trigger if exists notify_new_rating on public.submission_ratings;
create trigger notify_new_rating after insert on public.submission_ratings for each row execute function private.notify_new_rating();

create or replace function private.notify_daily_words_ready() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 -- Run once when a newly-created challenge commits with all three slots, never
 -- on assignment replacement, device clocks, read retries or migration replay.
 if exists(select 1 from public.daily_challenges c where c.id=new.id)
  and (select count(*) from public.daily_challenge_words w where w.daily_challenge_id=new.id and w.replaced_at is null)=3 then
  insert into public.in_app_notifications(user_id,kind,source_key,challenge_id)
  values(new.user_id,'DAILY_WORDS_READY',new.id::text,new.id) on conflict do nothing;
 end if;
 return null;
end;$$;
drop trigger if exists notify_daily_words_ready on public.daily_challenges;
create constraint trigger notify_daily_words_ready after insert on public.daily_challenges
 deferrable initially deferred for each row execute function private.notify_daily_words_ready();

create or replace function private.in_app_notification_visible(viewer uuid,n public.in_app_notifications) returns boolean
language sql stable security definer set search_path='' as $$
 select n.user_id=viewer and case n.kind
 when 'NEW_FOLLOWER' then private.social_profile_visible(viewer,n.actor_user_id)
  and exists(select 1 from public.user_follows f where f.follower_user_id=n.actor_user_id and f.followed_user_id=viewer)
 when 'NEW_RATING' then private.social_profile_visible(viewer,n.actor_user_id)
  and exists(select 1 from private.discover_candidates c where c.id=n.submission_id and c.owner_id=viewer)
  and exists(select 1 from public.submission_ratings r where r.submission_id=n.submission_id and r.rater_user_id=n.actor_user_id)
 when 'DAILY_WORDS_READY' then exists(select 1 from public.daily_challenges c where c.id=n.challenge_id and c.user_id=viewer
  and (select count(*) from public.daily_challenge_words w where w.daily_challenge_id=c.id and w.replaced_at is null)=3)
 else false end;
$$;

-- Existing users may already have today's challenge at deployment. Ensure only
-- that server-derived current day on demand; never backfill an old social event or
-- create a challenge as a side effect of browsing the bell/inbox.
create or replace function private.ensure_daily_in_app_notification(viewer uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 insert into public.in_app_notifications(user_id,kind,source_key,challenge_id)
 select viewer,'DAILY_WORDS_READY',c.id::text,c.id
 from public.user_language_profiles l join public.daily_challenges c on c.user_language_profile_id=l.id and c.user_id=viewer
 where l.user_id=viewer and c.local_challenge_date=(statement_timestamp() at time zone l.timezone)::date
  and (select count(*) from public.daily_challenge_words w where w.daily_challenge_id=c.id and w.replaced_at is null)=3
 on conflict do nothing;
end;$$;

create or replace function private.in_app_notification_summary(viewer uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('viewer_id',viewer,'unread_count',
  (select count(*) from public.in_app_notifications n where n.user_id=viewer and n.read_at is null and private.in_app_notification_visible(viewer,n)),
  'read_cursor',(select jsonb_build_object('time',n.created_at,'id',n.id) from public.in_app_notifications n
   where n.user_id=viewer and private.in_app_notification_visible(viewer,n) order by n.created_at desc,n.id desc limit 1));
$$;
create or replace function public.get_notification_summary() returns jsonb
language plpgsql security definer set search_path='' as $$
declare viewer uuid:=private.safety_actor();
begin
 perform private.ensure_daily_in_app_notification(viewer);
 return private.in_app_notification_summary(viewer);
end;$$;

create or replace function public.get_notification_inbox(
 before_time timestamptz default null,before_id uuid default null,page_size integer default 20
) returns jsonb language plpgsql security definer set search_path='' as $$
declare viewer uuid:=private.safety_actor();result jsonb;
begin
 if page_size is null or page_size not between 1 and 24 or (before_time is null)<>(before_id is null)
  or (before_time is not null and not isfinite(before_time)) then raise exception using errcode='22023',message='invalid_inbox_query';end if;
 perform private.ensure_daily_in_app_notification(viewer);
 with page as materialized (
  select n.* from public.in_app_notifications n where n.user_id=viewer and private.in_app_notification_visible(viewer,n)
   and (n.created_at,n.id)<(coalesce(before_time,'infinity'::timestamptz),coalesce(before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
  order by n.created_at desc,n.id desc limit page_size+1
 ),shown as(select * from page order by created_at desc,id desc limit page_size)
 select private.in_app_notification_summary(viewer)||jsonb_build_object(
  'items',coalesce((select jsonb_agg(jsonb_build_object(
   'id',n.id,'kind',n.kind,'created_at',n.created_at,'read_at',n.read_at,
   'profile_id',case when n.kind='NEW_FOLLOWER' then p.public_id end,
   'username',case when n.kind='NEW_FOLLOWER' then p.username end,
   'submission_id',n.submission_id,'assignment_id',s.daily_challenge_word_id,
   'target_term',s.target_term,'challenge_id',n.challenge_id) order by n.created_at desc,n.id desc)
   from shown n left join public.profiles p on p.id=n.actor_user_id and n.kind='NEW_FOLLOWER'
    left join public.submissions s on s.id=n.submission_id),'[]'::jsonb),
  'has_more',(select count(*)>page_size from page)) into result;
 return result;
end;$$;

create or replace function public.set_notification_read(notification_id uuid,"read" boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare viewer uuid:=private.safety_actor();
begin
 if notification_id is null or "read" is null then raise exception using errcode='22023',message='invalid_notification_read';end if;
 update public.in_app_notifications n set read_at=case when "read" then coalesce(n.read_at,greatest(clock_timestamp(),n.created_at)) else null end
 where n.id=notification_id and n.user_id=viewer and private.in_app_notification_visible(viewer,n);
 if not found then raise exception using errcode='42501',message='notification_unavailable';end if;
 return private.in_app_notification_summary(viewer)||jsonb_build_object('ok',true);
end;$$;

create or replace function public.mark_notifications_read(through_time timestamptz,through_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare viewer uuid:=private.safety_actor();
begin
 if through_time is null or not isfinite(through_time) or through_id is null then
  raise exception using errcode='22023',message='invalid_notification_cursor';
 end if;
 -- Lock the existing owner rows in the same deterministic order for competing
 -- mark-all calls. A newer notification outside this response snapshot stays unread.
 perform 1 from public.in_app_notifications n where n.user_id=viewer and n.read_at is null
  and (n.created_at,n.id)<=(through_time,through_id) and private.in_app_notification_visible(viewer,n)
  order by n.id for update;
 update public.in_app_notifications n set read_at=greatest(clock_timestamp(),n.created_at)
 where n.user_id=viewer and n.read_at is null and (n.created_at,n.id)<=(through_time,through_id)
  and private.in_app_notification_visible(viewer,n);
 return private.in_app_notification_summary(viewer)||jsonb_build_object('ok',true);
end;$$;

create or replace function public.resolve_notification_target(notification_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=private.safety_actor();result jsonb;
begin
 select jsonb_build_object('viewer_id',viewer,'kind',n.kind,
  'profile_id',case when n.kind='NEW_FOLLOWER' then p.public_id end,
  'assignment_id',s.daily_challenge_word_id,'challenge_id',n.challenge_id) into result
 from public.in_app_notifications n left join public.profiles p on p.id=n.actor_user_id and n.kind='NEW_FOLLOWER'
 left join public.submissions s on s.id=n.submission_id
 where n.id=notification_id and n.user_id=viewer and private.in_app_notification_visible(viewer,n);
 if result is null then raise exception using errcode='42501',message='notification_unavailable';end if;
 return result;
end;$$;

do $$declare f record;begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='private'::regnamespace
 and proname in('social_profile_projection','preserve_in_app_notification','notify_new_follower','notify_new_rating','notify_daily_words_ready','in_app_notification_visible','ensure_daily_in_app_notification','in_app_notification_summary') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace
 and proname in('get_profile_connections','set_follow','get_notification_summary','get_notification_inbox','set_notification_read','mark_notifications_read','resolve_notification_target') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
end;$$;
commit;
