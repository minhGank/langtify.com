begin;
create index if not exists submissions_discover_newest on public.submissions(submitted_at desc,id desc)
  include(daily_challenge_word_id,user_id) where status='completed' and visibility='public';
create index if not exists challenge_words_discover_language on public.daily_challenge_words(target_language_id,id);

create or replace view private.discover_candidates as
 select s.id,s.storage_path,s.target_term,s.reference_term,w.cefr_level,w.target_language_id,
   p.username,s.submitted_at
 from public.submissions s
 join public.daily_challenge_words w on w.id=s.daily_challenge_word_id
 join public.profiles p on p.id=s.user_id and p.username is not null and p.onboarding_completed_at is not null
 join auth.users u on u.id=p.id and u.deleted_at is null and (u.banned_until is null or u.banned_until<=statement_timestamp())
 join private.photo_verifications v on v.submission_id=s.id
 join storage.objects o on o.id=v.object_id and o.version=v.object_version
   and o.bucket_id='challenge-submissions' and o.name=s.storage_path
 where s.status='completed' and s.visibility='public' and w.replaced_at is null;
revoke all on private.discover_candidates from public,anon,authenticated;

create or replace function private.discover_target(viewer uuid) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare target uuid;
begin
 select l.target_language_id into target from public.user_language_profiles l
 join public.profiles p on p.id=l.user_id and p.onboarding_completed_at is not null
 join auth.users u on u.id=p.id and u.deleted_at is null and (u.banned_until is null or u.banned_until<=statement_timestamp())
 where l.user_id=viewer;
 if target is null then raise exception using errcode='42501',message='feed_unavailable'; end if;
 return target;
end;$$;
revoke all on function private.discover_target(uuid) from public,anon,authenticated;

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
    and (before_time is null or (submitted_at,id)<(before_time,before_id))
   order by submitted_at desc,id desc limit page_size+1
 ), shown as (select * from page order by submitted_at desc,id desc limit page_size)
 select jsonb_build_object('viewer_id',auth.uid(),'target_language_id',target,
   'items',coalesce((select jsonb_agg(to_jsonb(s) order by submitted_at desc,id desc) from shown s),'[]'::jsonb),
   'has_more',(select count(*)>page_size from page)) into result;
 return result;
end;$$;
revoke all on function public.get_discover_feed(timestamptz,uuid,integer) from public,anon;
grant execute on function public.get_discover_feed(timestamptz,uuid,integer) to authenticated;

-- Service only: viewer comes from the function's Auth.getUser verification.
create or replace function public.get_discover_photo_targets(viewer uuid,expected_target uuid,submission_ids uuid[])
returns table(id uuid,storage_path text,target_term text,reference_term text,cefr_level text,username text,submitted_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare target uuid;
begin
 target:=private.discover_target(viewer);
 if expected_target is distinct from target then
   raise exception using errcode='42501',message='feed_settings_changed';
 end if;
 if submission_ids is null or cardinality(submission_ids) not between 1 and 24
   or exists(select 1 from unnest(submission_ids) s where s is null)
   or (select count(distinct s) from unnest(submission_ids) s)<>cardinality(submission_ids) then
   raise exception using errcode='22023',message='invalid_feed_query';
 end if;
 return query select c.id,c.storage_path,c.target_term,c.reference_term,c.cefr_level,c.username,c.submitted_at
   from private.discover_candidates c where c.id=any(submission_ids) and c.target_language_id=target
   order by c.submitted_at desc,c.id desc;
end;$$;
revoke all on function public.get_discover_photo_targets(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.get_discover_photo_targets(uuid,uuid,uuid[]) to service_role;
commit;
