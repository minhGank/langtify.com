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
insert into auth.users(id,email) values('78000000-0000-4000-8000-000000000001','ratings_a@example.test'),('78000000-0000-4000-8000-000000000002','ratings_b@example.test');
select set_config('request.jwt.claim.sub','78000000-0000-4000-8000-000000000001',true);
select public.complete_onboarding('ratings_a','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','B1','UTC');
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
insert into photos values(1,pg_temp.capture('2026-08-01'));
select throws_ok($$select public.rate_submission((select id from photos),3)$$,'42501','rating_unavailable','Owner cannot rate own photo');
select public.set_submission_visibility((select id from photos),'public');
create temporary table pending_photo as
 select (pg_temp.reserve_daily_fixture((select id from public.daily_challenge_words where slot='target' and daily_challenge_id=(select daily_challenge_id from public.submissions where id=(select id from photos))))).id;
create temporary table before_xp as select * from public.xp_events;
select set_config('request.jwt.claim.sub','78000000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.rate_submission((select id from photos),3)$$,'42501','feed_unavailable','Incomplete onboarding denied');
select public.complete_onboarding('ratings_b','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','B1','UTC');
select is(public.get_discover_feed()->'items'->0->>'rating_count','0','Initially unrated');
select is(public.get_discover_feed()->'items'->0->'average_rating','null'::jsonb,'Unrated average is null');
select is(public.get_discover_feed()->'items'->0->>'can_rate','true','Other viewer may rate');
grant select on photos,pending_photo to authenticated;
set local role authenticated;
select is(public.rate_submission((select id from photos),n)->'item'->>'viewer_rating',n::text,'Score '||n||' accepted') from generate_series(1,5) n;
select is(public.rate_submission((select id from photos),5)->'item'->>'rating_count','1','Retry does not add a vote');
select throws_ok($$select public.rate_submission((select id from photos),0)$$,'22023','invalid_rating_score','Zero rejected');
select throws_ok($$select public.rate_submission((select id from photos),6)$$,'22023','invalid_rating_score','Six rejected');
select throws_ok($$select public.rate_submission((select id from photos),1.5)$$,'22023','invalid_rating_score','Fractional input cannot round to a score');
select throws_ok($$select public.rate_submission((select id from photos),null)$$,'22023','invalid_rating_score','Null rejected');
select throws_ok($$select public.rate_submission((select id from photos),'NaN')$$,'22023','invalid_rating_score','NaN rejected');
select throws_ok($$select public.rate_submission((select id from photos),'Infinity')$$,'22023','invalid_rating_score','Positive infinity rejected');
select throws_ok($$select public.rate_submission((select id from photos),'-Infinity')$$,'22023','invalid_rating_score','Negative infinity rejected');
select throws_ok($$select public.rate_submission((select id from pending_photo),3)$$,'42501','rating_unavailable','Pending upload cannot be rated');
select throws_ok($$select public.rate_submission(null,3)$$,'42501','rating_unavailable','Missing identity cannot be rated');
select throws_ok($$select public.rate_submission(gen_random_uuid(),3)$$,'42501','rating_unavailable','Unknown ID has the same unavailable response');
select throws_ok($$select * from public.submission_ratings$$,'42501',null,'No raw rating-history access');
select throws_ok($$insert into public.submission_ratings(submission_id,rater_user_id,score) select id,auth.uid(),0 from photos$$,'42501',null,'Direct insert denied');
select throws_ok($$update public.submission_ratings set score=5$$,'42501',null,'Direct update denied');
select throws_ok($$delete from public.submission_ratings$$,'42501',null,'Direct delete denied');
select throws_ok($$select private.discover_rating_stats(auth.uid(),array[(select id from photos)])$$,'42501',null,'Private aggregates cannot be queried for arbitrary IDs');
reset role;
select throws_ok($$select private.discover_rating_stats(auth.uid(),null)$$,'22023','invalid_rating_batch','Aggregate helper rejects missing bound');
select throws_ok($$select private.discover_rating_stats(auth.uid(),array_fill((select id from photos),array[25]))$$,'22023','invalid_rating_batch','Aggregate helper rejects oversized bound');
select is((select count(*) from private.discover_rating_stats(auth.uid(),array[]::uuid[])),0::bigint,'Empty batch scans no result set');
update auth.users set banned_until=now()+interval '1 day' where id=auth.uid();
select throws_ok($$select public.rate_submission((select id from photos),4)$$,'42501','feed_unavailable','Banned rater cannot change a vote');
select throws_ok($$select public.get_discover_feed()$$,'42501','feed_unavailable','Banned rater cannot read viewer summaries');
update auth.users set banned_until=null,deleted_at=now() where id=auth.uid();
select throws_ok($$select public.rate_submission((select id from photos),4)$$,'42501','feed_unavailable','Soft-deleted rater cannot vote');
update auth.users set deleted_at=null where id=auth.uid();
-- Privileged corruption fixture: eligibility must require the verified version.
set local session_replication_role=replica;
update storage.objects set version='ratings-audit-mismatch' where name=(select storage_path from public.submissions where id=(select id from photos));
set local session_replication_role=origin;
select throws_ok($$select public.rate_submission((select id from photos),4)$$,'42501','rating_unavailable','Unverified image version cannot receive a vote');
set local session_replication_role=replica;
update storage.objects set version='history-fixture' where name=(select storage_path from public.submissions where id=(select id from photos));
set local session_replication_role=origin;
create temporary table rating_before as select * from public.submission_ratings;
select public.rate_submission((select id from photos),5);
select is((select to_jsonb(r) from public.submission_ratings r),(select to_jsonb(r) from rating_before r),'Same-score retry preserves timestamps and identity');
select throws_ok($$update public.submission_ratings set score=6$$,'23514',null,'Score CHECK also protects privileged writes');
select throws_ok($$insert into public.submission_ratings(submission_id,rater_user_id,score) select id,auth.uid(),3 from photos$$,'23505',null,'Composite primary key prevents duplicate vote');
select throws_ok($$update public.submission_ratings set rater_user_id='78000000-0000-4000-8000-000000000001'$$,'23514','immutable_rating_identity','Cannot transfer a vote');
insert into auth.users(id,email) values('78000000-0000-4000-8000-000000000003','ratings_c@example.test');
select set_config('request.jwt.claim.sub','78000000-0000-4000-8000-000000000003',true);
select public.complete_onboarding('ratings_c','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','B1','UTC');
select is(public.rate_submission((select id from photos),3)->'item'->>'rating_count','2','Different viewer contributes exactly one vote');
select is((public.get_discover_feed()->'items'->0->>'average_rating')::numeric,4::numeric,'Average uses authoritative current scores');
select is(public.get_discover_feed()->'items'->0->>'viewer_rating','3','Feed selection belongs to current viewer');
select is((select viewer_rating from public.get_discover_photo_targets(auth.uid(),'00000000-0000-4000-8000-000000000002',array[(select id from photos)])),3::smallint,'Batch renewal includes the same viewer rating');
select set_config('request.jwt.claim.sub','78000000-0000-4000-8000-000000000001',true);
select is(public.get_discover_feed()->'items'->0->>'can_rate','false','Owner controls disabled by backend');
select is(public.get_discover_feed()->'items'->0->'viewer_rating','null'::jsonb,'Owner has no own vote');
select throws_ok($$select public.rate_submission((select id from photos),4)$$,'42501','rating_unavailable','Public self-rating rejected');
select public.set_submission_visibility((select id from photos),'private');
select set_config('request.jwt.claim.sub','78000000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.rate_submission((select id from photos),4)$$,'42501','rating_unavailable','Private submission rejects changed ratings');
select is(jsonb_array_length(public.get_discover_feed()->'items'),0,'Private aggregates hidden');
select is((select count(*) from public.submission_ratings),2::bigint,'Private visibility retains durable votes');
select set_config('request.jwt.claim.sub','78000000-0000-4000-8000-000000000001',true);
select public.set_submission_visibility((select id from photos),'public');
select is(public.get_discover_feed()->'items'->0->>'rating_count','2','Republishing restores votes');
select set_config('request.jwt.claim.sub','78000000-0000-4000-8000-000000000002',true);
update public.user_language_profiles set target_language_id='00000000-0000-4000-8000-000000000001',reference_language_id='00000000-0000-4000-8000-000000000002' where user_id=auth.uid();
select throws_ok($$select public.rate_submission((select id from photos),4)$$,'42501','rating_unavailable','Wrong saved target denied');
update public.user_language_profiles set target_language_id='00000000-0000-4000-8000-000000000002',reference_language_id='00000000-0000-4000-8000-000000000001' where user_id=auth.uid();
update auth.users set banned_until=now()+interval '1 day' where id='78000000-0000-4000-8000-000000000001';
select throws_ok($$select public.rate_submission((select id from photos),4)$$,'42501','rating_unavailable','Invalid owner cannot receive votes');
update auth.users set banned_until=null where id='78000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','78000000-0000-4000-8000-000000000001',true);
select public.begin_submission_deletion((select id from photos));
select set_config('request.jwt.claim.sub','78000000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.rate_submission((select id from photos),4)$$,'42501','rating_unavailable','Deleting submission denied');
select is((select jsonb_agg(to_jsonb(e) order by id) from public.xp_events e),(select jsonb_agg(to_jsonb(e) order by id) from before_xp e),'Ratings have no XP or completion effect');
select set_config('request.jwt.claim.sub','78000000-0000-4000-8000-000000000001',true);
select set_config('storage.allow_delete_query','true',true);
delete from storage.objects where name=(select storage_path from public.submissions where id=(select id from photos));
select public.finish_submission_deletion((select id from photos));
select set_config('request.jwt.claim.sub','78000000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.rate_submission((select id from photos),4)$$,'42501','rating_unavailable','Deleted submission denied');
select is((select count(*) from public.submission_ratings),2::bigint,'Soft retirement preserves ratings');
delete from auth.users where id='78000000-0000-4000-8000-000000000003';
select is((select count(*) from public.submission_ratings),1::bigint,'Permanent rater deletion cascades one vote');
delete from auth.users where id='78000000-0000-4000-8000-000000000001';
select is((select count(*) from public.submission_ratings),0::bigint,'Permanent owner/submission deletion cascades remaining votes');
set local role anon;
select throws_ok($$select public.rate_submission(gen_random_uuid(),3)$$,'42501',null,'Anonymous rating denied');
reset role;
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='public.rate_submission(uuid,numeric)'::regprocedure),'Mutation uses fixed search path');
select * from finish();
rollback;
