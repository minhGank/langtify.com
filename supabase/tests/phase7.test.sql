begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- These existing daily-photo fixtures represent reservations admitted on their
-- challenge day, then finalized later. Only the transaction-local test clock is
-- changed around admission; the production date guard remains fully exercised.
create temporary table reservation_clock(instant timestamptz);
insert into reservation_clock values(null);
create or replace function private.progress_time() returns timestamptz language sql volatile set search_path='' as $$
 select coalesce((select instant from pg_temp.reservation_clock),clock_timestamp())
$$;
create function pg_temp.reserve_daily_fixture(assignment uuid) returns public.submissions language plpgsql as $$
declare s public.submissions;
begin
 update pg_temp.reservation_clock set instant=(select (c.local_challenge_date::timestamp+interval '12 hours') at time zone l.timezone
   from public.daily_challenge_words w join public.daily_challenges c on c.id=w.daily_challenge_id
   join public.user_language_profiles l on l.user_id=c.user_id where w.id=assignment);
 s:=public.reserve_submission(assignment);
 update pg_temp.reservation_clock set instant=null;
 return s;
end;
$$;
insert into auth.users(id,email) values('77000000-0000-4000-8000-000000000001','discover_a@example.test'),('77000000-0000-4000-8000-000000000002','discover_b@example.test');
select set_config('request.jwt.claim.sub','77000000-0000-4000-8000-000000000001',true);
select public.complete_onboarding('discover_a','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','B1','UTC');
create temporary table photos(n integer,id uuid);
create function pg_temp.capture(day date) returns uuid language plpgsql as $$
declare c uuid;s public.submissions;o storage.objects;term uuid;
begin
 insert into public.daily_challenges(user_id,user_language_profile_id,created_at)
  select user_id,id,day::timestamp at time zone 'UTC' from public.user_language_profiles where user_id=auth.uid() returning id into c;
 select id into term from public.vocabulary_terms where language_id='00000000-0000-4000-8000-000000000002' and cefr_level='A2' order by id limit 1;
 insert into public.daily_challenge_words(daily_challenge_id,slot,cefr_level,vocabulary_term_id) values(c,'review','A2',term);
 perform private.assign_challenge_word(c,'target');perform private.assign_challenge_word(c,'stretch');
 s:=pg_temp.reserve_daily_fixture((select id from public.daily_challenge_words where daily_challenge_id=c and slot='review'));
 insert into storage.objects(bucket_id,name,owner_id,version,metadata) values('challenge-submissions',s.storage_path,s.user_id::text,'history-fixture','{"mimetype":"image/jpeg","size":100}') returning * into o;
 -- SQL metadata fixture only; real JPEG/Storage coverage is in the integration suite.
 perform public.attest_submission_photo(s.id,s.user_id,o.id,o.version,repeat('a',64),16,16);
 perform public.finalize_submission(s.id);return s.id;
end;
$$;
insert into photos values(1,pg_temp.capture('2026-08-01')),(2,pg_temp.capture('2026-08-02')),(3,pg_temp.capture('2026-08-03'));
select is(jsonb_array_length(public.get_discover_feed()->'items'),0,'Private captures excluded');
select public.set_submission_visibility(id,'public') from photos;
select is(jsonb_array_length(public.get_discover_feed()->'items'),3,'Own public captures appear, including repeated concepts');
-- Timestamp ties are fixture-only; production timestamps remain immutable.
alter table public.submissions disable trigger prepare_submission;
update public.submissions set submitted_at='2026-08-04T12:00:00.123456Z' where id in(select id from photos);
alter table public.submissions enable trigger prepare_submission;
create temporary table pages as select public.get_discover_feed(page_size=>1) payload;
select is((select payload->'items'->0->>'id' from pages),(select id::text from photos order by id desc limit 1),'Timestamp ties use descending UUID');
select is((select payload->>'has_more' from pages),'true','Lookahead indicates more');
select is((select public.get_discover_feed((payload->'items'->0->>'submitted_at')::timestamptz,(payload->'items'->0->>'id')::uuid,1)->'items'->0->>'id' from pages),(select id::text from photos order by id desc offset 1 limit 1),'Strict keyset has no duplicate under ties');
select is((select array_agg(key order by key) from jsonb_object_keys(public.get_discover_feed()->'items'->0) key),array['avatar_id','average_rating','can_rate','cefr_level','id','rating_count','reference_term','submitted_at','target_term','username','viewer_rating'],'Public projection contains only display fields');
update public.vocabulary_terms set term='Changed catalog',is_active=false where id=(select vocabulary_term_id from public.submissions where id=(select id from photos where n=1));
select isnt(public.get_discover_feed()->'items'->0->>'target_term','Changed catalog','Feed uses historical text');
select set_config('request.jwt.claim.sub','77000000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.get_discover_feed()$$,'42501','feed_unavailable','Incomplete viewer onboarding denied');
select public.complete_onboarding('discover_b','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','B1','UTC');
-- QA #20: the bounded public projection exposes only a current verified avatar ID.
select is(public.get_discover_feed()->'items'->0->'avatar_id','null'::jsonb,'No avatar is an explicit null');
select set_config('request.jwt.claim.sub','77000000-0000-4000-8000-000000000001',true);
create temporary table feed_avatar as select v->'avatar'->>'id' id,v->'avatar'->>'storage_path' path
 from(select public.reserve_profile_avatar(gen_random_uuid()) v) r;
select is(public.get_discover_feed()->'items'->0->'avatar_id','null'::jsonb,'Pending avatar is not exposed');
insert into storage.objects(bucket_id,name,owner_id,version,metadata)
 select 'profile-avatars',path,auth.uid()::text,'feed-avatar-v1','{"mimetype":"image/jpeg","size":100}' from feed_avatar;
select public.activate_profile_avatar(a.id::uuid,auth.uid(),o.id,o.version,repeat('a',64),16,16)
 from feed_avatar a join storage.objects o on o.bucket_id='profile-avatars' and o.name=a.path;
select set_config('request.jwt.claim.sub','77000000-0000-4000-8000-000000000002',true);
grant select on feed_avatar to authenticated;
grant select on photos,pages to authenticated;
set local role authenticated;
select is(jsonb_array_length(public.get_discover_feed()->'items'),3,'Other onboarded viewer sees eligible public captures');
select is(public.get_discover_feed(page_size=>1)->'items'->0->>'avatar_id',(select id from feed_avatar),'Feed exposes verified avatar only after bounded paging');
select is(public.get_discover_submission((select id from photos where n=1))->'items'->0->>'avatar_id',(select id from feed_avatar),'Canonical post returns the same avatar reference');
select throws_ok($$select * from private.profile_avatars$$,'42501',null,'Avatar rows remain private');
select throws_ok($$select * from public.get_avatar_targets(auth.uid(),array[(select id::uuid from feed_avatar)])$$,'42501',null,'An avatar reference does not confer signing authority');
select is((select count(*) from public.submissions),0::bigint,'Raw submissions remain owner only');
select is((select count(*) from public.profiles where id='77000000-0000-4000-8000-000000000001'),0::bigint,'Private profile remains owner only');
select throws_ok($$update public.submissions set visibility='public'$$,'42501',null,'Direct mutation denied');
select throws_ok($$select * from private.discover_candidates$$,'42501',null,'Private view inaccessible');
select throws_ok($$select public.get_discover_photo_targets(auth.uid(),'00000000-0000-4000-8000-000000000002',array[(select id from photos limit 1)])$$,'42501',null,'Clients cannot invoke privileged signing lookup');
select throws_ok($$select public.get_discover_feed(page_size=>25)$$,'22023','invalid_feed_query','Page bounded');
select throws_ok($$select public.get_discover_feed(before_id=>gen_random_uuid())$$,'22023','invalid_feed_query','Partial cursor denied');
select throws_ok($$select public.get_discover_feed('infinity',gen_random_uuid(),1)$$,'22023','invalid_feed_query','Infinite cursor denied');
reset role;
select is((select avatar_id::text from public.get_discover_photo_targets(auth.uid(),'00000000-0000-4000-8000-000000000002',array[(select id from photos where n=1)])),(select id from feed_avatar),'Signing revalidation retains the avatar reference');
insert into public.user_blocks(blocker_user_id,blocked_user_id) values(auth.uid(),'77000000-0000-4000-8000-000000000001');
select is(jsonb_array_length(public.get_discover_feed()->'items'),0,'Blocked author and avatar disappear together');
select is(jsonb_array_length(public.get_discover_submission((select id from photos where n=1))->'items'),0,'Blocked direct post is absent');
select is((select count(*) from public.get_avatar_targets(auth.uid(),array[(select id::uuid from feed_avatar)])),0::bigint,'Previously exposed avatar cannot be signed after blocking');
delete from public.user_blocks where blocker_user_id=auth.uid();
insert into public.user_blocks(blocker_user_id,blocked_user_id) values('77000000-0000-4000-8000-000000000001',auth.uid());
select is(jsonb_array_length(public.get_discover_feed()->'items'),0,'Reverse block excludes author');
delete from public.user_blocks where blocked_user_id=auth.uid();
update private.safety_accounts set restricted=true where user_id='77000000-0000-4000-8000-000000000001';
select is(jsonb_array_length(public.get_discover_feed()->'items'),0,'Restricted author and avatar excluded');
update private.safety_accounts set restricted=false where user_id='77000000-0000-4000-8000-000000000001';
-- Corruption fixture only: production object immutability is tested elsewhere.
set local session_replication_role=replica;
update storage.objects set version='changed' where bucket_id='profile-avatars' and name=(select path from feed_avatar);
set local session_replication_role=origin;
select is(public.get_discover_feed()->'items'->0->'avatar_id','null'::jsonb,'Changed object version falls back without dropping a valid post');
set local session_replication_role=replica;
update storage.objects set version='feed-avatar-v1' where bucket_id='profile-avatars' and name=(select path from feed_avatar);
set local session_replication_role=origin;
update public.user_language_profiles set target_language_id='00000000-0000-4000-8000-000000000001',reference_language_id='00000000-0000-4000-8000-000000000002' where user_id=auth.uid();
select is(jsonb_array_length(public.get_discover_feed()->'items'),0,'Saved viewer target is authoritative');
select throws_ok($$select public.get_discover_photo_targets(auth.uid(),'00000000-0000-4000-8000-000000000002',array[(select id from photos limit 1)])$$,'42501','feed_settings_changed','Signer cannot override saved target');
select set_config('request.jwt.claim.sub','77000000-0000-4000-8000-000000000001',true);
select public.set_submission_visibility((select id from photos where n=1),'private');
select is(jsonb_array_length(public.get_discover_feed()->'items'),2,'Public to private removes eligibility');
select is((select count(*) from public.get_discover_photo_targets(auth.uid(),'00000000-0000-4000-8000-000000000002',array[(select id from photos where n=1)])),0::bigint,'Private image signing excluded even for owner feed');
select public.set_submission_visibility((select id from photos where n=1),'public');
select is(jsonb_array_length(public.get_discover_feed()->'items'),3,'Private to public restores eligibility');
update auth.users set banned_until=now()+interval '1 day' where id=auth.uid();
select is((select count(*) from private.discover_candidates),0::bigint,'Banned owner excluded');
select throws_ok($$select public.get_discover_feed()$$,'42501','feed_unavailable','Banned viewer denied');
update auth.users set banned_until=null,deleted_at=now() where id=auth.uid();
select is((select count(*) from private.discover_candidates),0::bigint,'Soft deleted account excluded');
update auth.users set deleted_at=null where id=auth.uid();
-- Simulate missing object metadata without weakening production guards.
set local session_replication_role=replica;
delete from storage.objects where name=(select storage_path from public.submissions where id=(select id from photos where n=3));
set local session_replication_role=origin;
select is(jsonb_array_length(public.get_discover_feed()->'items'),2,'Missing image excluded');
select public.begin_submission_deletion((select id from photos where n=2));
select is(jsonb_array_length(public.get_discover_feed()->'items'),1,'Deleting capture excluded');
select is((select count(*) from public.get_discover_photo_targets(auth.uid(),'00000000-0000-4000-8000-000000000002',array[(select id from photos where n=2)])),0::bigint,'Deleting photo cannot be newly signed');
select public.begin_submission_deletion((select id from photos where n=3));
select public.finish_submission_deletion((select id from photos where n=3));
select is(jsonb_array_length(public.get_discover_feed()->'items'),1,'Deleted capture excluded');
set local role anon;
select throws_ok($$select public.get_discover_feed()$$,'42501',null,'Anonymous feed denied');
reset role;
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='public.get_discover_feed(timestamptz,uuid,integer)'::regprocedure),'Definer uses fixed empty search path');
select is((select public from storage.buckets where id='challenge-submissions'),false,'Photo bucket remains private');
select * from finish();
rollback;
