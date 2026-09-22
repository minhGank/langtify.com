begin;

-- Public identity is intentionally distinct from the Auth/ownership identifier.
alter table public.profiles add column if not exists public_id uuid not null default gen_random_uuid();
create unique index if not exists profiles_public_id_unique on public.profiles(public_id);
create index if not exists profiles_username_search on public.profiles(username collate "C", public_id)
 where username is not null and onboarding_completed_at is not null;
create or replace function private.preserve_public_profile_id() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.public_id is distinct from old.public_id then raise exception using errcode='23514',message='immutable_public_profile_id';end if;
 return new;
end;$$;
drop trigger if exists preserve_public_profile_id on public.profiles;
create trigger preserve_public_profile_id before update of public_id on public.profiles
 for each row execute function private.preserve_public_profile_id();

create table if not exists public.user_follows (
 follower_user_id uuid not null references auth.users(id) on delete cascade,
 followed_user_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default statement_timestamp(),
 primary key(follower_user_id,followed_user_id),
 check(follower_user_id<>followed_user_id)
);
create index if not exists user_follows_reverse on public.user_follows(followed_user_id,follower_user_id);

create table if not exists public.submission_comments (
 id uuid primary key default gen_random_uuid(),
 submission_id uuid not null references public.submissions(id) on delete cascade,
 author_user_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null,
 body text not null check(body=btrim(body) and char_length(body) between 1 and 500),
 created_at timestamptz not null default statement_timestamp(),
 deleted_at timestamptz,
 removed boolean not null default false,
 unique(author_user_id,request_id)
);
create index if not exists submission_comments_page on public.submission_comments(submission_id,created_at desc,id desc)
 where deleted_at is null and not removed;
create index if not exists submission_comments_author on public.submission_comments(author_user_id);
-- Match the client's Unicode whitespace treatment. ASCII-space btrim alone
-- accepts linebreak/tab/NBSP-only payloads that cannot render as a comment.
alter table public.submission_comments drop constraint if exists submission_comments_nonblank;
alter table public.submission_comments add constraint submission_comments_nonblank check(
 btrim(body,E' \t\n\r\f'||chr(11)||U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')<>'');

-- All participants are admitted in one ordered stage, including three-party
-- comment/report operations. Acquiring separate pairs could invert lock order.
create or replace function private.lock_social_users(participants uuid[]) returns void
language plpgsql security definer set search_path='' as $$
declare who uuid;
begin
 -- Auth erasure owns the Auth row before cascading into safety/relationship
 -- rows. Take that same stage first, before any FK write can request it later.
 perform 1 from auth.users where id=any(participants) order by id for share;
 for who in select user_id from private.safety_accounts where user_id=any(participants) order by user_id loop
  update private.safety_accounts set revision=revision+1 where user_id=who;
 end loop;
end;$$;

-- Existing block/rating/publication admission must share this lock order with
-- social writes and Auth erasure; retain its public/private function signature.
create or replace function private.lock_safety_pair(first_user uuid,second_user uuid) returns void
language plpgsql security definer set search_path='' as $$
begin perform private.lock_social_users(array[first_user,second_user]);end;$$;

create or replace function private.social_profile_visible(viewer uuid,subject uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users u join public.profiles p on p.id=u.id
 join private.safety_accounts a on a.user_id=u.id
 where u.id=viewer and u.deleted_at is null and (u.banned_until is null or u.banned_until<=statement_timestamp())
 and p.onboarding_completed_at is not null and not a.restricted)
 and exists(select 1 from auth.users u join public.profiles p on p.id=u.id
 join private.safety_accounts a on a.user_id=u.id
 where u.id=subject and u.deleted_at is null and (u.banned_until is null or u.banned_until<=statement_timestamp())
 and p.onboarding_completed_at is not null and p.username is not null and not a.restricted)
 and not private.users_blocked(viewer,subject);$$;

create or replace function public.update_my_profile(username text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare viewer uuid:=private.safety_actor();
begin
 if username is null or lower(btrim(username)) !~ '^[a-z0-9][a-z0-9_]{2,29}$' then
  raise exception using errcode='23514',message='invalid_username';
 end if;
 update public.profiles p set username=lower(btrim(update_my_profile.username)) where p.id=viewer;
 return jsonb_build_object('viewer_id',viewer,'ok',true);
end;$$;

create or replace function public.update_learning_preferences(reference_language_id uuid,target_language_id uuid,cefr_level text,timezone text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare viewer uuid:=private.safety_actor();
begin
 -- Preserve profile -> learning -> notification preference lock order. The
 -- existing validation/timezone triggers remain authoritative; saved challenge
 -- snapshots are never rewritten and username edits cannot be lost here.
 perform 1 from public.profiles p where p.id=viewer for update;
 update public.user_language_profiles l set
  reference_language_id=update_learning_preferences.reference_language_id,
  target_language_id=update_learning_preferences.target_language_id,
  cefr_level=update_learning_preferences.cefr_level,
  timezone=update_learning_preferences.timezone where l.user_id=viewer;
 if not found then raise exception using errcode='42501',message='learning_profile_required';end if;
 return jsonb_build_object('viewer_id',viewer,'ok',true);
end;$$;

create or replace function private.visible_follow_counts(viewer uuid,subject uuid)
returns table(follower_count bigint,following_count bigint)
language sql stable security definer set search_path='' as $$
 with edges as (
  select f.follower_user_id as other_id,true as follower from public.user_follows f where f.followed_user_id=subject
  union all
  select f.followed_user_id,false from public.user_follows f where f.follower_user_id=subject
 )
 select count(*) filter(where e.follower),count(*) filter(where not e.follower)
 from edges e join auth.users u on u.id=e.other_id
 join public.profiles p on p.id=u.id join private.safety_accounts a on a.user_id=u.id
 left join public.user_blocks b1 on b1.blocker_user_id=viewer and b1.blocked_user_id=e.other_id
 left join public.user_blocks b2 on b2.blocker_user_id=e.other_id and b2.blocked_user_id=viewer
 left join public.user_blocks b3 on b3.blocker_user_id=subject and b3.blocked_user_id=e.other_id
 left join public.user_blocks b4 on b4.blocker_user_id=e.other_id and b4.blocked_user_id=subject
 where u.deleted_at is null and (u.banned_until is null or u.banned_until<=statement_timestamp())
 and p.onboarding_completed_at is not null and p.username is not null and not a.restricted
 and b1.id is null and b2.id is null and b3.id is null and b4.id is null;
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
  'id',p.public_id,'username',p.username,'is_self',p.id=viewer,
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
  select p.public_id as id,p.username from public.profiles p
  where p.username is not null and p.onboarding_completed_at is not null
   and p.username collate "C">=needle collate "C" and p.username collate "C"<(needle||'{') collate "C"
   and (p.username collate "C",p.public_id)>(coalesce(after_username,'') collate "C",coalesce(after_id,'00000000-0000-0000-0000-000000000000'::uuid))
   and private.social_profile_visible(viewer,p.id)
  order by p.username collate "C",p.public_id limit 21
 ),shown as(select * from page order by username collate "C",id limit 20)
 select jsonb_build_object('viewer_id',viewer,'items',coalesce((select jsonb_agg(to_jsonb(s) order by username collate "C",id) from shown s),'[]'::jsonb),'has_more',(select count(*)>20 from page)) into result;
 return result;
end;$$;

create or replace function private.prepare_user_follow() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' then raise exception using errcode='23514',message='immutable_follow_identity';end if;
 perform private.lock_social_users(array[new.follower_user_id,new.followed_user_id]);
 if new.follower_user_id=new.followed_user_id or not private.social_profile_visible(new.follower_user_id,new.followed_user_id) then
  raise exception using errcode='42501',message='follow_unavailable';
 end if;
 new.created_at:=statement_timestamp();return new;
end;$$;
drop trigger if exists prepare_user_follow on public.user_follows;
create trigger prepare_user_follow before insert or update on public.user_follows for each row execute function private.prepare_user_follow();

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
  -- Removing one's own relationship is safe even after a block/restriction.
  delete from public.user_follows f where f.follower_user_id=viewer and f.followed_user_id=subject;
 end if;
 return jsonb_build_object('viewer_id',viewer,'ok',true);
end;$$;

create or replace function public.block_public_profile(profile_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare viewer uuid:=private.safety_actor();subject uuid;
begin
 select p.id into subject from public.profiles p where p.public_id=profile_id;
 if subject is null or subject=viewer then raise exception using errcode='42501',message='safety_unavailable';end if;
 perform private.lock_social_users(array[viewer,subject]);
 if exists(select 1 from public.user_blocks b where b.blocker_user_id=viewer and b.blocked_user_id=subject) then return jsonb_build_object('viewer_id',viewer,'ok',true);end if;
 if not private.social_profile_visible(viewer,subject) then raise exception using errcode='42501',message='safety_unavailable';end if;
 insert into public.user_blocks(blocker_user_id,blocked_user_id) values(viewer,subject) on conflict do nothing;
 return jsonb_build_object('viewer_id',viewer,'ok',true);
end;$$;

create or replace function private.comment_post_visible(viewer uuid,post uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.discover_candidates c where c.id=post and c.target_language_id=private.discover_target(viewer)
 and not private.users_blocked(viewer,c.owner_id));$$;

create or replace function private.prepare_submission_comment() returns trigger
language plpgsql security definer set search_path='' as $$
declare owner_id uuid;
begin
 if tg_op='UPDATE' then
  if (new.id,new.submission_id,new.author_user_id,new.request_id,new.body,new.created_at)
   is distinct from (old.id,old.submission_id,old.author_user_id,old.request_id,old.body,old.created_at)
   or (old.deleted_at is not null and new.deleted_at is distinct from old.deleted_at) then
   raise exception using errcode='23514',message='immutable_comment';
  end if;
 else
  select s.user_id into owner_id from public.submissions s where s.id=new.submission_id;
  perform private.lock_social_users(array[new.author_user_id,owner_id]);
  perform 1 from public.submissions s where s.id=new.submission_id for update;
  if not private.comment_post_visible(new.author_user_id,new.submission_id) then raise exception using errcode='42501',message='comment_unavailable';end if;
  new.created_at:=statement_timestamp();new.deleted_at:=null;new.removed:=false;
 end if;
 return new;
end;$$;
drop trigger if exists prepare_submission_comment on public.submission_comments;
create trigger prepare_submission_comment before insert or update on public.submission_comments for each row execute function private.prepare_submission_comment();

create or replace function public.get_submission_comments(submission_id uuid,before_time timestamptz default null,before_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=private.safety_actor();result jsonb;
begin
 if (before_time is null)<>(before_id is null) or (before_time is not null and not isfinite(before_time)) then raise exception using errcode='22023',message='invalid_comment_query';end if;
 if not private.comment_post_visible(viewer,submission_id) then raise exception using errcode='42501',message='comment_unavailable';end if;
 with page as materialized (
  select c.id,c.body,p.username,p.public_id as profile_id,c.created_at,c.author_user_id=viewer as is_own
  from public.submission_comments c join public.profiles p on p.id=c.author_user_id
  where c.submission_id=get_submission_comments.submission_id and c.deleted_at is null and not c.removed
   and private.social_profile_visible(viewer,c.author_user_id)
   and (c.created_at,c.id)<(coalesce(before_time,'infinity'::timestamptz),coalesce(before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
  order by c.created_at desc,c.id desc limit 21
 ),shown as(select * from page order by created_at desc,id desc limit 20)
 select jsonb_build_object('viewer_id',viewer,'items',coalesce((select jsonb_agg(to_jsonb(s) order by created_at desc,id desc) from shown s),'[]'::jsonb),'has_more',(select count(*)>20 from page)) into result;
 return result;
end;$$;

create or replace function public.create_submission_comment(submission_id uuid,body text,request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare viewer uuid:=private.safety_actor();owner_id uuid;previous public.submission_comments;comment_id uuid;
begin
 if submission_id is null or request_id is null or body is null or char_length(btrim(body)) not between 1 and 500
  or btrim(body,E' \t\n\r\f'||chr(11)||U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')='' then
  raise exception using errcode='22023',message='invalid_comment';
 end if;
 select s.user_id into owner_id from public.submissions s where s.id=submission_id;
 perform private.lock_social_users(array[viewer,owner_id]);
 -- Durable request tombstones prevent retry resurrection after owner deletion.
 select * into previous from public.submission_comments c where c.author_user_id=viewer and c.request_id=create_submission_comment.request_id;
 if found then
  if previous.submission_id is distinct from submission_id or previous.body is distinct from btrim(body) then raise exception using errcode='22023',message='request_identity_conflict';end if;
  return jsonb_build_object('viewer_id',viewer,'ok',true,'comment_id',previous.id);
 end if;
 perform 1 from public.submissions s where s.id=submission_id for update;
 if not private.comment_post_visible(viewer,submission_id) then raise exception using errcode='42501',message='comment_unavailable';end if;
 insert into public.submission_comments(submission_id,author_user_id,request_id,body)
 values(submission_id,viewer,request_id,btrim(body)) returning id into comment_id;
 return jsonb_build_object('viewer_id',viewer,'ok',true,'comment_id',comment_id);
end;$$;

create or replace function public.delete_submission_comment(comment_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare viewer uuid:=private.safety_actor();
begin
 perform private.lock_social_users(array[viewer]);
 update public.submission_comments c set deleted_at=coalesce(c.deleted_at,statement_timestamp()) where c.id=comment_id and c.author_user_id=viewer;
 return jsonb_build_object('viewer_id',viewer,'ok',true);
end;$$;

-- Comment cases retain an immutable text snapshot even after deletion/erasure.
alter table public.safety_reports add column if not exists comment_snapshot text not null default '' check(char_length(comment_snapshot)<=500);
alter table public.safety_reports drop constraint if exists safety_reports_target_kind_check;
alter table public.safety_reports add constraint safety_reports_target_kind_check check(target_kind in('submission','user','comment'));
alter table public.safety_reports drop constraint if exists safety_report_target_identity;
alter table public.safety_reports add constraint safety_report_target_identity check(
 reporter_user_id<>subject_user_id and ((target_kind='user' and target_id=subject_user_id)
 or (target_kind='submission' and target_id=context_submission_id) or target_kind='comment'));
alter table public.safety_reports drop constraint if exists safety_report_comment_snapshot;
alter table public.safety_reports add constraint safety_report_comment_snapshot check(
 (target_kind='comment' and char_length(comment_snapshot) between 1 and 500) or (target_kind<>'comment' and comment_snapshot=''));
alter table public.moderation_audit drop constraint if exists moderation_audit_action_check;
alter table public.moderation_audit add constraint moderation_audit_action_check check(action in('remove_submission','restore_submission','suspend_user','restore_user','resolve_report','dismiss_report','remove_comment'));
alter table public.moderation_audit drop constraint if exists moderation_audit_target_kind_check;
alter table public.moderation_audit add constraint moderation_audit_target_kind_check check(target_kind in('submission','user','report','comment'));

create or replace function public.report_submission_comment(comment_id uuid,reason text,details text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare viewer uuid:=private.safety_actor();c public.submission_comments;owner_id uuid;word text;username text;
begin
 if reason is null or reason not in('inappropriate','sexual_content','violence','harassment_hate','spam','privacy','other') or details is null or char_length(details)>500 then raise exception using errcode='22023',message='invalid_report';end if;
 select * into c from public.submission_comments where id=comment_id;
 if not found or c.author_user_id=viewer then raise exception using errcode='42501',message='safety_unavailable';end if;
 select s.user_id into owner_id from public.submissions s where s.id=c.submission_id;
 perform private.lock_social_users(array[viewer,c.author_user_id,owner_id]);
 perform 1 from public.submissions s where s.id=c.submission_id for update;
 select * into c from public.submission_comments where id=comment_id for update;
 if c.deleted_at is not null or c.removed or not private.comment_post_visible(viewer,c.submission_id) or not private.social_profile_visible(viewer,c.author_user_id) then raise exception using errcode='42501',message='safety_unavailable';end if;
 select p.username into username from public.profiles p where p.id=c.author_user_id;
 select s.target_term into word from public.submissions s where s.id=c.submission_id;
 insert into public.safety_reports(reporter_user_id,target_kind,target_id,context_submission_id,subject_user_id,username_snapshot,word_snapshot,comment_snapshot,reason,details)
 values(viewer,'comment',c.id,c.submission_id,c.author_user_id,username,word,c.body,reason,btrim(details)) on conflict do nothing;
 return jsonb_build_object('viewer_id',viewer,'ok',true);
end;$$;

create or replace function public.get_moderation_report(report_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=private.require_moderator();r public.safety_reports;
begin
 select * into r from public.safety_reports where id=report_id;
 if not found then raise exception using errcode='42501',message='moderation_unavailable';end if;
 return jsonb_build_object('viewer_id',viewer,'report',to_jsonb(r)-'reporter_user_id',
 'submission_exists',exists(select 1 from public.submissions where id=r.context_submission_id and status='completed'),
 'comment_exists',r.target_kind='comment' and exists(select 1 from public.submission_comments where id=r.target_id and deleted_at is null),
 'comment_removed',coalesce((select removed from public.submission_comments where id=r.target_id and r.target_kind='comment'),false),
 'user_exists',exists(select 1 from auth.users where id=r.subject_user_id and deleted_at is null),
 'removed',coalesce((select removed from private.submission_moderation where submission_id=r.context_submission_id),false),
 'restricted',coalesce((select restricted from private.safety_accounts where user_id=r.subject_user_id),false),
 'audit',coalesce((select jsonb_agg(to_jsonb(e) order by id desc) from(select * from public.moderation_audit where moderation_audit.report_id=r.id or (target_kind='user' and target_id=r.subject_user_id) or (target_kind='submission' and target_id=r.context_submission_id) or (target_kind='comment' and target_id=r.target_id and r.target_kind='comment') order by id desc limit 20)e),'[]'::jsonb));
end;$$;

create or replace function public.moderate_report(report_id uuid,action text,request_id uuid,reason text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare viewer uuid:=private.require_moderator();r public.safety_reports;previous public.moderation_audit;kind text;target uuid;post_owner uuid;
begin
 if action is null or action not in('remove_submission','restore_submission','suspend_user','restore_user','resolve_report','dismiss_report','remove_comment') or request_id is null or reason is null or char_length(reason)>500 then raise exception using errcode='22023',message='invalid_moderation_action';end if;
 select * into r from public.safety_reports where id=report_id;
 if not found then raise exception using errcode='42501',message='moderation_unavailable';end if;
 -- A comment's author and its parent photo owner can differ. Include both before
 -- locking the report/submission so other moderation/rating operations cannot invert.
 select s.user_id into post_owner from public.submissions s where s.id=r.context_submission_id;
 perform private.lock_social_users(array[viewer,r.subject_user_id,post_owner]);
 -- Auth deletion also cascades moderator membership: never hold membership
 -- while waiting for its Auth row. Revocation still serializes against this
 -- locked membership and is checked again immediately before admission.
 perform 1 from private.moderators where user_id=viewer for share;
 if not found then raise exception using errcode='42501',message='moderation_unavailable';end if;
 perform private.require_moderator();
 perform pg_advisory_xact_lock(hashtextextended(viewer::text||request_id::text,910));
 select * into previous from public.moderation_audit e where e.moderator_user_id=viewer and e.request_id=moderate_report.request_id;
 if found then
  if previous.report_id<>report_id or previous.action<>action or previous.reason<>reason then raise exception using errcode='22023',message='request_identity_conflict';end if;
  return jsonb_build_object('viewer_id',viewer,'ok',true);
 end if;
 select * into r from public.safety_reports where id=report_id for update;
 if action in('remove_submission','restore_submission') then
  if r.target_kind='comment' then raise exception using errcode='22023',message='invalid_moderation_action';end if;
  kind:='submission';target:=r.context_submission_id;
  perform 1 from public.submissions where id=target and status='completed' for update;
  if not found then raise exception using errcode='42501',message='moderation_unavailable';end if;
  insert into private.submission_moderation(submission_id,removed) values(target,action='remove_submission') on conflict(submission_id) do update set removed=excluded.removed;
 elsif action='remove_comment' then
  if r.target_kind<>'comment' then raise exception using errcode='22023',message='invalid_moderation_action';end if;
  kind:='comment';target:=r.target_id;
  update public.submission_comments set removed=true where id=target and deleted_at is null;
  if not found then raise exception using errcode='42501',message='moderation_unavailable';end if;
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

create or replace function public.get_moderation_history(report_id uuid,before_id bigint default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=private.require_moderator();r public.safety_reports;result jsonb;
begin
 select * into r from public.safety_reports where id=report_id;
 if not found then raise exception using errcode='42501',message='moderation_unavailable';end if;
 if before_id is not null and before_id<=0 then raise exception using errcode='22023',message='invalid_history_cursor';end if;
 with page as materialized (select e.id,e.action,e.reason,e.created_at,e.moderator_user_id,e.target_kind,e.target_id from public.moderation_audit e where e.id<coalesce(before_id,9223372036854775807::bigint) and (e.report_id=r.id or (e.target_kind='user' and e.target_id=r.subject_user_id) or (e.target_kind='submission' and e.target_id=r.context_submission_id) or (e.target_kind='comment' and e.target_id=r.target_id and r.target_kind='comment')) order by e.id desc limit 21),shown as(select * from page order by id desc limit 20)
 select jsonb_build_object('viewer_id',viewer,'items',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('id',s.id::text) order by id desc) from shown s),'[]'::jsonb),'has_more',(select count(*)>20 from page)) into result;return result;
end;$$;

-- A comment report authorizes text inspection, not inspection of a third party's
-- later-private photograph. Existing submission/account cases retain photo access.
create or replace function public.get_moderation_photo_target(viewer uuid,report_id uuid)
returns table(id uuid,storage_path text) language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_moderator(viewer) then raise exception using errcode='42501',message='moderation_unavailable';end if;
 return query select s.id,s.storage_path from public.safety_reports r join public.submissions s on s.id=r.context_submission_id and s.status='completed'
 join private.photo_verifications v on v.submission_id=s.id join storage.objects o on o.id=v.object_id and o.version=v.object_version and o.name=s.storage_path and o.bucket_id='challenge-submissions' where r.id=report_id and r.target_kind<>'comment';
end;$$;

do $$declare t text;f record;begin
 foreach t in array array['user_follows','submission_comments'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 end loop;
 for f in select oid::regprocedure signature from pg_proc where pronamespace='private'::regnamespace
 and proname in('preserve_public_profile_id','lock_social_users','lock_safety_pair','social_profile_visible','visible_follow_counts','prepare_user_follow','comment_post_visible','prepare_submission_comment') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace
 and proname in('update_my_profile','update_learning_preferences','get_public_profile','search_public_profiles','set_follow','block_public_profile','get_submission_comments','create_submission_comment','delete_submission_comment','report_submission_comment') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
end;$$;
commit;
