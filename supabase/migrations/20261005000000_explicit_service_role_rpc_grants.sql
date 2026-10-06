-- Preserve the existing Dev service-role RPC contract independently of
-- Supabase project default privileges. Client grants and function bodies are unchanged.
begin;

grant execute on function public.begin_submission_deletion(uuid) to service_role;
grant execute on function public.can_upload_submission_object(text) to service_role;
grant execute on function public.complete_onboarding(text, uuid, uuid, text, text) to service_role;
grant execute on function public.finish_submission_deletion(uuid) to service_role;
grant execute on function public.get_assignment_photo(uuid) to service_role;
grant execute on function public.get_concept_submissions(uuid, timestamp with time zone, uuid, integer) to service_role;
grant execute on function public.get_discover_feed(timestamp with time zone, uuid, integer) to service_role;
grant execute on function public.get_discover_submission(uuid) to service_role;
grant execute on function public.get_explore_concept(uuid) to service_role;
grant execute on function public.get_my_past_words(text, text, boolean, date, uuid, integer) to service_role;
grant execute on function public.get_my_progress(uuid) to service_role;
grant execute on function public.get_my_vocabulary(uuid, text, text, timestamp with time zone, uuid, integer, text) to service_role;
grant execute on function public.get_or_create_today_challenge() to service_role;
grant execute on function public.get_public_profile_submissions(uuid, timestamp with time zone, uuid, integer) to service_role;
grant execute on function public.get_submission_xp(uuid) to service_role;
grant execute on function public.rate_submission(uuid, numeric) to service_role;
grant execute on function public.replace_daily_challenge_word(uuid) to service_role;
grant execute on function public.reserve_historical_submission(uuid) to service_role;
grant execute on function public.reserve_submission(uuid) to service_role;
grant execute on function public.search_vocabulary_terms(text, text, uuid, integer) to service_role;

commit;
