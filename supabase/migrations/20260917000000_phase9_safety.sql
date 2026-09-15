begin;

-- Safety state is separate from private learning and Auth session installation.
create table if not exists private.safety_accounts (
 user_id uuid primary key references auth.users(id) on delete cascade,
 restricted boolean not null default false, revision bigint not null default 0
);
insert into private.safety_accounts(user_id) select id from auth.users on conflict do nothing;
create or replace function private.initialize_safety_account() returns trigger
language plpgsql security definer set search_path='' as $$
begin insert into private.safety_accounts(user_id) values(new.id); return new; end;$$;
drop trigger if exists initialize_safety_account on auth.users;
create trigger initialize_safety_account after insert on auth.users for each row execute function private.initialize_safety_account();
create table if not exists private.moderators (
 user_id uuid primary key references auth.users(id) on delete cascade,
 provisioned_at timestamptz not null default statement_timestamp(), provisioned_by text not null default current_user
);
create table if not exists private.submission_moderation (
 submission_id uuid primary key references public.submissions(id) on delete cascade,
 removed boolean not null default false
);
create table if not exists public.user_blocks (
 id uuid primary key default gen_random_uuid(),
 blocker_user_id uuid not null references auth.users(id) on delete cascade,
 blocked_user_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default statement_timestamp(),
 unique(blocker_user_id,blocked_user_id), check(blocker_user_id<>blocked_user_id)
);
create index if not exists user_blocks_reverse on public.user_blocks(blocked_user_id,blocker_user_id);
create index if not exists user_blocks_page on public.user_blocks(blocker_user_id,id desc);
create table if not exists public.safety_reports (
 id uuid primary key default gen_random_uuid(), reporter_user_id uuid not null,
 target_kind text not null check(target_kind in ('submission','user')), target_id uuid not null,
 context_submission_id uuid not null, subject_user_id uuid not null,
 username_snapshot text not null, word_snapshot text not null,
 reason text not null check(reason in ('inappropriate','sexual_content','violence','harassment_hate','spam','privacy','other')),
 details text not null default '' check(char_length(details)<=500),
 status text not null default 'open' check(status in ('open','resolved','dismissed')),
 created_at timestamptz not null default statement_timestamp()
);
do $$begin
 if not exists(select 1 from pg_constraint where conrelid='public.safety_reports'::regclass and conname='safety_report_target_identity') then
  alter table public.safety_reports add constraint safety_report_target_identity check(
   reporter_user_id<>subject_user_id and ((target_kind='user' and target_id=subject_user_id) or (target_kind='submission' and target_id=context_submission_id)));
 end if;
end;$$;
-- Durable case identifiers intentionally survive hard account/content deletion.
create unique index if not exists safety_reports_one_open on public.safety_reports(reporter_user_id,target_kind,target_id) where status='open';
create index if not exists safety_reports_queue on public.safety_reports(status,created_at,id);
create table if not exists public.moderation_audit (
 id bigint generated always as identity primary key, moderator_user_id uuid not null,
 request_id uuid not null, report_id uuid not null references public.safety_reports(id),
 action text not null check(action in ('remove_submission','restore_submission','suspend_user','restore_user','resolve_report','dismiss_report')),
 target_kind text not null check(target_kind in ('submission','user','report')), target_id uuid not null,
 reason text not null default '' check(char_length(reason)<=500), created_at timestamptz not null default statement_timestamp(),
 unique(moderator_user_id,request_id)
);
create index if not exists moderation_audit_target on public.moderation_audit(target_kind,target_id,id desc);
create index if not exists moderation_audit_report on public.moderation_audit(report_id,id desc);
create or replace function private.reject_audit_mutation() returns trigger
language plpgsql set search_path='' as $$begin raise exception using errcode='42501',message='immutable_moderation_audit';end;$$;
drop trigger if exists immutable_moderation_audit on public.moderation_audit;
create trigger immutable_moderation_audit before update or delete on public.moderation_audit for each row execute function private.reject_audit_mutation();

create or replace function private.safety_actor() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
 if not exists(select 1 from auth.users u join public.profiles p on p.id=u.id where u.id=actor and u.deleted_at is null and (u.banned_until is null or u.banned_until<=statement_timestamp()) and p.onboarding_completed_at is not null) then
 raise exception using errcode='42501',message='safety_unavailable';end if;
 return actor;
end;$$;
create or replace function private.is_moderator(viewer uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.moderators m join auth.users u on u.id=m.user_id join private.safety_accounts a on a.user_id=m.user_id
 where m.user_id=viewer and not a.restricted and u.deleted_at is null and (u.banned_until is null or u.banned_until<=statement_timestamp()));$$;
create or replace function private.require_moderator() returns uuid
language plpgsql stable security definer set search_path='' as $$
begin if not private.is_moderator(auth.uid()) then raise exception using errcode='42501',message='moderation_unavailable';end if;return auth.uid();end;$$;
create or replace function private.lock_safety_pair(first_user uuid,second_user uuid) returns void
language plpgsql security definer set search_path='' as $$
declare who uuid;
begin
 for who in select user_id from private.safety_accounts where user_id in(first_user,second_user) order by user_id loop
  -- A real revision write also makes old REPEATABLE READ transactions abort.
  update private.safety_accounts set revision=revision+1 where user_id=who;
 end loop;
end;$$;
create or replace function private.users_blocked(first_user uuid,second_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.user_blocks where blocker_user_id=first_user and blocked_user_id=second_user)
 or exists(select 1 from public.user_blocks where blocker_user_id=second_user and blocked_user_id=first_user);$$;

create or replace view private.discover_candidates as
 select s.id,s.storage_path,s.target_term,s.reference_term,w.cefr_level,w.target_language_id,p.username,s.submitted_at,s.user_id as owner_id
 from public.submissions s join public.daily_challenge_words w on w.id=s.daily_challenge_word_id
 join public.profiles p on p.id=s.user_id and p.username is not null and p.onboarding_completed_at is not null
 join auth.users u on u.id=p.id and u.deleted_at is null and (u.banned_until is null or u.banned_until<=statement_timestamp())
 join private.safety_accounts a on a.user_id=s.user_id and not a.restricted
 join private.photo_verifications v on v.submission_id=s.id
 join storage.objects o on o.id=v.object_id and o.version=v.object_version and o.bucket_id='challenge-submissions' and o.name=s.storage_path
 where s.status='completed' and s.visibility='public' and w.replaced_at is null
 and not exists(select 1 from private.submission_moderation m where m.submission_id=s.id and m.removed);
create or replace function private.discover_target(viewer uuid) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare target uuid;
begin
 select l.target_language_id into target from public.user_language_profiles l join public.profiles p on p.id=l.user_id and p.onboarding_completed_at is not null
 join auth.users u on u.id=p.id and u.deleted_at is null and (u.banned_until is null or u.banned_until<=statement_timestamp())
 join private.safety_accounts a on a.user_id=u.id and not a.restricted where l.user_id=viewer;
 if target is null then raise exception using errcode='42501',message='feed_unavailable';end if;return target;
end;$$;

-- Preserve the audited implementations and add publication admission before their
-- profile/assignment/submission locks. Private learning operations remain available.
do $$begin
 if to_regprocedure('private.finalize_submission(uuid,text)') is null then alter function public.finalize_submission(uuid,text) set schema private;end if;
 if to_regprocedure('private.set_submission_visibility(uuid,text)') is null then alter function public.set_submission_visibility(uuid,text) set schema private;end if;
end;$$;
create or replace function public.finalize_submission(submission_id uuid,requested_visibility text default 'private') returns public.submissions
language plpgsql security definer set search_path='' as $$
begin
 perform private.lock_safety_pair(auth.uid(),auth.uid());
 if requested_visibility='public' then perform private.discover_target(auth.uid());end if;
 return private.finalize_submission(submission_id,requested_visibility);
end;$$;
create or replace function public.set_submission_visibility(submission_id uuid,requested_visibility text) returns public.submissions
language plpgsql security definer set search_path='' as $$
begin
 perform private.lock_safety_pair(auth.uid(),auth.uid());
 if requested_visibility='public' then perform private.discover_target(auth.uid());end if;
 return private.set_submission_visibility(submission_id,requested_visibility);
end;$$;

create or replace function public.get_safety_access() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=private.safety_actor();
begin return jsonb_build_object('viewer_id',viewer,'moderator',private.is_moderator(viewer),'restricted',(select restricted from private.safety_accounts where user_id=viewer));end;$$;
create or replace function public.block_submission_user(submission_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare viewer uuid:=private.safety_actor();owner_id uuid;target uuid;
begin
 select user_id into owner_id from public.submissions where id=submission_id;
 if owner_id is null or owner_id=viewer then raise exception using errcode='42501',message='safety_unavailable';end if;
 perform private.lock_safety_pair(viewer,owner_id);
 -- Same-state retries succeed after blocking makes the original card unavailable.
 if exists(select 1 from public.user_blocks where blocker_user_id=viewer and blocked_user_id=owner_id) then return jsonb_build_object('viewer_id',viewer,'ok',true);end if;
 target:=private.discover_target(viewer);
 if not exists(select 1 from private.discover_candidates c where c.id=submission_id and c.target_language_id=target and not private.users_blocked(viewer,c.owner_id)) then raise exception using errcode='42501',message='safety_unavailable';end if;
 insert into public.user_blocks(blocker_user_id,blocked_user_id) values(viewer,owner_id) on conflict do nothing;
 return jsonb_build_object('viewer_id',viewer,'ok',true);
end;$$;
create or replace function public.unblock_user(block_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare viewer uuid:=private.safety_actor();owner_id uuid;
begin
 select blocked_user_id into owner_id from public.user_blocks where id=block_id and blocker_user_id=viewer;
 if owner_id is not null then
 perform private.lock_safety_pair(viewer,owner_id);
 delete from public.user_blocks where id=block_id and blocker_user_id=viewer;
 end if;
 return jsonb_build_object('viewer_id',viewer,'ok',true);
end;$$;
create or replace function public.get_blocked_users(before_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=private.safety_actor();result jsonb;
begin
 with page as materialized (select b.id,p.username from public.user_blocks b join public.profiles p on p.id=b.blocked_user_id where b.blocker_user_id=viewer and b.id<coalesce(before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid) order by b.id desc limit 21),shown as (select * from page order by id desc limit 20)
 select jsonb_build_object('viewer_id',viewer,'items',coalesce((select jsonb_agg(to_jsonb(s) order by id desc) from shown s),'[]'::jsonb),'has_more',(select count(*)>20 from page)) into result;return result;
end;$$;
create or replace function public.report_public_content(submission_id uuid,target_kind text,reason text,details text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare viewer uuid:=private.safety_actor();owner_id uuid;target uuid;content record;
begin
 if target_kind is null or target_kind not in('submission','user') or reason is null or reason not in('inappropriate','sexual_content','violence','harassment_hate','spam','privacy','other') or details is null or char_length(details)>500 then raise exception using errcode='22023',message='invalid_report';end if;
 select user_id into owner_id from public.submissions where id=submission_id;
 if owner_id is null or owner_id=viewer then raise exception using errcode='42501',message='safety_unavailable';end if;
 perform private.lock_safety_pair(viewer,owner_id);target:=private.discover_target(viewer);
 select * into content from private.discover_candidates c where c.id=submission_id and c.target_language_id=target and not private.users_blocked(viewer,c.owner_id);
 if not found then raise exception using errcode='42501',message='safety_unavailable';end if;
 insert into public.safety_reports(reporter_user_id,target_kind,target_id,context_submission_id,subject_user_id,username_snapshot,word_snapshot,reason,details)
 values(viewer,target_kind,case when target_kind='user' then owner_id else submission_id end,submission_id,owner_id,content.username,content.target_term,reason,trim(details)) on conflict do nothing;
 return jsonb_build_object('viewer_id',viewer,'ok',true);
end;$$;

create or replace function public.get_moderation_queue(after_time timestamptz default null,after_id uuid default null,report_status text default 'open') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=private.require_moderator();result jsonb;
begin
 if report_status is null or report_status not in('open','resolved','dismissed') or (after_time is null)<>(after_id is null) or (after_time is not null and not isfinite(after_time)) then raise exception using errcode='22023',message='invalid_queue';end if;
 with page as materialized (select id,target_kind,username_snapshot,word_snapshot,reason,details,status,created_at from public.safety_reports where status=report_status and (created_at,id)>(coalesce(after_time,'-infinity'::timestamptz),coalesce(after_id,'00000000-0000-0000-0000-000000000000'::uuid)) order by created_at,id limit 21),shown as (select * from page order by created_at,id limit 20)
 select jsonb_build_object('viewer_id',viewer,'items',coalesce((select jsonb_agg(to_jsonb(s) order by created_at,id) from shown s),'[]'::jsonb),'has_more',(select count(*)>20 from page)) into result;return result;
end;$$;
create or replace function public.get_moderation_report(report_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=private.require_moderator();r public.safety_reports;
begin
 select * into r from public.safety_reports where id=report_id;
 if not found then raise exception using errcode='42501',message='moderation_unavailable';end if;
 return jsonb_build_object('viewer_id',viewer,'report',to_jsonb(r)-'reporter_user_id',
 'submission_exists',exists(select 1 from public.submissions where id=r.context_submission_id and status='completed'),
 'user_exists',exists(select 1 from auth.users where id=r.subject_user_id and deleted_at is null),
 'removed',coalesce((select removed from private.submission_moderation where submission_id=r.context_submission_id),false),
 'restricted',coalesce((select restricted from private.safety_accounts where user_id=r.subject_user_id),false),
 'audit',coalesce((select jsonb_agg(to_jsonb(e) order by id desc) from(select * from public.moderation_audit where moderation_audit.report_id=r.id or (target_kind='user' and target_id=r.subject_user_id) or (target_kind='submission' and target_id=r.context_submission_id) order by id desc limit 20)e),'[]'::jsonb));
end;$$;
create or replace function public.moderate_report(report_id uuid,action text,request_id uuid,reason text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare viewer uuid:=private.require_moderator();r public.safety_reports;previous public.moderation_audit;kind text;target uuid;
begin
 if action is null or action not in('remove_submission','restore_submission','suspend_user','restore_user','resolve_report','dismiss_report') or request_id is null or reason is null or char_length(reason)>500 then raise exception using errcode='22023',message='invalid_moderation_action';end if;
 -- Lock the role for this write, so operational revocation waits for admission.
 perform 1 from private.moderators where user_id=viewer for share;
 if not found then raise exception using errcode='42501',message='moderation_unavailable';end if;
 select * into r from public.safety_reports where id=report_id;
 if not found then raise exception using errcode='42501',message='moderation_unavailable';end if;
 perform private.lock_safety_pair(viewer,r.subject_user_id);
 perform private.require_moderator();
 -- Serialize moderator retries, including requests for different target accounts.
 perform pg_advisory_xact_lock(hashtextextended(viewer::text||request_id::text,910));
 select * into previous from public.moderation_audit e where e.moderator_user_id=viewer and e.request_id=moderate_report.request_id;
 if found then
 if previous.report_id<>report_id or previous.action<>action or previous.reason<>reason then raise exception using errcode='22023',message='request_identity_conflict';end if;
 return jsonb_build_object('viewer_id',viewer,'ok',true);end if;
 select * into r from public.safety_reports where id=report_id for update;
 if action in('remove_submission','restore_submission') then
  kind:='submission';target:=r.context_submission_id;
  perform 1 from public.submissions where id=target and status='completed' for update;
  if not found then raise exception using errcode='42501',message='moderation_unavailable';end if;
  insert into private.submission_moderation(submission_id,removed) values(target,action='remove_submission') on conflict(submission_id) do update set removed=excluded.removed;
 elsif action in('suspend_user','restore_user') then
  kind:='user';target:=r.subject_user_id;
  update private.safety_accounts set restricted=(action='suspend_user') where user_id=target;
  if not found then raise exception using errcode='42501',message='moderation_unavailable';end if;
 else
  kind:='report';target:=r.id;
  update public.safety_reports set status=case when action='resolve_report' then 'resolved' else 'dismissed' end where id=r.id;
 end if;
 insert into public.moderation_audit(moderator_user_id,request_id,report_id,action,target_kind,target_id,reason) values(viewer,request_id,r.id,action,kind,target,reason);
 return jsonb_build_object('viewer_id',viewer,'ok',true);
end;$$;
-- A moderator can inspect only the verified image attached to an existing report.
-- The service supplies a verified viewer, not a caller-selected path or lifetime.
create or replace function public.get_moderation_photo_target(viewer uuid,report_id uuid)
returns table(id uuid,storage_path text) language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_moderator(viewer) then raise exception using errcode='42501',message='moderation_unavailable';end if;
 return query select s.id,s.storage_path from public.safety_reports r join public.submissions s on s.id=r.context_submission_id and s.status='completed'
 join private.photo_verifications v on v.submission_id=s.id join storage.objects o on o.id=v.object_id and o.version=v.object_version and o.name=s.storage_path and o.bucket_id='challenge-submissions' where r.id=report_id;
end;$$;

create or replace function private.prepare_submission_rating() returns trigger
language plpgsql security definer set search_path='' as $$
declare owner_id uuid;target uuid;
begin
 if tg_op='UPDATE' and (new.submission_id,new.rater_user_id) is distinct from (old.submission_id,old.rater_user_id) then
  raise exception using errcode='23514',message='immutable_rating_identity';
 end if;
 -- Same row lock as visibility/deletion; eligibility is read again after waiting.
 select user_id into owner_id from public.submissions where id=new.submission_id;
 perform private.lock_safety_pair(new.rater_user_id,owner_id);
 perform 1 from public.submissions where id=new.submission_id for update;
 if owner_id is null or owner_id=new.rater_user_id then raise exception using errcode='42501',message='rating_unavailable';end if;
 target:=private.discover_target(new.rater_user_id);
 if not exists(select 1 from private.discover_candidates c where c.id=new.submission_id and c.target_language_id=target and not private.users_blocked(new.rater_user_id,c.owner_id)) then
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


create or replace function public.get_discover_feed(
 before_time timestamptz default null,before_id uuid default null,page_size integer default 12
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare target uuid;result jsonb;
begin
 target:=private.discover_target(auth.uid());
 if page_size is null or page_size not between 1 and 24 or (before_time is null)<>(before_id is null)
   or (before_time is not null and not isfinite(before_time)) then raise exception using errcode='22023',message='invalid_feed_query';end if;
 with page as materialized (
  select id,target_term,reference_term,cefr_level,username,submitted_at from private.discover_candidates where target_language_id=target and not private.users_blocked(auth.uid(),owner_id)
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
  select c.* from private.discover_candidates c where c.id=any(submission_ids) and c.target_language_id=target and not private.users_blocked(viewer,c.owner_id)
 ),stats as (select * from private.discover_rating_stats(viewer,coalesce((select array_agg(e.id) from eligible e),array[]::uuid[])))
 select e.id,e.storage_path,e.target_term,e.reference_term,e.cefr_level,e.username,e.submitted_at,
  t.average_rating,t.rating_count,t.viewer_rating,t.can_rate
 from eligible e join stats t using(id) order by e.submitted_at desc,e.id desc;
end;$$;
revoke all on function public.get_discover_photo_targets(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.get_discover_photo_targets(uuid,uuid,uuid[]) to service_role;

create or replace function public.get_moderation_history(report_id uuid,before_id bigint default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=private.require_moderator();r public.safety_reports;result jsonb;
begin
 select * into r from public.safety_reports where id=report_id;
 if not found then raise exception using errcode='42501',message='moderation_unavailable';end if;
 if before_id is not null and before_id<=0 then raise exception using errcode='22023',message='invalid_history_cursor';end if;
 with page as materialized (select e.id,e.action,e.reason,e.created_at,e.moderator_user_id,e.target_kind,e.target_id from public.moderation_audit e where e.id<coalesce(before_id,9223372036854775807::bigint) and (e.report_id=r.id or (e.target_kind='user' and e.target_id=r.subject_user_id) or (e.target_kind='submission' and e.target_id=r.context_submission_id)) order by e.id desc limit 21),shown as(select * from page order by id desc limit 20)
 select jsonb_build_object('viewer_id',viewer,'items',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('id',s.id::text) order by id desc) from shown s),'[]'::jsonb),'has_more',(select count(*)>20 from page)) into result;return result;
end;$$;

-- Safety sources are accessible only through the controlled operations.
do $$declare t text; f record; begin
 foreach t in array array['user_blocks','safety_reports','moderation_audit'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 end loop;
 foreach t in array array['safety_accounts','moderators','submission_moderation'] loop
 execute format('alter table private.%I enable row level security',t);
 execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 end loop;
 for f in select oid::regprocedure signature from pg_proc where pronamespace='private'::regnamespace and proname in('initialize_safety_account','reject_audit_mutation','safety_actor','is_moderator','require_moderator','lock_safety_pair','users_blocked','finalize_submission','set_submission_visibility') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in('finalize_submission','set_submission_visibility','get_safety_access','block_submission_user','unblock_user','get_blocked_users','report_public_content','get_moderation_queue','get_moderation_report','get_moderation_history','moderate_report') loop
 execute format('revoke all on function %s from public,anon,service_role',f.signature);
 execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
end;$$;
revoke all on function public.get_moderation_photo_target(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_moderation_photo_target(uuid,uuid) to service_role;
commit;
