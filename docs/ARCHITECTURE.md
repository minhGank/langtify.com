# Architecture

Langtify uses Expo SDK 57, React Native, strict TypeScript, npm, and Expo Router.
Root `app/` contains routes/layouts; `src/` contains implementation. Metro and
Babel retain Expo defaults; `@/` maps to `src/`. iOS and Android are primary, with
web-compatible components and a shared `expo-router/js-tabs` layout.

## Phase 9 boundaries

- `src/components/ui/`: typed, accessible shared presentation primitives.
- `src/features/auth/`: session lifecycle, password/Google forms, navigation authority.
- `src/features/auth/oauth/`: PKCE staging, callback validation, guarded admission and browser/link adapters.
- `src/features/onboarding/`: validation and onboarding presentation.
- `src/features/challenges/`: Today cards, request lifecycle and safe error states.
- `src/features/photos/`: camera, metadata stripping, normalized drafts, preview and submission lifecycle.
- `src/features/vocabulary/`: bounded library/detail pages, account-scoped reads and photo expiry.
- `src/features/profile/`: account summary, progress and sign out.
- `src/features/ratings/`: typed semantic scale, validated summaries and rating controls.
- `src/features/discover/`: bounded public feed and account-scoped photo lifecycle.
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
URL, including a reachable LAN URL during local phone testing. Phase 7 adds a controlled feed RPC and signing action; no broader Storage or table RLS policy is added. The camera normalizes orientation, caps dimensions, re-encodes JPEG and strips
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

Comments, likes, followers, friends, DMs, notifications, leaderboards, achievements,
subscriptions and AI image validation remain out of scope. Phase 10 has not started.

## Google OAuth and session admission — Phase 5.5

The Google button asks a per-attempt Supabase client for
`signInWithOAuth({ provider: 'google', options: { skipBrowserRedirect: true } })`.
Expo AuthSession generates the redirect; Expo WebBrowser opens the system auth
session on native. Native Crypto supplies secure random bytes and SHA-256 if
WebCrypto is missing; authorization must use S256. There is no native Google SDK.
The SDK's explicit flow ID selects the saved verifier on code exchange, including
cold starts. It is kept locally so the callback stays exactly allowlisted.

`OAuthCoordinator` owns one pending login, a ten-minute technical expiry, durable
one-time exchange claims, in-memory generation guards, cancellation and safe errors.
Native attempts use namespaced AsyncStorage; web uses per-tab sessionStorage and
a full-page redirect. This short-lived expiry protects login state, not any product
calendar/date rule. Only the expected scheme/host/path and a single code are
accepted; implicit tokens, fragments and unexpected parameters are rejected.
The authorization URL must match this project's Supabase origin and Google endpoint.

`+native-intent.tsx` forwards callback input to the root bridge while returning a
clean Router path. The bridge accepts warm links and initial URLs; duplicate
delivery shares one exchange. Web removes callback query parameters on receipt.
The callback route is public solely for processing/login recovery; the original
protected groups still control onboarding and account screens.

Staging Auth persists PKCE material but discards its session writes. Its events are
never used by the UI. Only a current exchange with no existing main session may
call the main client's `setSession`. Password auth, sign-out and OAuth installation
share a mutation queue. The adapter withholds installation events until admission;
cancellation rolls back only the candidate account. A committing marker survives
interruption/failed rollback, quarantines its events and is cleaned on restoration.
Errors do not display SDK payloads or callback strings. Verifier cleanup is scoped
to an attempt; an obsolete response cannot delete a newer attempt's state.

The existing `useSessionState`, account loader, native foreground refresh and RLS
remain authoritative. Google metadata cannot mark onboarding complete. There are
no database/schema changes or client identity-merging rules. Native session
storage retains its existing AsyncStorage security characteristics; this phase
does not add encrypted storage or change password/email confirmation behavior.

## Phase 5.5 audit hardening

`index.js` loads the existing URL polyfill and `web-entry.web.ts` before Expo Router
captures its initial URL. Native uses the no-op adapter and `+native-intent` sanitation.
Malformed credential-bearing native links never enter Router parameters. Final root
bridge unmount invalidates its exchange; normal callback navigation preserves it.

`auth-session-storage.ts` guards SDK session writes/removals during OAuth admission.
Recovery identifies the Auth `session_id` so a newer login of the same UUID survives.
Cancelled pending records are marked invalid before deletion; auth mutations await
that cleanup. Pre-audit records without session IDs retain conservative recovery.
The normal native AsyncStorage adapter and browser localStorage/memory fallback
remain; token claims used for coordination do not replace server validation.

Web app auth mutations share a Web Lock and non-secret intent/commit metadata in
localStorage. Verifiers remain per-tab. SDK broadcasts wait for admission/rollback
and reload current session state before entering the provider; a surviving tab can
recover a terminated tab's partial install. Google requires secure browser storage
and Web Locks. See `PHASE55_AUDIT.md` for findings, regressions and acceptance limits.

## Personal dictionary reads — Phase 6

`get_my_vocabulary` is a stable, security-invoker RPC over completed submissions
joined to immutable assignment snapshots. It uses `auth.uid()` plus existing RLS;
there is no owner argument, definer elevation or new completion table. A single
statement returns total unique concepts, a latest-capture summary, a bounded page
and `has_more`. Concept ID changes the page from grouped concepts to individual
captures. Cursor ordering is `(submitted_at, id)` descending, with one extra row
for continuation. Concurrent changes are seen at each request's database snapshot;
refresh returns to latest rather than pretending pages share a frozen snapshot.

`photo-authority` adds `previews` for 1–24 distinct submission UUIDs: one owner/RLS
query and one Storage `createSignedUrls` request. Only completed owned rows qualify.
No path, transform, download option or TTL is accepted from callers. Unknown,
unavailable and foreign IDs all return a null preview. Individual missing objects
do not discard available images. Existing finalize/single-preview behavior remains.
The URL lifetime is fixed at 60 seconds; relative paths resolve against validated
public config and are checked against the account and submission path in the app.

The token-pinned gateway does not consult provider identity. Account-keyed screens
and generation guards invalidate reads/signing after account, token, filter, focus
or foreground changes. Only one 12-item page and its signed images remain in memory.
Focus/resume reload latest; every 45 seconds while active refreshes the current
page. A separate conservative 55-second timer clears images even if a refresh
stalls; time starts before signing to reject delayed expired responses. Blur and
background clear both history and photo state. Signed URLs are never stored or put
in Router params. The detail route requires the existing ready/onboarded gate.

Photo management returns through the navigation stack so dictionary screens can
refresh after visibility/deletion. It retains a Today fallback for direct entry.
No auth, XP, Storage policy, cleanup, dependency or provider-linking changes occur.

### Phase 6 audit lifecycle hardening

Read admission checks both foreground/focus and the current gateway identity.
Initial background mounts and token changes stay empty until active; obsolete
callbacks cannot issue a fresh old-query read. AbortSignals cancel RPC and function
requests on supersession, background, blur or unmount, in addition to generation
checks on responses. This preserves the provider-independent account boundary.

Preview elapsed time uses monotonic `performance.now()`, so changing the device
wall clock cannot retain an expired response. Each accepted signed batch creates
fresh image instances, allowing retries when the server returns the same still-valid
URL. Direct concept entry has a Vocabulary return fallback and normalizes UUID case.
Batch signing matches and deduplicates UUIDs case-insensitively, as PostgreSQL does.
No database schema, RLS, server TTL, grouping or filter rules changed. See
`PHASE6_AUDIT.md` for reproductions, tests and remaining live-pagination limits.

## Controlled public reads — Phase 7

`src/services/discover.ts` uses a nonpersistent client pinned to the active JWT.
`get_discover_feed` derives viewer identity from Auth and the target language from
saved onboarding data. A private eligibility view joins completed public submissions,
assignment snapshots, valid profiles/Auth accounts, version-bound verification and
Storage object metadata. Empty-search-path security-definer RPCs expose an explicit
minimal projection without broadening source-table RLS. No additional business
projection, dependency, state library or lifecycle mutation was introduced.

One query returns 12 rows plus `has_more` from a bounded lookahead. The exact server
microsecond timestamp and UUID form the next cursor. The feed retains a sliding
window of at most 24 rows; Load more evicts the oldest loaded page from memory (the
newest rows in feed order). Refresh returns to the beginning. FlatList anchors the
visible content during eviction; verify scrolling on both phones. Pages are live
reads, not a frozen snapshot: newly published earlier rows require refresh.

One `photo-authority` `feed-previews` request revalidates and signs the whole window.
The verified Auth user is passed to a service-only target lookup with the saved
language assertion; clients cannot call that lookup or choose an owner/path/TTL.
The function returns refreshed public metadata only for still-eligible signed IDs.
The client validates viewer/target, requested IDs, bucket/path and origin, and removes
ineligible items. Public signed paths are bearer capabilities that necessarily encode
the Storage object address; the feed RPC never exposes raw paths or owner UUIDs.

The screen is keyed by viewer and target. Focus, foreground and JWT gateway guards,
request generations and AbortController prevent stale responses/callbacks from
installing data. A 45-second visible renewal uses one batch; a separate conservative
55-second monotonic expiry clears URLs even if renewal stalls or device time changes.
New batches recreate Image instances and bypass cached responses. Blur/background
clears rows and URLs; resume refreshes newest. All state is in memory.

Public launch requires deployment, device acceptance and operational readiness of
the Phase 9 moderation, blocking and reporting controls described below.
Hosted deployment must apply the migration before deploying the matching function
and app. The private bucket and existing cleanup worker remain unchanged.

### Phase 7 audit hardening

The additive `20260915010000_phase7_audit_pagination.sql` keeps the same API and
eligibility while expressing a direct tuple bound for initial and later pages.
This lets a generic prepared plan seek the existing newest-feed index rather than
filtering all entries ahead of a deep cursor. The internal first-page infinity
sentinel is never accepted as a caller cursor. No data backfill, RLS or write changes.

Batch projection treats a missing/failed Storage signature for an eligible row as
503/retry, rather than silently advancing pagination without displaying that row.
Rows excluded by the authoritative eligibility lookup are still omitted normally.
Focus-local callback lifetime checks prevent queued obsolete AppState events or
interval callbacks from clearing or restarting a newer focus/gateway session.
See `PHASE7_AUDIT.md` for reproductions, final checks and remaining limits.

If revalidation empties a previously loaded window, retain its cursor and `has_more`
until Load more or explicit refresh. Renewal must not silently replay page one.

## Semantic rating authority — Phase 8

The new relational rating table is server-owned and RLS-protected with no client
raw-history or write grants. `rate_submission(submission_id,score)` derives Auth
identity and validates an exact integer 1–5 before storage. A private trigger locks
the submission row, then rechecks the shared Discover candidate view and saved
viewer target. This serializes votes against existing visibility/deletion writes
without changing those lifecycle functions or their profile/assignment lock order.
It also enforces self-rating denial, immutable rating identities and server timestamps.

No cached aggregate counters exist. One grouped query of current ratings restricted
to bounded page/window submission IDs supplies average/count/viewer score and a
`can_rate` flag. The composite primary key supports submission lookups and the rater
index supports Auth cascades. The feed retains its indexed timestamp/UUID keyset,
12-item pages and at most 24 retained cards; batch signing revalidates the same
summaries with its fixed 60-second capabilities. No per-card read/signing request.

`useDiscover` owns rating mutations alongside read generations so an older page or
signature cannot overwrite a newly saved score. Only one write runs at a time;
explicit refresh queues behind it. The submitting score is intent only; aggregate
values come from the RPC. After an uncertain error, revalidation can recognize a
committed vote without resending an older intent. Unavailable content clears to an
explicit refresh state. Photo expiry continues independently while a write stalls.
A 20-second transport deadline aborts and settles the local mutation even if the
transport ignores cancellation. It releases queued reads and follows the same
uncertain-response reconciliation, without replaying a score or changing vote policy.
Gateway/account/target/focus invalidation aborts and discards old responses. A server
transaction already admitted may still commit after network cancellation; later
reads reconcile it. Across devices, database serialization decides the current vote.

Deploy the Phase 8 migration before the updated photo-authority function (including
feed-photos.ts) and app. The function return projection gains only four rating fields.
No dependencies, authentication, Storage policies, XP or challenge authority change.

The Phase 8 audit also checks the actual nested feed query plan in a disposable
database: one indexed aggregate under a generic plan with 50,000 unrelated votes.
The bound applies to selected submissions; work for a heavily rated photo still
grows with its vote count. See [Phase 8 audit](PHASE8_AUDIT.md).

## Phase 9 safety boundary

Migration `20260917000000_phase9_safety.sql` adds private account revision/restriction,
moderator-membership and submission-removal tables plus RLS-protected blocks,
reports and immutable audit events. Ordinary table privileges are revoked; controlled
security-definer functions derive actors from Auth and use empty search paths.
Moderator claims from client metadata are never consulted. Operational provisioning
and revocation are documented in `MODERATION.md`.

Mutating safety operations acquire account revision locks in UUID order. Rating
admission obtains the same locks before its submission lock. Restrictions and public
removal serialize with rating/block writes; revision changes reject obsolete
Repeatable Read transactions. The audited finalize/visibility bodies are moved into
private functions, with public admission wrappers acquiring account locks before
existing profile/assignment/submission locks. Wrappers leave private learning and
completion semantics intact; existing session tokens do not bypass restrictions.

The shared candidate view excludes restricted owners and removed submissions.
Viewer admission denies restricted callers; feed and signing add indexed mutual
block checks. No raw profile/submission/Storage RLS is widened. Page fields stay
minimal, timestamp/UUID cursors stay deterministic and existing grouped ratings
are retained. Public removal never calls deletion or modifies XP sources.

Reports accept a public submission context and submission/user target kind; the
owner is resolved server-side without adding owner UUIDs to feed cards. Open-report
uniqueness prevents duplicate active cases. Moderator mutations use scoped request
UUIDs and immutable events; reusing an old action ID cannot undo a later restore.
Queue, block list and audit reads return at most 20 rows plus bounded lookahead.
Reports/audit identifiers intentionally survive hard account/content deletion.

`photo-authority` adds only `moderation-preview`: verified Auth caller, backend role
check, existing report context and version-verified completed image. A service-only
lookup returns the eligible path, and the function fixes a 60-second signature.
It may review a previously reported photo now private/removed. No caller path,
viewer override, TTL or arbitrary private photo is accepted. Existing public and
owner signing paths remain distinct and retain prior authority.

`src/features/safety` implements Discover action dialogs, blocked-user management,
backend-gated moderator navigation and case review. `src/services/safety` pins the
captured JWT, validates viewer/target/page/capability responses and rejects already
cancelled follow-up calls. `useSafetyTask` serializes local work, bounds waits to 20
seconds and discards obsolete account/focus/background results. No automatic write
replay. Moderator action retries preserve request UUID and immutable intent. Photo
expiry uses an independent monotonic deadline; role availability is rechecked while
the moderator screen is active. Each user/token has a separate component lifetime.
Queue rows and their cursor clear before changing status/page or refreshing, so an
uncertain response cannot mix filters. Image-error and expiry callbacks are bound
to their exact preview instance and cannot clear a newer one. See `PHASE9_AUDIT.md`.

Deploy the migration before the matching function and app. No new dependencies or
custom backend. Public launch still requires deployment, device/admin acceptance,
moderator provisioning and operational readiness rather than merely passing exports.
