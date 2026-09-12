# Phase 2 verification and handoff

This is the original delivery record. See [Phase 2 audit](PHASE2_AUDIT.md) for
subsequent fixes, the additive migration, current test results and closure assessment.

Verified locally on 2026-09-12. Phase 3 has not started. No hosted Supabase project
was linked, migrated or otherwise changed. The isolated Docker project is `langtify`.

## Delivered scope

Supabase client and generated database types; persistent email/password auth;
sign-in/sign-up/sign-out and confirmation messaging; restored session verification;
protected navigation; validated onboarding and profile summary. Existing Today,
Discover and Vocabulary content remains placeholder-only.

`20260912000000_phase2_identity.sql` creates `profiles`, `languages`, and
`user_language_profiles`, with username/CEFR/language constraints, IANA timezone
validation, timestamps, signup profile creation, and the atomic `complete_onboarding`
RPC. English (`en`) and French (`fr`) are in the idempotent language seed.

RLS policies: `profiles_read_own`, `profiles_update_own`,
`languages_read_authenticated`, `learning_read_own`, `learning_insert_own`,
`learning_update_own`. Grants restrict client mutation columns, and there are no
client delete policies. Completion is server-owned. Security-definer functions
use an empty search path and the RPC uses `auth.uid()` rather than an input user ID.

## Commands and results

| Check                                                                                                        | Result                                                                                                       |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `npx expo install @supabase/supabase-js @react-native-async-storage/async-storage react-native-url-polyfill` | Dependencies installed                                                                                       |
| `npm install --save-dev supabase`                                                                            | Local CLI installed                                                                                          |
| `npx supabase init --yes`                                                                                    | Local configuration created                                                                                  |
| `npx supabase start`                                                                                         | Local database, Auth, API and email capture running; migration and seed applied                              |
| `npx supabase migration list --local`                                                                        | Phase 2 migration present in local database                                                                  |
| `npx supabase gen types typescript --local --schema public`                                                  | `src/types/database.ts` generated from migrated schema                                                       |
| `npm run check`                                                                                              | Typecheck, zero-warning lint, formatting, and all 58 tests passed (7 suites)                                 |
| `npm run db:test`                                                                                            | Standard invocation blocked by Docker host file sharing; same suite passed via temporary-path fallback below |
| `npx supabase test db /private/tmp/langtify-phase2.test.sql`                                                 | All 47 pgTAP tests passed; fixtures rolled back                                                              |
| `npx supabase db lint --local --level warning`                                                               | No schema errors                                                                                             |
| `npx expo config --type public --json`                                                                       | Config resolves with Langtify branding                                                                       |
| `npx expo install --check`                                                                                   | Dependencies up to date                                                                                      |
| `npm run doctor`                                                                                             | 21/21 checks passed                                                                                          |
| `CI=1 npm run export:check -- --clear`                                                                       | Fresh production bundles for iOS, Android and web                                                            |
| `git diff --check`                                                                                           | No whitespace errors                                                                                         |
| Credential-literal and ignore-rule review                                                                    | No real keys/JWTs/private keys in repository source; `.env.local` and local Supabase metadata are ignored    |

The database test fallback copies the exact repository test file to
`/private/tmp/langtify-phase2.test.sql`. It does not change policies or skip cases.
Studio is disabled because Docker Desktop does not share `/Applications/langtify.com`.
Share that path to use the standard test command and enable Studio if desired.

A temporary local integration script also exercised the real Supabase Auth and
REST APIs using only the public client key: signup with confirmation required,
unconfirmed and invalid-password errors, confirmed password sign-in, transactional
onboarding, a fresh SDK client restoring persisted storage and validating its user,
and sign-out removing that storage. Confirmation was set in the local database
for the fixture; this does not verify real email delivery or phone link behavior.
The fixture account was deleted afterward. This smoke check used SDK storage in
Node, not the native AsyncStorage bridge; device persistence remains a phone test.

## Requirement review

- All five original product documents and AGENTS.md now distinguish current Phase 2
  implementation from the confirmed future product rules. No additional challenge,
  replacement, rating or timing rules were implemented.
- Email remains in Auth. Usernames are required after completion, normalized and
  case-insensitively unique. Signup creates the profile; RPC recovers older users.
- One learning record per user; different reference/target languages; valid CEFR
  and named IANA timezone. English/French are selected from backend catalog data.
- Main routes require a verified restored session plus persisted completion and
  learning data. Auth and incomplete onboarding cannot reach main tabs by URL.
- Network/read/write failures have safe error states and retry paths. Session
  generation checks discard late account reads after sign-out or account switches.
- Onboarding writes share a database transaction. Tests cover username failure
  after learning insertion, rollback, idempotent retry and partial-record recovery.
- No vocabulary/challenge schema, camera/uploads/buckets, streaks, community,
  OAuth/magic-link login, or other Phase 3 feature was added.

## Setup, phone tests and limitations

See the [README](../README.md) for exact local/hosted setup and the eight-step
phone checklist for both iOS and Android. Configure `EXPO_PUBLIC_SUPABASE_URL`
and `EXPO_PUBLIC_SUPABASE_ANON_KEY` (public publishable key or legacy anon JWT).
No `.env.local` has been created. On a physical phone use a reachable hosted URL
or the computer's LAN address, not the phone's localhost.

For hosted development, apply the reviewed migration and seed, configure email
confirmation/password policy/SMTP and an actual confirmation landing URL, then
configure the public variables and restart Expo. No service-role key belongs in
the mobile app. Native session storage follows Supabase's AsyncStorage approach;
it is persistent but unencrypted. Sign-out affects this device/browser session.

Outstanding manual verification: physical-device session persistence/refresh,
email delivery and confirmation, keyboard/accessibility/theme behavior, and
network interruption during onboarding. Native binaries were not built or signed.
Existing 14 moderate Expo dependency advisories and the ESLint 9 compatibility
constraint remain; no incompatible forced audit fix was applied.

## Files changed in Phase 2

This list compares against the working tree at the start of Phase 2, preserving
all preexisting Phase 1/branding changes. It excludes dependencies, generated
exports, local Docker volumes and ignored Supabase runtime metadata.

- `.env.example`
- `.gitignore`
- `.prettierignore`
- `AGENTS.md`
- `README.md`
- `app/(tabs)/profile.tsx`
- `app/_layout.tsx`
- `app/onboarding.tsx`
- `app/session.tsx`
- `app/sign-in.tsx`
- `app/sign-up.tsx`
- `docs/ARCHITECTURE.md`
- `docs/DATA_MODEL.md`
- `docs/DECISIONS.md`
- `docs/PRODUCT.md`
- `docs/ROADMAP.md`
- `package-lock.json`
- `package.json`
- `src/components/placeholder-screen.tsx`
- `src/components/ui/button.tsx`
- `src/components/ui/choice-field.tsx`
- `src/components/ui/form-field.tsx`
- `src/components/ui/screen.tsx`
- `src/features/auth/auth-provider.tsx`
- `src/features/auth/auth-screen.tsx`
- `src/features/auth/errors.ts`
- `src/features/auth/session-state.ts`
- `src/features/auth/sign-out-button.tsx`
- `src/features/auth/use-session-state.ts`
- `src/features/onboarding/onboarding-screen.tsx`
- `src/features/onboarding/validation.ts`
- `src/features/profile/profile-screen.tsx`
- `src/lib/env.ts`
- `src/lib/supabase.ts`
- `src/services/account.ts`
- `src/types/database.ts`
- `supabase/.gitignore`
- `supabase/config.toml`
- `supabase/migrations/20260912000000_phase2_identity.sql`
- `supabase/seed.sql`
- `supabase/tests/phase2.test.sql`
- `tests/auth-errors.test.ts`
- `tests/auth-screen.test.tsx`
- `tests/env.test.ts`
- `tests/fixtures.ts`
- `tests/navigation.test.tsx`
- `tests/onboarding-save.test.tsx`
- `tests/onboarding-validation.test.ts`
- `tests/session-state.test.tsx`
- `tests/setup.ts`
- `docs/PHASE2_VERIFICATION.md` (this report)
