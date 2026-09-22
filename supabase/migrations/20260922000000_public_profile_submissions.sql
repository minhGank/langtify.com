-- Public profiles use the same saved-target, verified-photo projection as Discover.
-- The opaque public profile ID narrows the result; it never grants owner access.
begin;

create index if not exists submissions_public_profile_newest
 on public.submissions(user_id,submitted_at desc,id desc)
 where status='completed' and visibility='public';

create or replace function public.get_public_profile_submissions(
 profile_id uuid,before_time timestamptz default null,before_id uuid default null,page_size integer default 12
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=private.safety_actor();subject uuid;target uuid;result jsonb;
begin
 target:=private.discover_target(viewer);
 if profile_id is null or page_size is null or page_size not between 1 and 24
  or (before_time is null)<>(before_id is null)
  or (before_time is not null and not isfinite(before_time)) then
  raise exception using errcode='22023',message='invalid_profile_feed_query';
 end if;
 select p.id into subject from public.profiles p where p.public_id=profile_id;
 if not private.social_profile_visible(viewer,subject) then
  raise exception using errcode='42501',message='profile_unavailable';
 end if;
 with page as materialized (
  select c.id,c.target_term,c.reference_term,c.cefr_level,c.username,c.submitted_at
  from private.discover_candidates c
  where c.owner_id=subject and c.target_language_id=target
   and (c.submitted_at,c.id)<(coalesce(before_time,'infinity'::timestamptz),coalesce(before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
  order by c.submitted_at desc,c.id desc limit page_size+1
 ),shown as materialized (select * from page order by submitted_at desc,id desc limit page_size),
 stats as (select * from private.discover_rating_stats(viewer,coalesce((select array_agg(id) from shown),array[]::uuid[])))
 select jsonb_build_object('viewer_id',viewer,'target_language_id',target,'profile_id',profile_id,
  'items',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object(
   'average_rating',t.average_rating,'rating_count',t.rating_count,'viewer_rating',t.viewer_rating,'can_rate',t.can_rate)
   order by s.submitted_at desc,s.id desc) from shown s join stats t using(id)),'[]'::jsonb),
  'has_more',(select count(*)>page_size from page)) into result;
 return result;
end;$$;
revoke all on function public.get_public_profile_submissions(uuid,timestamptz,uuid,integer) from public,anon;
grant execute on function public.get_public_profile_submissions(uuid,timestamptz,uuid,integer) to authenticated;

commit;
