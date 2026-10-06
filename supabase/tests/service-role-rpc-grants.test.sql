begin;
select plan(111);

-- Exact overloads: authenticated access stays permitted, anonymous access stays
-- denied, and service access must not depend on project default privileges.
create temporary table expected_product_rpcs(signature text primary key);
insert into expected_product_rpcs values
 ('public.begin_submission_deletion(uuid)'),
 ('public.can_upload_submission_object(text)'),
 ('public.complete_onboarding(text, uuid, uuid, text, text)'),
 ('public.finish_submission_deletion(uuid)'),
 ('public.get_assignment_photo(uuid)'),
 ('public.get_concept_submissions(uuid, timestamp with time zone, uuid, integer)'),
 ('public.get_discover_feed(timestamp with time zone, uuid, integer)'),
 ('public.get_discover_submission(uuid)'),
 ('public.get_explore_concept(uuid)'),
 ('public.get_my_past_words(text, text, boolean, date, uuid, integer)'),
 ('public.get_my_progress(uuid)'),
 ('public.get_my_vocabulary(uuid, text, text, timestamp with time zone, uuid, integer, text)'),
 ('public.get_or_create_today_challenge()'),
 ('public.get_public_profile_submissions(uuid, timestamp with time zone, uuid, integer)'),
 ('public.get_submission_xp(uuid)'),
 ('public.rate_submission(uuid, numeric)'),
 ('public.replace_daily_challenge_word(uuid)'),
 ('public.reserve_historical_submission(uuid)'),
 ('public.reserve_submission(uuid)'),
 ('public.search_vocabulary_terms(text, text, uuid, integer)');
select ok(has_function_privilege('service_role', signature, 'execute'), signature || ': service allowed')
from expected_product_rpcs order by signature;
select ok(has_function_privilege('authenticated', signature, 'execute'), signature || ': authenticated unchanged')
from expected_product_rpcs order by signature;
select ok(not has_function_privilege('anon', signature, 'execute'), signature || ': anon denied')
from expected_product_rpcs order by signature;

-- The explicit product grants must never make service-only authority callable
-- by either client role.
create temporary table expected_service_only_rpcs(signature text primary key);
insert into expected_service_only_rpcs values
 ('public.activate_profile_avatar(uuid, uuid, uuid, text, text, integer, integer)'),
 ('public.attest_submission_photo(uuid, uuid, uuid, text, text, integer, integer)'),
 ('public.authorize_notification_attempt(uuid)'),
 ('public.avatar_verification_target(uuid, uuid)'),
 ('public.claim_avatar_cleanup(integer)'),
 ('public.claim_notification_attempts(integer)'),
 ('public.claim_notification_receipts(integer)'),
 ('public.claim_photo_cleanup(integer)'),
 ('public.finish_avatar_cleanup(text)'),
 ('public.finish_photo_cleanup(text)'),
 ('public.get_avatar_targets(uuid, uuid[])'),
 ('public.get_blocked_avatar_targets(uuid, uuid[])'),
 ('public.get_discover_photo_targets(uuid, uuid, uuid[])'),
 ('public.get_moderation_photo_target(uuid, uuid)'),
 ('public.photo_verification_target(uuid, uuid)'),
 ('public.record_notification_receipt(uuid, uuid, text, text)'),
 ('public.record_notification_result(uuid, text, uuid, text)');
select ok(has_function_privilege('service_role', signature, 'execute'), signature || ': service allowed')
from expected_service_only_rpcs order by signature;
select ok(not has_function_privilege('authenticated', signature, 'execute'), signature || ': authenticated denied')
from expected_service_only_rpcs order by signature;
select ok(not has_function_privilege('anon', signature, 'execute'), signature || ': anon denied')
from expected_service_only_rpcs order by signature;
select * from finish();
rollback;
