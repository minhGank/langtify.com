begin;
create table if not exists public.submission_ratings (
 submission_id uuid not null references public.submissions(id) on delete cascade,
 rater_user_id uuid not null references auth.users(id) on delete cascade,
 score smallint not null check(score between 1 and 5),
 created_at timestamptz not null default statement_timestamp(),
 updated_at timestamptz not null default statement_timestamp(),
 primary key(submission_id,rater_user_id),check(updated_at>=created_at)
);
create index if not exists submission_ratings_rater on public.submission_ratings(rater_user_id);
alter table public.submission_ratings enable row level security;
revoke all on public.submission_ratings from public,anon,authenticated;
grant all on public.submission_ratings to service_role;

create or replace function private.prepare_submission_rating() returns trigger
language plpgsql security definer set search_path='' as $$
declare owner_id uuid;target uuid;
begin
 if tg_op='UPDATE' and (new.submission_id,new.rater_user_id) is distinct from (old.submission_id,old.rater_user_id) then
  raise exception using errcode='23514',message='immutable_rating_identity';
 end if;
 -- Same row lock as visibility/deletion; eligibility is read again after waiting.
 select user_id into owner_id from public.submissions where id=new.submission_id for update;
 if owner_id is null or owner_id=new.rater_user_id then raise exception using errcode='42501',message='rating_unavailable';end if;
 target:=private.discover_target(new.rater_user_id);
 if not exists(select 1 from private.discover_candidates where id=new.submission_id and target_language_id=target) then
  raise exception using errcode='42501',message='rating_unavailable';
 end if;
 if tg_op='INSERT' then new.created_at:=statement_timestamp();new.updated_at:=new.created_at;
 else
  new.created_at:=old.created_at;
  new.updated_at:=case when new.score is distinct from old.score then greatest(clock_timestamp(),old.updated_at) else old.updated_at end;
 end if;
 return new;
end;$$;
revoke all on function private.prepare_submission_rating() from public,anon,authenticated;
drop trigger if exists prepare_submission_rating on public.submission_ratings;
create trigger prepare_submission_rating before insert or update on public.submission_ratings
 for each row execute function private.prepare_submission_rating();

-- Compute one grouped aggregate restricted to the bounded page/window IDs.
create or replace function private.discover_rating_stats(viewer uuid,ids uuid[])
returns table(id uuid,average_rating numeric,rating_count bigint,viewer_rating smallint,can_rate boolean)
language plpgsql stable security definer set search_path='' as $$
begin
 if ids is null or cardinality(ids)>24 then raise exception using errcode='22023',message='invalid_rating_batch';end if;
 return query with totals as (
  select r.submission_id,avg(r.score) average,count(*) n,max(r.score) filter(where r.rater_user_id=viewer) own
  from public.submission_ratings r where r.submission_id=any(ids) group by r.submission_id
 ) select s.id,t.average,coalesce(t.n,0),t.own,s.user_id<>viewer
 from public.submissions s left join totals t on t.submission_id=s.id where s.id=any(ids);
end;$$;
revoke all on function private.discover_rating_stats(uuid,uuid[]) from public,anon,authenticated;

create or replace function public.rate_submission(submission_id uuid,score numeric) returns jsonb
language plpgsql security definer set search_path='' as $$
declare viewer uuid:=auth.uid();target uuid;result jsonb;
begin
 if viewer is null then raise exception using errcode='42501',message='rating_unavailable';end if;
 if score is null or score not between 1 and 5 or score<>trunc(score) then raise exception using errcode='22023',message='invalid_rating_score';end if;
 target:=private.discover_target(viewer);
 insert into public.submission_ratings as r(submission_id,rater_user_id,score)
 values(rate_submission.submission_id,viewer,rate_submission.score::smallint)
 on conflict on constraint submission_ratings_pkey do update set score=excluded.score;
 select jsonb_build_object('viewer_id',viewer,'target_language_id',target,'item',to_jsonb(t)) into result
 from private.discover_rating_stats(viewer,array[submission_id]) t;
 return result;
end;$$;
revoke all on function public.rate_submission(uuid,numeric) from public,anon;
grant execute on function public.rate_submission(uuid,numeric) to authenticated;

create or replace function public.get_discover_feed(
 before_time timestamptz default null,before_id uuid default null,page_size integer default 12
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare target uuid;result jsonb;
begin
 target:=private.discover_target(auth.uid());
 if page_size is null or page_size not between 1 and 24 or (before_time is null)<>(before_id is null)
   or (before_time is not null and not isfinite(before_time)) then raise exception using errcode='22023',message='invalid_feed_query';end if;
 with page as materialized (
  select id,target_term,reference_term,cefr_level,username,submitted_at from private.discover_candidates where target_language_id=target
   and (submitted_at,id)<(coalesce(before_time,'infinity'::timestamptz),coalesce(before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
  order by submitted_at desc,id desc limit page_size+1
 ),shown as materialized (select * from page order by submitted_at desc,id desc limit page_size),
 stats as (select * from private.discover_rating_stats(auth.uid(),coalesce((select array_agg(id) from shown),array[]::uuid[])))
 select jsonb_build_object('viewer_id',auth.uid(),'target_language_id',target,
  'items',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('average_rating',t.average_rating,'rating_count',t.rating_count,'viewer_rating',t.viewer_rating,'can_rate',t.can_rate) order by s.submitted_at desc,s.id desc) from shown s join stats t using(id)),'[]'::jsonb),
  'has_more',(select count(*)>page_size from page)) into result;
 return result;
end;$$;
revoke all on function public.get_discover_feed(timestamptz,uuid,integer) from public,anon;
grant execute on function public.get_discover_feed(timestamptz,uuid,integer) to authenticated;

-- Add public aggregates and viewer-specific fields to the service-only projection.
drop function if exists public.get_discover_photo_targets(uuid,uuid,uuid[]);
create function public.get_discover_photo_targets(viewer uuid,expected_target uuid,submission_ids uuid[])
returns table(id uuid,storage_path text,target_term text,reference_term text,cefr_level text,username text,submitted_at timestamptz,
 average_rating numeric,rating_count bigint,viewer_rating smallint,can_rate boolean)
language plpgsql stable security definer set search_path='' as $$
declare target uuid;
begin
 target:=private.discover_target(viewer);
 if expected_target is distinct from target then raise exception using errcode='42501',message='feed_settings_changed';end if;
 if submission_ids is null or cardinality(submission_ids) not between 1 and 24
   or exists(select 1 from unnest(submission_ids) s where s is null)
   or (select count(distinct s) from unnest(submission_ids) s)<>cardinality(submission_ids) then raise exception using errcode='22023',message='invalid_feed_query';end if;
 return query with eligible as materialized (
  select c.* from private.discover_candidates c where c.id=any(submission_ids) and c.target_language_id=target
 ),stats as (select * from private.discover_rating_stats(viewer,coalesce((select array_agg(e.id) from eligible e),array[]::uuid[])))
 select e.id,e.storage_path,e.target_term,e.reference_term,e.cefr_level,e.username,e.submitted_at,
  t.average_rating,t.rating_count,t.viewer_rating,t.can_rate
 from eligible e join stats t using(id) order by e.submitted_at desc,e.id desc;
end;$$;
revoke all on function public.get_discover_photo_targets(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.get_discover_photo_targets(uuid,uuid,uuid[]) to service_role;
commit;
