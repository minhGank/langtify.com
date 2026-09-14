# Decisions

## 001 — Stable Expo-managed foundation

Accepted for Phase 1. Start from `create-expo-app@latest` with the stable default
template. On 2026-09-12 npm resolved Expo 57.0.22, Router 57.0.21, React Native
0.86.3, and React 19.2.3. Preserve SDK-compatible ranges and commit the npm
lockfile. Node 24 LTS is the development baseline. No beta/canary or manual
downgrade to an older Expo SDK is used.

Reference: [Expo project setup](https://docs.expo.dev/get-started/create-a-project/)
and [SDK 57](https://docs.expo.dev/versions/v57.0.0/).

## 002 — Root routes and a shared tab layout

Accepted. Keep routes in `app/` and implementation in `src/`. Use
`expo-router/js-tabs` for the four mobile-first tabs with web compatibility.
Use Ionicons for consistent cross-platform navigation icons. Remove unused
template demos and their direct dependencies. Keep Expo defaults for bundling
and generated native projects.

## 003 — Phase 1 minimal UI and state (extended by 008)

Accepted. Share only text, screen spacing, placeholder composition, and colors.
Follow the system appearance and allow scalable text. There is no global state
library, fake data, user preference storage, or business logic.

## 004 — Phase 1 environment structure (superseded by 008)

Accepted. Supply `.env.example`, ignore local environment files, and reserve
`src/lib/env.ts` for future typed validation. No API URL, Supabase key, or arbitrary
environment enum is required for a shell that has no integrations.

## 005 — Lightweight verification

Accepted. Use Expo's ESLint config, separate Prettier, and `jest-expo` with React
Native Testing Library. Jest 29 and Testing Library 13 align with this SDK's
preset and synchronous Router test renderer. Navigation smoke tests check the
actual layouts, tab presses, headings, and direct routes. Production bundle
export covers iOS, Android, and web configuration; device tests and signed
native builds are separate checks.

ESLint 9 is retained because Expo SDK 57's React lint plugin fails under ESLint 10
(`contextOrFilename.getFilename is not a function`). Upgrade it with a compatible
Expo lint configuration; do not disable the React rules to accommodate ESLint 10.
The TypeScript import resolver is an explicit development dependency so the
import plugin can resolve it from the project root during dependency inspection.

## 006 — Phase 1 deferral (Supabase/auth superseded by 008)

Accepted. Supabase/PostgreSQL, Auth, Storage, vocabulary challenges, camera,
submissions, streaks, feed, and ratings are future scope. Documentation may
capture intent and questions but must not introduce unstated product rules.
No release identity or deployment account is selected in Phase 1.

## 007 — Langtify naming

Accepted. Use **Langtify** as the display name, `langtify` as the npm package name,
Expo slug, and URL scheme, and `langtify.com` as the domain reference. The existing
workspace folder `/Applications/langtify.com` is intentional and remains in place.

Native application identifiers are not configured in Phase 1; this rename does
not add them. When release configuration is introduced, use `com.langtify.app`
for both the iOS bundle identifier and Android package name. Naming changes do
not alter architecture, routes, dependencies, or Phase 1 functionality.

## 008 — Phase 2 authority and onboarding

Accepted. Implement Supabase/PostgreSQL as authoritative backend, email/password
authentication and onboarding only. Supabase Storage is reserved for later photos.
Sessions persist through the supported React Native AsyncStorage adapter; protected
routes depend on restored session and persisted profile/learning data. Client route
guards complement server RLS rather than replacing it. No global-state library.

Use an atomic database RPC for profile, learning record and completion. Usernames
are normalized to lowercase and limited to 3–30 ASCII letters/digits/underscores,
starting with a letter/digit, with case-insensitive database uniqueness. Store the
validated IANA timezone, not an offset. V1 has one learning record per user.

The authoritative catalog initially includes English and French. Password policy
and email confirmation are configured by Supabase, not invented by the client.
Signups that require confirmation show neutral check-email guidance, including
Supabase's intentionally obfuscated duplicate-account responses.

## 009 — Confirmed future product rules

Daily challenges contain three photographable words: review one CEFR level below,
target at current level, stretch one above. A1 uses A1/A1/A2; C2 uses C1/C2/C2.
Replacements preserve slot level. One completed daily word maintains a streak.
Submissions default private with public/private options; future community semantic
ratings are 1–5. These decisions are documentation only in Phase 2. Do not add
unrequested timing, replacement-limit, rating or moderation rules.

## 010 — Phase 2 audit hardening

Accepted within the existing Phase 2 requirements. Preserve the original migration
and add a deferred reciprocal completion invariant rather than rewriting applied
schema history. Seed replay preserves authoritative catalog edits. Migrations
refuse invalid existing data for investigation instead of inventing replacement data.

Use explicit session restoration errors, retain same-user screens during routine
refresh, and discard old-user drafts/responses on account changes. Bind onboarding
RPC requests to the submitting session's JWT; ownership still comes from verified
`auth.uid()` at the backend. Stored timezone validity comes from PostgreSQL, not
the device's potentially different timezone catalog.

Reject unsafe supplied public configuration before Expo bundles it, sharing a
checked JavaScript validator with the runtime. Hosted connections require HTTPS;
local development can use loopback/private addresses. This adds no dependency,
authentication method, product policy, or Phase 3 functionality.

## 011 — Phase 3 shared semantics and challenge authority

Accepted. One shared concept table represents meanings; one primary term per
concept/language supplies the displayed word, CEFR and reference equivalent.
Language levels are independent. Ambiguous meanings are separate concepts, not
alternate rows distinguished only by spelling.

The backend derives the user's local date from server time and their saved IANA
timezone. Slot levels are review/target/stretch with clamped A1 and C2 boundaries.
A profile/date has one immutable configuration snapshot. A same-day settings change
reuses that snapshot; a timezone change may select a different local calendar date.
Displayed terms are also snapshotted to preserve prior assignments through edits.

Selection excludes all concepts used in that challenge, prefers never-assigned
concepts, then least recently assigned, and randomizes ties. Exact eligibility is
required; insufficient pools fail atomically. Replacements preserve the original
slot/configuration and history. Already-retired IDs return a controlled stale error
rather than silently replacing a newer assignment. No daily count or historical
age restriction is added beyond the requested ownership/active-assignment rules.

Transactions lock the owner profile, then learning/challenge state in a consistent
order. Unique indexes and deferred checks enforce one profile/date challenge,
three active slots and no repeated concepts. Client writes go only through hardened
RPCs. Native/client state is scoped to account and learning configuration; server
refresh on focus/resume and once per active minute handles day rollover.

The 36-concept, 72-term seed is development data with provisional CEFR examples.
No dependencies or Phase 4 features are added.

References: [PostgreSQL locking](https://www.postgresql.org/docs/current/explicit-locking.html),
[constraint triggers](https://www.postgresql.org/docs/current/sql-createtrigger.html),
and [Supabase functions](https://supabase.com/docs/guides/database/functions).

## 012 — Phase 3 audit integrity and request ordering

Accepted as corrections within Phase 3. Keep saved term meaning/language links valid
with composite foreign keys and explicit language snapshots; snapshot text and CEFR
remain independent of later catalog wording/regrading. Preserve individual assignment
history while allowing existing parent/account cascades. Reject invalid private slot
inputs rather than silently clamping unknown values to C2.

Reads must not suppress user replacements or run ahead of a pending write on resume.
A write supersedes an older background read; foreground refresh queues behind the
write and reconciles through the latest token. Existing account/configuration keys
continue to discard prior-account state. No selection, replacement-count, settings,
timezone or retention product rule changes.

The installed CLI was experimentally confirmed to require explicit transaction
boundaries for LOCK TABLE. The new audit migration includes them. Only the older
migration with the reproduced bootstrap failure receives a BEGIN/COMMIT wrapper;
its SQL body stays byte-for-byte unchanged. An initially proposed blanket change
to old migrations was not performed. Disposable-database tests cover the ordered
migration chain, nonempty backfill and refusal of inconsistent history.

## 013 — Camera-first submissions with private Storage

Accepted for Phase 4. Use the SDK-compatible `expo-camera` `CameraView`,
`expo-image-manipulator` and `expo-file-system`. No picker/gallery, microphone,
location permission, image analysis or new state library is added. Capture is
processed for orientation, decoded/re-encoded as JPEG at quality 0.8, resized to
at most 1600 pixels on the longest side without upscaling, and stripped of all
JPEG APP/comment metadata. Reject malformed or greater-than-5-MiB results. Preview
must load before Submit is enabled; capture never triggers upload automatically.

A private `challenge-submissions` bucket stores JPEGs at server-derived
`<user-id>/<submission-id>.jpg`. The database defaults to private. Public visibility
records future feed eligibility; it grants nobody else read or mutation access in
this phase. Owners receive 60-second signed preview URLs, kept in memory only.
Visibility changes never move files. These URLs are bearer capabilities until
expiry; changing visibility cannot revoke bytes already downloaded.

## 014 — Recoverable submission and deletion lifecycle

Accepted. Database and object storage cannot share one client transaction.
`pending -> completed -> deleting -> deleted` is a server-controlled lifecycle;
pending may also transition directly to deleting. Reserve is idempotent per active
assignment, and finalization verifies Storage metadata before completion. Retrying
completed finalization returns the original result without changing visibility.
At most one non-deleted reservation/submission occupies an assignment. Pending or
deleting operations temporarily block replacement as well as completed photos,
so an upload cannot become detached from its assigned vocabulary. Discarding a
pending upload releases this lock after cleanup.

Assignment/owner/concept/term/text relationships are copied and validated in SQL;
clients cannot supply them or completion state. Existing assignment history/date
is authoritative. A previously started upload may finish after midnight for its
original still-active assignment; no unrequested same-day cutoff was introduced.
The UI starts new capture from Today. Upload reservations expire after 24 hours
as a technical recovery lease, not a daily challenge or replacement-count rule.

Deletion records intent, removes bytes through Storage API, then retires the row.
The assignment remains unavailable for replacement/new capture until deletion
finishes. Soft-deleted rows retain IDs and immutable vocabulary metadata for
idempotent retries; account/challenge deletion can still cascade. A private cleanup
queue survives those cascades. A server-only maintenance command claims expired
uploads/deletions, removes bytes, and finishes retirement; its orphan sweep also
handles late-arriving files. Run it hourly on a trusted runner, with monitoring.
No always-on custom backend or additional infrastructure library is introduced.
The supplied cron example must be installed for each deployed environment.

Native normalized drafts live in an account/assignment-scoped cache with unique
URIs to avoid stale image caches; loading removes that account's drafts older than
24 hours and malformed interrupted writes. Retake/discard/success remove drafts.
OS cache eviction can require a retake. Web keeps unuploaded drafts in memory;
uploaded reservations recover on every platform. Camera/upload components remount
on account/assignment changes, pin network requests to the captured account token,
and stop later upload/finalization stages after unmount. Same-account token refresh
reconciles through the latest gateway.

References: [Expo Camera](https://docs.expo.dev/versions/v57.0.0/sdk/camera/),
[Expo ImageManipulator](https://docs.expo.dev/versions/v57.0.0/sdk/imagemanipulator/),
[Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control).

## 015 — Trusted image verification and Storage commit guards

Accepted during the Phase 4 audit after reproducing completion with arbitrary bytes,
post-deletion upload-token replay, and caller-selected one-year signed reads. Add a
small Supabase Edge Function for actual JPEG decoding and fixed-lifetime signing;
this is technical enforcement of Phase 4, not image-content/AI validation or Phase 5.
It uses the existing Supabase SDK and server-only `jpeg-js` 0.4.4, pinned with a Deno
lockfile. No mobile dependency is added. Decode limits are 5 MiB, 1600 pixels per
edge, 2.56 MP and 64 MiB decoder allocation. Reject APP/comment/trailing metadata
rather than replacing pixels after the user reviewed them. Camera provenance is
not attestable from an uploaded JPEG.

Store a private verification receipt bound to the Storage object ID and version.
Only service callers can attest; owner finalization still uses the user's JWT.
A Storage commit trigger denies retired/expired reservation writes, owner mismatch,
content mutation and deletion of a live photo. This is necessary because Storage's
initial RLS permission test finishes before the upload commits. It also protects
against old upload capabilities and stale cleanup jobs. All Phase 4 predecessors
remain unchanged; unverified completed photos require a reviewed backfill before
applying the audit migration. Never manufacture receipts from MIME metadata.

Deny ordinary Storage signing and issue only 60-second preview capabilities in the
function after Auth and owner-RLS checks. Returning a relative signed path avoids
leaking internal local service hostnames into phone URLs. Already-issued links cannot
be revoked by this policy change; deployment must account for their previous expiry.
Decoded bytes already downloaded cannot be recalled.

Cancel preprocessing before it writes or prunes drafts when the camera/account screen
becomes obsolete. Exact-URI cleanup prevents old work from deleting newer drafts;
retake/capture invalidates pending draft reads. Database recovery remains authoritative.

References: [Supabase function authentication](https://supabase.com/docs/guides/functions/auth),
[Storage access control](https://supabase.com/docs/guides/storage/security/access-control),
[JPEG decoder options](https://github.com/jpeg-js/jpeg-js).

Cleanup claims record a last-attempt time and skip already-queued work during
discovery. Unattempted jobs run before failed retries, preserving durable retry
without letting one persistently failing batch strand later deletions.

## 016 — Server-authoritative reversible XP and streaks

Accepted for the Phase 5 request. Keep the existing photo lifecycle and add an
atomic completion/deletion trigger, private source facts/projections and an
owner-readable append-only signed ledger. Exact rewards: word 10; full challenge
10; streak milestones 3/7/14/30/60/100 days earn 10/25/40/75/125/200. No multiplier.
A source balance can only be zero or its fixed reward. Repeated restoration uses
new signed revisions of the same source; it cannot farm a positive-only lifetime
counter. Level derives from cumulative `25 × L × (L + 3)`, starting at zero.
The supplied formula resolves the inconsistent illustrative 620-XP level example.

Use server finalization time and the current persisted IANA timezone, snapshot both,
and qualify distinct local completion dates. This preserves Phase 4's interrupted
upload recovery after midnight without adding a submission deadline. Credit ends
when deletion finishes, consistent with existing completion/Storage retirement.
Historical deletion recomputes valid counts and longest/current streaks and can
lower level. Visibility has no XP effect.

Milestones record original qualifying windows only when a calendar date first
qualifies at an exact threshold. Historical deletion revokes broken windows and
never creates retrospective awards from split runs. Same-day restoration reuses
existing eligibility. A later occurrence can earn each threshold again. If timezone
travel joins runs, retain only the earliest eligible reward for each threshold in
the merged run. This deletion interpretation was reported before implementation;
no achievements or timezone-change restrictions were added.

Serialize owner mutations and change a private revision row to detect stale
REPEATABLE READ snapshots; cleanup follows the same lock order. Reconciliation is
synchronous and indexed by owner. It scans that owner's history; monitor latency
as histories grow before introducing a more complex incremental projection.
Legacy backfill replays completions and deletions chronologically. Its only known
timezone is the saved challenge timezone, so provenance explicitly records that
limitation. Deployment needs backup and migration timing review for existing data.

## 017 — Phase 5 audit: durable identities and exact level boundaries

Accepted as correctness fixes within the existing Phase 5 rules. Date presentation
must not define XP identity: format milestone dates explicitly from a timestamp
without timezone. The original `date::text` created a second source when a database
session changed DateStyle; an implicit cast through a session timezone can also
shift skipped dates. Existing canonical keys retain their exact spelling.

Treat numeric square root as an estimate for the level, then compare exact cumulative
thresholds. This preserves the requested formula at very large bigint totals where
rounding could otherwise advance the level one XP early.

Use a separate additive migration. Preserve every valid existing event and reject
ambiguous source aliases or ledger/projection disagreement before any replacement.
Those conditions need reviewed signed reconciliation, not destructive history edits.
No rewards, milestone occurrence rules, deletion policy, timezone-change restrictions,
client architecture or future-phase features change.

## 018 — Supabase Google OAuth with guarded PKCE admission

Accepted for Phase 5.5. Use the existing Supabase authority with Expo AuthSession,
WebBrowser and linking, not another auth system or native Google SDK. The hosted
Langtify Dev provider is already configured; its Google client secret remains in
Supabase. Preserve `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
Do not change local provider settings or enable manual identity linking.

The installed auth SDK supports S256 PKCE with persisted per-flow verifier IDs.
A dedicated, short-lived exchange client saves only PKCE material. This is an
adapter around the existing auth pipeline, not a replacement provider or user
store: directly exchanging on the shared client would emit/persist an obsolete
session before a caller could reject it. The shared mutation queue, admission
filter and interrupted-commit recovery close that race while retaining the
existing session state machine, refresh and onboarding validation.

The `langtify` scheme returns to `langtify://auth/callback`. Expo Go is unsupported;
add SDK-compatible `expo-dev-client`, `expo-web-browser`, `expo-auth-session` and
`expo-crypto`. Crypto prevents the SDK's insecure-random/plain-PKCE fallback on
native. Native IDs `com.langtify.app` make local development builds concrete;
generated native projects remain ignored. Web uses a full-page redirect with
per-tab PKCE storage and requires its exact callback in the hosted allowlist.

Supabase alone handles supported automatic linking for compatible verified email
identities. The app does not merge users, infer identity from email, or create a
second profile on sign-in. Google account selection is requested each time;
Langtify sign-out ends the local Supabase session, not the Google account. Apple
Sign-In remains deferred until Apple Developer membership is available.

References: [Supabase native deep linking](https://supabase.com/docs/guides/auth/native-mobile-deep-linking),
[Expo WebBrowser SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/webbrowser/),
[Expo AuthSession SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/auth-session/),
[Supabase identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking).
The Google G asset comes from Google's
[sign-in branding guidance](https://developers.google.com/identity/branding-guidelines)
([original asset](https://developers.google.com/identity/images/g-logo.png)); preserve its colors and proportions.

## 019 — Phase 5.5 audit: guard persistence, session identity and early routing

Accepted as correctness/security fixes without changing authentication or product
policy. Event filtering alone is too late: the installed SDK persists and broadcasts
before `setSession` returns. Guard the shared storage adapter during admission and
coordinate browser mutations/broadcast handling across tabs using Web Locks and
non-secret intent/commit records. Retain per-tab PKCE storage and the existing
password fallback when persistent browser storage is unavailable.

Match interrupted installations by Auth session ID, not merely user UUID. Preserve
newer sessions of the same owner. Persist cancellation before removing pending
records; auth mutations wait for cleanup. Move web callback sanitation to Expo's
supported custom entry point so Router never captures its code; native malformed
credential-bearing links also receive a clean error route. No dependencies, schema,
identity-linking configuration or external credentials change. See `PHASE55_AUDIT.md`.

## 020 — Personal dictionary from surviving submission snapshots

Accepted for Phase 6. Group by semantic concept UUID across dates/language pairs,
not spelling or current catalog. Use the latest completed submission for each
card and preserve every earlier valid capture in detail. Search target/reference
text and CEFR on the latest card to keep filtering aligned with what is displayed;
detail remains unfiltered. No category snapshot exists, so omit category filtering.

Use an indexed security-invoker read RPC, JWT-derived ownership, bounded keyset
pages and exact unfiltered concept count. No independent completion projection,
new global state, dependency or auth changes. Batch owner previews through the
existing trusted function and Storage API with its existing fixed 60-second TTL.
Clear page/image state on account loss, blur/background, and stale request generations.

Hide deleting captures immediately because their images may already be gone.
This is dictionary presentation only: Phase 5 credits still reverse when deletion
finishes. Reuse photo detail for all management and return through the stack.
Signed URLs remain short-lived bearer capabilities; no public read policy is added.

References: [Expo Router SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/router/),
[Supabase batch signing](https://supabase.com/docs/reference/javascript/storage-from-createsignedurls).

## 021 — Phase 6 audit: admit only current visible reads and retry photo instances

Accepted as correctness fixes within Phase 6. Gate new reads as well as their
responses: a retained callback from an old gateway must not start a current request,
and background mounts/token changes must not reload cleared private state.
Cancel obsolete HTTP work while retaining generation/owner checks as authority.
Use monotonic elapsed time for client preview expiry; server signing still fixes
60 seconds. Recreate image instances for accepted preview batches so an unchanged
signed URL does not preserve an earlier image-load failure. Canonical UUID comparison
fixes uppercase inputs and duplicate aliases without changing access rights.

Preserve latest-capture filtering, live keyset pages, private Storage, existing
photo management and provider-independent UUID ownership. No database or product
policy change was necessary. Audit tests retain microseconds, same-time ties,
ambiguous spellings, cross-user mixed batches and actual batch expiry/renewal.
References: [React Native AppState](https://reactnative.dev/docs/appstate),
[Expo Router SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/router/).

## 022 — Controlled public vocabulary feed without broadening source access

Accepted for Phase 7 with explicit user authorization to update AGENTS and extend
public-photo signing. Preserve every earlier private management, Storage, RLS,
authentication, submission, XP/streak and vocabulary authority.

Public completed captures become readable only through the target-filtered Discover
projection and trusted batch signer. An eligible owner has an onboarded username and
nondeleted/unbanned Auth account; a viewer must also have saved learning settings.
Existing verified object ID/version must match. Cards use historical vocabulary and
CEFR, original submission date and current public username; no viewer-language
retranslation or public progress/profile page is added. Repeated captures are
separate feed items. The owner is included. Publishing preserves the original date.

Use descending timestamp/UUID keysets, one bounded query and one batch signing call,
with a 24-item client window to bound memory and renewal cost. Feed reads bypass
owner RLS only inside a minimal definer projection with explicit grants and fixed
search paths. Underlying rows and mutation rights remain owner-only. Signing
rechecks the same eligibility and saved target, never accepts arbitrary paths or
caller TTLs, and returns only public fields plus fixed 60-second bearer capabilities.

Privacy changes affect subsequent eligibility snapshots; an in-flight read may
observe the pre-change state and an issued URL retains its expiry. There is no
instant revocation, realtime refresh or recall of downloaded images. Account/target
keys, gateway guards, cancellation and monotonic preview expiry preserve isolation.

Ratings, blocking and reporting are later work. Public production launch is gated
on moderation/safety functionality including blocking and reporting. No Phase 8,
social graph, interactions, recommendations or ranking is authorized here.

## 023 — Phase 7 audit: indexed cursor seeks and explicit recovery

Accepted as correctness/maintainability fixes without product-policy changes.
The optional-cursor OR predicate became a filter under a forced generic plan,
allowing a deep page to rescan newer entries. Replace it in an additive migration
with a direct row bound and a first-page sentinel. All external bounds, target
eligibility, immutable timestamps and public projections remain the same. Verified
with nested EXPLAIN of the real RPC, not only a hand-copied approximation. See
[PostgreSQL prepared plans](https://www.postgresql.org/docs/current/sql-prepare.html).

A partial Storage signing error must not masquerade as an ineligible row. Only the
eligibility query may omit a capture; an eligible target with no successful signature
causes a retryable response. This avoids silently advancing past unseen captures.
The client clears failed state and explicit retry starts newest, as before. Short
capability lifetime and visibility-snapshot semantics remain unchanged.

Guard event callbacks by their focus lifetime, as well as guarding requests by
viewer/gateway/generation. Removing a listener alone must not let an already retained
callback clear or restart a subsequent session. Tests explicitly invoke stale
callbacks after gateway replacement and after same-gateway blur/refocus.

No Phase 8, public profiles, mutation permissions, RLS widening, new dependencies,
identity behavior or completion/XP/streak rules change.

The audit also reproduced implicit page-one restart after renewal removed every
retained item. Keep the cursor for that empty window; only an initial empty feed
may poll page one. Load more continues from the saved position and explicit refresh
returns to newest. Empty-window copy distinguishes available pagination.

## 024 — Semantic ratings as one authoritative current vote

Accepted under direct user approval of the Phase 8 proposal, including AGENTS scope.
Use the exact 1–5 vocabulary-match scale, not stars or photography/popularity criteria.
Reuse Discover eligibility and saved target filtering; self-rating is forbidden.
Only an Auth-derived RPC may mutate a rating, and a database trigger repeats authority
checks under the submission lock shared with visibility/deletion. Numeric input is
validated before integer conversion. One composite-key row records each current
viewer vote; same-score retries are logically unchanged. Last serialized accepted
write wins across devices; no artificial client-clock ordering or new rate limit.

Use grouped, indexed aggregates for the bounded page/window instead of a mutable
counter projection. No raw rating history is exposed. Feed and signing add average,
count, viewer score and can_rate, preserving public metadata minimization and private
Storage. Rating intent is immediate in the UI, but selections/aggregates reconcile
with server results. Reads cannot supersede writes; uncertain responses cause reads
and explicit retry rather than automatic replay. Retain audited stale-context and
monotonic photo-expiry guards.

Private visibility and soft retirement retain votes while removing public exposure.
Hard submission/owner or rater deletion cascades them; resubmission starts unrated.
Previously valid votes persist through later rater bans or learning-setting changes;
no retrospective invalidation policy was requested. Ratings do not affect XP, streaks,
completion, feed ordering, notifications or rewards. No moderation/reporting/blocking
or other Phase 9 feature is implemented, and the public-production launch gate remains.

## 025 — Phase 8 audit: bounded rating waits and stronger regression evidence

A transport that never settled left every rating control disabled and explicit
refresh queued forever. Use a 20-second local deadline, abort the request and settle
independently of transport cooperation. Treat timeout as an uncertain outcome:
release reads, reconcile server state and permit explicit retry. Never automatically
replay an older score or assume cancellation undoes an accepted server transaction.
Tests reproduce the failure, recover an already committed vote without replay and
discard a late response after a newer vote or account's selection.

No database-policy defect was reproduced and no migration is added. Extend invalid
input/eligibility coverage, stale REPEATABLE READ visibility races and feed-order
invariance. The actual feed RPC uses one indexed rating aggregate with 50,000
unrelated votes under a generic plan; the test runs in a disposable database with
rolled-back synthetic rows and privileged instrumentation. Suites using shared
Auth/photo/catalog fixtures must run sequentially.

The stale-snapshot test asserts the database's existing serialization failure,
consistent with [PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html).
This audit changes no ratings, lifecycle, XP/streak, authentication or privacy rules
and introduces no Phase 9 functionality. See [Phase 8 audit](PHASE8_AUDIT.md).
