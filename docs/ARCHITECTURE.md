# Architecture

Langtify uses Expo SDK 57, React Native, strict TypeScript, npm, and Expo Router.
Root `app/` contains routes/layouts; `src/` contains implementation. Metro and
Babel retain Expo defaults; `@/` maps to `src/`. iOS and Android are primary, with
web-compatible components and a shared `expo-router/js-tabs` layout.

## Phase 3 boundaries

- `src/components/ui/`: typed, accessible shared presentation primitives.
- `src/features/auth/`: session lifecycle, email/password forms, navigation authority.
- `src/features/onboarding/`: validation and onboarding presentation.
- `src/features/challenges/`: Today cards, request lifecycle and safe error states.
- `src/features/profile/`: account summary and sign out.
- `src/lib/`: validated public configuration and a typed Supabase client.
- `src/services/`: database operations, including transactional onboarding and challenge RPCs.
- `src/types/`: database types matching migrations.
- `supabase/`: local configuration, versioned migrations, language seed, SQL tests.
- `tests/`: behavior tests outside route discovery.

Supabase/PostgreSQL is the authoritative backend. RLS and database constraints
protect user-owned data even if a client bypasses navigation. No custom backend,
Redux, or other global state package is needed. A small React context owns the
session/profile lifecycle; no client flag permanently marks onboarding complete.

## Session and route authority

Supabase Auth persists sessions using AsyncStorage on native and the Supabase
browser storage adapter on web. Refresh runs while the native app is foregrounded.
Startup restores the session and reloads the profile and learning record before
unlocking routes. Loading, configuration errors, and recoverable backend errors
have explicit screens. Failed reads do not imply onboarding completion.

Protected routes separate signed-out auth, incomplete onboarding, and
completed main tabs. Account changes and sign out invalidate pending profile
reads so a late response cannot restore another account's state. Onboarding is
saved in one PostgreSQL transaction, then authoritative records are reloaded.

The explicit session restore result controls startup; Supabase's `INITIAL_SESSION`
event is not treated as proof that restoration succeeded. Same-user refresh events
update the token and revalidate the account without unmounting an active screen.
New-user events clear the account; generation checks discard stale responses.
Onboarding form instances are keyed by user ID. Each save pins that session's JWT
in the request header and ignores completion after the form unmounts.

## Configuration and security

Only the Supabase URL and public anon/publishable key belong in `EXPO_PUBLIC_*`.
Never ship a service-role/secret key. Local `.env` files are ignored. Missing
configuration shows a setup state instead of starting a client with fake values.
Supplied invalid configuration stops Expo config/Metro/export before public env
inlining. Node-side `app.config.js` and runtime `env.ts` share a small checked
JavaScript validator without an additional config-loader dependency. Hosted URLs
require HTTPS; HTTP is limited to local/private development addresses.

Profile creation follows `auth.users` insertion. Owners can read/update their own
profile and learning record. Completion timestamps are server-controlled; direct
writes cannot claim completion without a valid learning record. Languages are
readable to authenticated users and editable only through privileged administration.
Deferred constraint checks also prevent deletion/transfer of the learning record
from leaving a completed profile, including during privileged maintenance. Seed
replay preserves catalog edits and deactivations. Database-validated timezones are
not rejected at the route gate merely because device timezone data is older.

AsyncStorage is persistent but not encrypted; never treat it as a vault. RLS,
token expiry/refresh and server validation remain the security boundary. Browser
storage requires normal XSS precautions before any future web release.

## Challenge authority

`get_or_create_today_challenge()` accepts no configuration or identity arguments.
`replace_daily_challenge_word(active_assignment_id)` accepts only the assignment ID.
Both verify `auth.uid()`, require completed onboarding and serialize on the owner's
profile row. Generation additionally locks the learning row before the challenge.
Uniqueness and deferred constraints protect the one-per-date and three-slot invariants.
All elevated helpers stay private with revoked client execution and empty search paths.

Shared concept/term tables provide linked language equivalents and independent
CEFR levels. Candidate selection uses exact eligibility, excludes all concepts in
the current challenge's history, and orders by unseen/oldest assignment, with random
ties. Selection holds catalog row locks until commit to avoid assigning terms that
are concurrently deactivated. Transactions roll back partial creation/replacement. Composite foreign keys protect
used term meaning/language identities, including concurrent catalog edits at stronger
isolation levels. Individual assignment deletion is blocked while its challenge remains.

The client uses typed, token-bound RPC services and validates response ownership
and complete card shape. User/profile/configuration changes remount Today state;
generation checks ignore obsolete requests. Focus and foreground events reload
from the backend. While Today is focused and active, a one-minute server refresh
handles date rollover without trusting device time or computing slot levels locally.
Background reads cannot swallow a Replace tap: a write supersedes their response.
Foreground/resume refreshes wait for a pending write to settle and then reload;
a token refresh reconciles that write through the latest same-account gateway. A lost replacement response is recovered
by refreshing; it does not blindly replace the next active word.

## Future boundaries

Supabase Storage and photos, submissions/completion, streaks, feed and ratings
remain future work. No camera action, storage bucket or Phase 4 feature exists.
