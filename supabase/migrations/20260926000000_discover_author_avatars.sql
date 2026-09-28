-- QA #20: an opaque current-avatar ID only, resolved after the bounded feed page.
-- No new grants, raw profile reads, Storage policies or eligibility changes.
begin;

create or replace function public.get_discover_feed(
 before_time timestamptz default null,before_id uuid default null,page_size integer default 12
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare target uuid;result jsonb;
begin
 target:=private.discover_target(auth.uid());
 if page_size is null or page_size not between 1 and 24 or (before_time is null)<>(before_id is null)
   or (before_time is not null and not isfinite(before_time)) then raise exception using errcode='22023',message='invalid_feed_query';end if;
 with page as materialized (
  select id,target_term,reference_term,cefr_level,username,submitted_at,owner_id from private.discover_candidates where target_language_id=target and not private.users_blocked(auth.uid(),owner_id)
   and (submitted_at,id)<(coalesce(before_time,'infinity'::timestamptz),coalesce(before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
  order by submitted_at desc,id desc limit page_size+1
 ),shown as materialized (select * from page order by submitted_at desc,id desc limit page_size),
 stats as (select * from private.discover_rating_stats(auth.uid(),coalesce((select array_agg(id) from shown),array[]::uuid[])))
 select jsonb_build_object('viewer_id',auth.uid(),'target_language_id',target,
  'items',coalesce((select jsonb_agg((to_jsonb(s)-'owner_id')||jsonb_build_object('avatar_id',private.current_avatar_id(s.owner_id),'average_rating',t.average_rating,'rating_count',t.rating_count,'viewer_rating',t.viewer_rating,'can_rate',t.can_rate) order by s.submitted_at desc,s.id desc) from shown s join stats t using(id)),'[]'::jsonb),
  'has_more',(select count(*)>page_size from page)) into result;
 return result;
end;$$;
revoke all on function public.get_discover_feed(timestamptz,uuid,integer) from public,anon;
grant execute on function public.get_discover_feed(timestamptz,uuid,integer) to authenticated;

-- Return-type extension requires transactional replacement; restore service-only grants.
drop function if exists public.get_discover_photo_targets(uuid,uuid,uuid[]);
create function public.get_discover_photo_targets(viewer uuid,expected_target uuid,submission_ids uuid[])
returns table(id uuid,storage_path text,target_term text,reference_term text,cefr_level text,username text,submitted_at timestamptz,
 average_rating numeric,rating_count bigint,viewer_rating smallint,can_rate boolean,avatar_id uuid)
language plpgsql stable security definer set search_path='' as $$
declare target uuid;
begin
 target:=private.discover_target(viewer);
 if expected_target is distinct from target then raise exception using errcode='42501',message='feed_settings_changed';end if;
 if submission_ids is null or cardinality(submission_ids) not between 1 and 24
   or exists(select 1 from unnest(submission_ids) s where s is null)
   or (select count(distinct s) from unnest(submission_ids) s)<>cardinality(submission_ids) then raise exception using errcode='22023',message='invalid_feed_query';end if;
 return query with eligible as materialized (
  select c.* from private.discover_candidates c where c.id=any(submission_ids) and c.target_language_id=target and not private.users_blocked(viewer,c.owner_id)
 ),stats as (select * from private.discover_rating_stats(viewer,coalesce((select array_agg(e.id) from eligible e),array[]::uuid[])))
 select e.id,e.storage_path,e.target_term,e.reference_term,e.cefr_level,e.username,e.submitted_at,
  t.average_rating,t.rating_count,t.viewer_rating,t.can_rate,private.current_avatar_id(e.owner_id)
 from eligible e join stats t using(id) order by e.submitted_at desc,e.id desc;
end;$$;
revoke all on function public.get_discover_photo_targets(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.get_discover_photo_targets(uuid,uuid,uuid[]) to service_role;

create or replace function public.get_discover_submission(submission_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=private.safety_actor();target uuid;result jsonb;
begin
 target:=private.discover_target(viewer);
 if submission_id is null then raise exception using errcode='22023',message='invalid_feed_query';end if;
 with shown as materialized (
  select c.id,c.target_term,c.reference_term,c.cefr_level,c.username,c.submitted_at,c.owner_id
  from private.discover_candidates c where c.id=submission_id and c.target_language_id=target
   and not private.users_blocked(viewer,c.owner_id)
 ),stats as(select * from private.discover_rating_stats(viewer,coalesce((select array_agg(id) from shown),array[]::uuid[])))
 select jsonb_build_object('viewer_id',viewer,'target_language_id',target,
  'items',coalesce((select jsonb_agg((to_jsonb(s)-'owner_id')||jsonb_build_object('avatar_id',private.current_avatar_id(s.owner_id),
   'average_rating',t.average_rating,'rating_count',t.rating_count,'viewer_rating',t.viewer_rating,'can_rate',t.can_rate))
   from shown s join stats t using(id)),'[]'::jsonb),'has_more',false) into result;
 return result;
end;$$;

revoke all on function public.get_discover_submission(uuid) from public,anon;
grant execute on function public.get_discover_submission(uuid) to authenticated;

commit;
