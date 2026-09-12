-- Language catalog only. Stable codes and IDs; safe to apply repeatedly.
insert into public.languages (id, code, name, native_name, is_active) values
  ('00000000-0000-4000-8000-000000000001', 'en', 'English', 'English', true),
  ('00000000-0000-4000-8000-000000000002', 'fr', 'French', 'Français', true)
-- Existing catalog decisions (including deactivation) belong to administrators.
on conflict (code) do nothing;
