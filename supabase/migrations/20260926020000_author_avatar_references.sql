begin;
-- QA #23: current avatar references only, evaluated after bounded eligible paging.
-- Preserve Auth, block/moderation, cursors and private Storage/signing authority.
create or replace function public.get_submission_comments(submission_id uuid,before_time timestamptz default null,before_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=private.safety_actor();result jsonb;
begin
 if (before_time is null)<>(before_id is null) or (before_time is not null and not isfinite(before_time)) then raise exception using errcode='22023',message='invalid_comment_query';end if;
 if not private.comment_post_visible(viewer,submission_id) then raise exception using errcode='42501',message='comment_unavailable';end if;
 with page as materialized (
  select c.author_user_id,c.id,c.body,p.username,p.public_id as profile_id,c.created_at,c.author_user_id=viewer as is_own
  from public.submission_comments c join public.profiles p on p.id=c.author_user_id
  where c.submission_id=get_submission_comments.submission_id and c.deleted_at is null and not c.removed
   and private.social_profile_visible(viewer,c.author_user_id)
   and (c.created_at,c.id)<(coalesce(before_time,'infinity'::timestamptz),coalesce(before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
  order by c.created_at desc,c.id desc limit 21
 ),shown as(select * from page order by created_at desc,id desc limit 20)
 select jsonb_build_object('viewer_id',viewer,'items',coalesce((select jsonb_agg((to_jsonb(s)-'author_user_id')||jsonb_build_object('avatar_id',private.current_avatar_id(s.author_user_id)) order by created_at desc,id desc) from shown s),'[]'::jsonb),'has_more',(select count(*)>20 from page)) into result;
 return result;
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
   'avatar_id',case when n.kind='NEW_FOLLOWER' then private.current_avatar_id(p.id) end,
   'submission_id',n.submission_id,'assignment_id',s.daily_challenge_word_id,
   'target_term',s.target_term,'challenge_id',n.challenge_id) order by n.created_at desc,n.id desc)
   from shown n left join public.profiles p on p.id=n.actor_user_id and n.kind='NEW_FOLLOWER'
    left join public.submissions s on s.id=n.submission_id),'[]'::jsonb),
  'has_more',(select count(*)>page_size from page)) into result;
 return result;
end;$$;

commit;
