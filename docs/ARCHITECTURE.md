# Architecture

Langtify uses Expo SDK 57, React Native, strict TypeScript, npm, and Expo Router.
Root `app/` contains routes/layouts; `src/` contains implementation. Metro and
Babel retain Expo defaults; `@/` maps to `src/`. iOS and Android are primary, with
web-compatible components and a shared `expo-router/js-tabs` layout.

## Phase 5 boundaries

- `src/components/ui/`: typed, accessible shared presentation primitives.
- `src/features/auth/`: session lifecycle, email/password forms, navigation authority.
- `src/features/onboarding/`: validation and onboarding presentation.
- `src/features/challenges/`: Today cards, request lifecycle and safe error states.
- `src/features/photos/`: camera, metadata stripping, normalized drafts, preview and submission lifecycle.
- `src/features/profile/`: account summary, progress and sign out.
- `src/features/progress/`: backend progress reads, display and XP receipt feedback.
- `src/lib/`: validated public configuration and a typed Supabase client.
- `src/services/`: database operations, including transactional onboarding and challenge RPCs.
- `src/types/`: database types matching migrations.
- `supabase/`: local Auth/Storage configuration, versioned migrations, seed and SQL tests.
- `supabase/functions/photo-authority/`: Auth-verified JPEG attestation and fixed-lifetime preview signing.
- `scripts/cleanup-submissions.mjs`: server-only scheduled Storage cleanup; never imported by the app.
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

## Photo authority and recovery

The protected `/photo` route takes only an assignment ID. Its account-keyed content
loads the owner/assignment relationship from an RPC before showing camera controls.
A separate non-persisting Supabase client pins all photo RPC/Storage calls to the
submitting JWT. Late responses cannot populate another account; unmount stops
subsequent upload stages. Camera mounts only while focused/foregrounded. Foreground
refresh waits for a write to settle; signed previews refresh while visible.

Database and Storage operations form a recoverable sequence, not a distributed
transaction: reserve -> upload -> finalize. SQL and partial uniqueness control
completion; a private, version-bound receipt proves that the Supabase function decoded
the stored JPEG, bounded its dimensions/memory, and rejected metadata before completion. Storage inserts require the exact owner reservation; a commit-time trigger rechecks
that lease even for elevated Storage writes and old signed upload capabilities; completed images
cannot be overwritten or directly deleted. Delete intent revokes upload access,
then Storage API removal precedes database retirement. A private durable queue and
orphan scan repair interrupted deletion, abandoned uploads and account cascades.
The server-only cleanup command must be scheduled hourly; see README and the cron
example. It uses a privileged key outside Expo, counts-only logging and retryable jobs. Failed jobs rotate behind unattempted work,
so a poison job cannot monopolize later cleanup batches.

The bucket stays private for both visibility values. Database records contain object
paths; the owner receives a 60-second signed URL from the Auth-verified function.
Direct Storage signing is denied, so a caller cannot extend that lifetime. The function
returns only the signed relative path; the app resolves it against its validated API
URL, including a reachable LAN URL during local phone testing. No feed-read policy
exists. The camera normalizes orientation, caps dimensions, re-encodes JPEG and strips
all APP/comment segments before preview/upload. Cancelled camera/preprocessing work cannot replace or delete newer drafts.
Native draft cache is account scoped;
web retains pre-upload previews only in memory. No location permission is requested.

Unfinished photos on Today also lists owner-only pending/deleting operations from
earlier dates, so restart or midnight does not strand an uploaded photo. This
recovery read is independent of current challenge generation; it is not a gallery
or feed.

## Progress authority

The submission status trigger records immutable completion-time facts and reconciles
XP inside the same transaction as verified finalization or finished deletion. A
failure rolls back both completion and XP. Source balances are private projections;
public append-only signed events are the authoritative total. There is no client
XP mutation endpoint or client-generated reward amount. Owner-only RLS protects
history; empty-search-path definer reads expose only the caller's summary/receipt.

Writers serialize on the owner profile and update an owner progress revision row.
The latter makes stale REPEATABLE READ writers fail with a serialization error
instead of reconciling old facts. Cleanup acquires owner/assignment locks in the
same order as finalization. Source revision uniqueness and private source balances
prevent duplicate credits. Retrying the existing lifecycle RPCs is sufficient;
no asynchronous XP worker or distributed credit transaction is needed.

Distinct active completion dates are grouped into consecutive date runs. Milestone
candidates retain qualifying windows and are reconciled against those runs. Sources
can be credited, reversed and restored; the signed sum remains authoritative.
Read operations derive the current streak using server time and the latest saved
timezone, with historical completion dates unchanged. Details are in PRODUCT.md.

Token-bound progress services validate response ownership and numeric shape.
Account-keyed panels discard superseded/unmounted reads, refresh on focus/resume
and every active minute, and show a retry state on failure rather than invented
zero XP. Photo receipts do not optimistically award XP. Modest static feedback and
an accessible progress bar need no animation or global-state dependency.

## Future boundaries

Feed, ratings, comments, followers, notifications, leaderboards, achievements,
subscriptions and AI image validation remain out of scope. Phase 6 has not started.
