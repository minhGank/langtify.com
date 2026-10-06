-- Preserve confirmed Dev service-role table privileges independently of
-- Supabase defaults. No client grants, RLS, policies or object definitions change.
begin;

grant select, insert, update, delete on table public.daily_challenge_words to service_role;
grant select, insert, update, delete on table public.daily_challenges to service_role;
grant select, insert, update, delete on table public.languages to service_role;
grant select, insert, update, delete on table public.profiles to service_role;
grant select, insert, update, delete on table public.submissions to service_role;
grant select, insert, update, delete on table public.user_language_profiles to service_role;
grant select, insert, update, delete on table public.vocabulary_concepts to service_role;
grant select, insert, update, delete on table public.vocabulary_terms to service_role;
grant select, insert, update, delete on table public.xp_events to service_role;

commit;
