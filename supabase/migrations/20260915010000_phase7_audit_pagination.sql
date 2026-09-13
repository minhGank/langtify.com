begin;
-- Keep cursor bounds indexable even when PL/pgSQL switches to a generic plan.
-- Callers still cannot submit infinity or a partial cursor. Only the internal
-- first-page sentinel uses infinity; finalized submission times are server-owned.
create or replace function public.get_discover_feed(
 before_time timestamptz default null,before_id uuid default null,page_size integer default 12
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare target uuid;result jsonb;
begin
 target:=private.discover_target(auth.uid());
 if page_size is null or page_size not between 1 and 24 or (before_time is null)<>(before_id is null)
   or (before_time is not null and not isfinite(before_time)) then
   raise exception using errcode='22023',message='invalid_feed_query';
 end if;
 with page as materialized (
   select id,target_term,reference_term,cefr_level,username,submitted_at
   from private.discover_candidates where target_language_id=target
    and (submitted_at,id)<(coalesce(before_time,'infinity'::timestamptz),
      coalesce(before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
   order by submitted_at desc,id desc limit page_size+1
 ), shown as (select * from page order by submitted_at desc,id desc limit page_size)
 select jsonb_build_object('viewer_id',auth.uid(),'target_language_id',target,
   'items',coalesce((select jsonb_agg(to_jsonb(s) order by submitted_at desc,id desc) from shown s),'[]'::jsonb),
   'has_more',(select count(*)>page_size from page)) into result;
 return result;
end;$$;
revoke all on function public.get_discover_feed(timestamptz,uuid,integer) from public,anon;
grant execute on function public.get_discover_feed(timestamptz,uuid,integer) to authenticated;

commit;
