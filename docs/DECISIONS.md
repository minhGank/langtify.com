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
This original curve is superseded by QA #32 / decision 050; reward rules remain.

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

## 026 — Backend safety with separate public eligibility

Accepted under explicit direct approval of the Phase 9 proposal and AGENTS update.
Use private directed blocks with mutual public exclusion, controlled reports and
backend-only moderator membership. Resolve card targets through submission context,
not public owner UUIDs or client-supplied identities. Restriction is public-access
state rather than Auth account deletion, preserving private learning and sessions.
Removal is a separate flag rather than submission deletion or XP reversal.

Retain existing ratings without individual blocked-user surfaces. Retain case and
audit identifiers through deletion; define any future retention/erasure process
separately rather than silently cascading history. Report categories and 500-character
details are technical bounds; one open report per reporter/target prevents duplicates.
No reputation scoring or unrelated rate-limit policy is added.

Moderator writes require current backend membership and an immutable audit event;
request UUIDs make uncertain retries safe without replaying an older action after a
restore. Ordered per-account revision writes serialize block/restriction/removal and
rating/publication admission, including stale snapshot rejection. Existing lifecycle
bodies retain their authority behind public restriction wrappers. No global lock,
client role boolean, new state library or custom backend is introduced.

Moderators may inspect only the verified image attached to an existing case, including
a later-private/removed photo, through fixed 60-second report-scoped signing. This
narrow additional read authority was explicit in the approved proposal. Source RLS,
ordinary owner previews and public signing remain separate. No arbitrary private
photo access. Profile navigation and internal forms are gated by backend role checks;
route knowledge or bundled UI code grants no moderator permission.

Public launch additionally requires the operational/device acceptance in
`MODERATION.md` and `PHASE9_VERIFICATION.md`. No Phase 10 functionality is authorized.

## 027 — Phase 9 audit: moderator state belongs to its request context

Changing a queue status/page must discard its previous rows and cursor before the
request starts. An uncertain response must not combine a new status with another
status's cursor. Explicit refresh restarts the selected status from its first page.
Preview errors and expiry callbacks affect only the preview instance that created
them; delayed callbacks cannot clear a subsequently renewed photo.

Regression tests reproduced both defects before their fixes. Expanded local tests
cover moderator revocation in both admission orders, arbitrary private signing
denial, reciprocal rating/moderation/publication contention, deletion/restoration,
restricted finalization and durable cases after target deletion. Existing backend
authority holds; no SQL migration or product-policy change is needed. See
`PHASE9_AUDIT.md`. Phase 10 remains out of scope.

## 028 — Historical Phase 10 delivery block (superseded by 029)

The user explicitly authorized Phase 10 and updating AGENTS. This supersedes the
historical Phase 9 scope limits in 026/027; Phase 11 remains unauthorized.

We raised the transport ambiguity before implementing a sender: at-most-one provider
attempt avoids application retries but can miss delivery after a network failure;
Expo/OS delivery and already queued pushes after offline sign-out cannot be guaranteed.
The user answered: **“Require stronger guarantees; flag delivery as blocked.”**

Therefore sending is structurally disabled. There is no Expo send HTTP call, successful
send state, receipt worker or fallback local reminder. Database preparation uniqueness
is not represented as exactly-once physical delivery. Do not weaken this decision or
automatically dispatch blocked records after a future migration. Expo documents
best-effort delivery that can duplicate or fail; a durable outbox alone cannot make
the network handoff or device display exactly once. See
[Expo delivery guarantees](https://docs.expo.dev/push-notifications/faq/#delivery-guarantees).

Independent work proceeds: private preferences, installation capabilities/revisions,
live Auth-session binding, backend challenge/streak preparation, fixed Today routing,
timeout recovery, deployment documentation and automated regressions. This is partial
Phase 10, not a completed notification loop. Restricted accounts preserve existing
private learning eligibility. Times use saved IANA zones; PostgreSQL's standard DST
resolution moves gaps forward and chooses standard time for folds. Preparation is
once per current user/type/local date, without catch-up messages for older dates.

Use Expo Notifications for permission/token/listener APIs, Device for physical-device
availability and SecureStore for the installation secret/revision. No custom backend,
state library or push provider credential enters the client. Optional public EAS UUID
and Android Firebase client configuration enable native setup; FCM service-account/APNs
credentials stay in trusted provider tooling. SDK compatibility also required Expo
57.0.23 and image-manipulator 57.0.18 patches.

Global request deadlines and Auth startup deadlines correct unbounded waits without
changing session admission or automatically retrying uncertain mutations. Existing
safe messages, request identities and backend reconciliation remain authoritative.
The 14 moderate transitive npm findings remain; forced fixes suggest SDK-breaking
downgrades. Track compatible upstream fixes and the Router malformed-query advisory
before external beta acceptance; do not claim the audit is clean.

## 029 — Approved at-most-one provider attempt and receipt reconciliation

The user explicitly changed the contract: at most one provider send attempt per
user + notification type + local date; uncertain outcomes are never automatically
resent, and a rare missed notification is preferable to duplicates. Provider/device
failure is accepted. This supersedes decision 028's sending prohibition. Phase 11
remains out of scope.

Consume a durable attempt in the database before network I/O and select one most
recently registered eligible device. One-use pre-send authorization rechecks exact
binding/session, account, preferences, timezone/date and streak validity. A crash or
lost claim/authorization response can miss a push, but cannot authorize a resend.
One recipient per fixed-endpoint HTTP request isolates invalid-token/project errors;
four concurrent requests bound load. No retrying push SDK or per-device fan-out.

Store safe ticket/result state and append transition events. A ticket confirms Expo
acceptance; a successful receipt confirms provider handoff, never device delivery.
Poll receipts after 15 minutes, retry reads when absent/unavailable, and stop at 24
hours. An interrupted attempt becomes uncertain after 10 minutes. Rejection, 429/5xx,
network timeout, malformed response and persistence loss never trigger another send.
DeviceNotRegistered clears only the exact attempted installation/owner/revision/token
hash, so delayed receipts cannot revoke a new account or token. This follows the
[Expo ticket/receipt API](https://docs.expo.dev/push-notifications/sending-notifications/)
while intentionally declining its suggested send retries under the user's contract.

The sender requires server job credentials and an Expo access token with enhanced
push security. No provider credential enters public env/config or the mobile bundle.
Legacy blocked records remain terminal and are not a backlog. Admission cannot recall
already in-flight/OS-queued pushes after account changes, including offline sign-out;
matching-account tap/foreground guards remain in place. Hosted/provider/device checks
are distinct from the real local DB + instrumented HTTP-provider tests.

## 030 — Phase 10 audit: scope revocation, DST admission and batch lock ordering

The approved at-most-one provider attempt contract is unchanged. Revoke a previous
installation scope before calling fallible native permission/token APIs on cold start
or Auth changes; a failed lookup must not leave another account registered. Persisted
revisions still fence late writes, and uncertain revocation must remain retryable.
Offline revocation and recall of already queued pushes remain impossible guarantees.

Claim, last-minute authorization and next-check scheduling must resolve the same IANA
wall-time instant. Gaps shift forward; folds use standard time. Direct wall-clock
comparisons allowed early sends after registration/settings refresh during transitions.
The additive DST audit replaces only the two affected functions and preserves data.

Batching retains locks across candidates. Before processing any preference row, acquire
all bounded candidate Auth-user locks, then profiles, then learning rows in UUID order.
This closes the reproduced scheduler/preferences B → authorization/profile A →
registration/installation A → preferences B deadlock. Current eligibility is still
rechecked and no database lock spans provider HTTP. A separate additive migration
preserves the already-applied DST migration and all attempt history.

Cancel unread provider response bodies on rejection. Keep fixed endpoints, bounded
input/deadlines and no send retries. Expanded tests prove duplicate-claim replay,
late invalid-token tickets during replacement, network/HTTP uncertainty and lock
contention, alongside existing receipt/session/RLS regressions. See `PHASE10_AUDIT.md`.
No product policy or Phase 11 functionality is introduced.

## 031 — Presentation polish after physical iPhone QA

Refine existing Phase 10 screens without starting Phase 11 or changing backend
contracts or product rules. Prioritize a photo-led Discover feed and a focused
post modal; show the exact existing semantic rating labels and move report/block
controls into an overflow sheet. The modal derives content from the current
bounded authorized feed window, with no additional fetch, global store, copied
signed URL or new public projection. Existing lifecycle/revalidation clears it.

Use shared typography/surface/action hierarchy and accessible native sheets across
forms, selectors, capture, vocabulary and settings. Timezone and notification time
controls constrain input presentation while retaining existing server validation.
User-initiated capture may open directly after assignment/draft recovery. Preserve
uncertain-response recovery and destructive confirmation when simplifying controls.
See `UX_QA.md` for scope, verification limits and required physical acceptance.

## 032 — Authorized profile/social pass and bounded mobile caching

The latest user QA brief authorizes avatar/profile editing, prefix username search,
public profiles, follow/unfollow, flat comments with reporting/moderation, native
sharing and quick ratings. It supersedes earlier exclusions only for that scope;
unrelated Phase 11 work remains unauthorized.

Use immutable opaque public IDs, not Auth IDs. Preserve the feed projection and
resolve authors through eligible submission context on tap. Follow edges are
unique, prohibit self-follow and remain hidden under mutual blocks/restrictions.
Flat comments use newest-first 20-item keysets, a 500-character bound and durable
request tombstones. Comment cases extend private reports/audits without granting
moderator private-photo inspection.

Avatars use a separate private bucket, immutable reservation paths, trusted JPEG
verification, object-version activation and Storage API cleanup. Add only the
SDK-compatible `expo-image-picker` for profile gallery selection; challenge capture
and Personal Team configuration remain intact. Native sharing uses the existing
[React Native Share API](https://reactnative.dev/docs/0.86/share) for vocabulary and
safe app context, never signed capabilities or unsupported public-post routes.

A focused typed memory cache preserves bounded pages and audited mutation ordering
without another state dependency. Separate metadata freshness from fixed photo
expiry; share concurrent reads and partition by Auth session. See
`PRODUCT_UX_PASS.md` for exact cache rules, database authority, measured query counts,
deployment and physical acceptance. Automated verification is not phone acceptance.

## 033 — QA2 navigation, public photos and request-driven caching

Saving an unchanged normalized username is a valid no-op. A changed save awaits
an account refresh that preserves the protected ready route, then performs one
guarded back action or replaces Profile for direct entry. A preceding admission
read cannot satisfy a post-mutation refresh. Learning settings use the same path.

Public profiles now read owner-scoped posts through the existing saved-target
Discover eligibility projection, with a new bounded RPC/index and existing signing.
This fixes absent profile content without broadening raw RLS or private reads.

Cache age is metadata, not a network trigger. Loaded screens reuse bounded session
data on tab return. Signed URLs retain the 60-second server lifetime and a 55-second
monotonic client download admission limit; downloaded JPEG pixels are separately
cached in memory. Only a miss/invalidation needs new image access. No ordinary
browsing polling remains. Actual background intervals of five minutes justify
reconciliation; foreground time, tab focus and native inactive sheets do not.
Keep pending-photo recovery and moderator revocation checks. See
[QA2_CORRECTIONS.md](QA2_CORRECTIONS.md) for every major screen's rules and limits.

Signup guidance mirrors verified Dev minimum/character settings and Auth's UTF-8
byte bounds without imposing stronger composition rules. Leaked-password protection
is a separate hosted setting still requiring confirmation; see PASSWORD_POLICY.md.

## 034 — Remaining QA2 connection lists and separate in-app inbox

The user explicitly authorizes followers/following lists and an in-app inbox without
opening Phase 11 or expanding remote push. Reuse opaque public profiles, ordered
social admission and controlled batched avatars. Follow acknowledgements include
authoritative profiles/counts so related cache state updates immediately.

Persist inbox source events server-side, separate from remote delivery attempts.
Use one recorded follower-pair event, one first-rating pair event and one event per
ready authoritative challenge; refollows/edits/retries do not renew timestamps/read
state. This is the recommended deduplication default communicated during the pass.
Keep rating actors private and present anonymous notices; resolve taps to existing
owner photo detail so current learning-language changes cannot misroute an old photo.

Filter inbox rows, unread counts and target resolution against current block,
moderation, relationship and public-photo eligibility. No signed URLs or arbitrary
routes enter events. Mark-all-read is bounded by the last observed server keyset.
Preserve source/read history on replay, retain read state while temporarily hidden,
and cascade hard deletion. No XP, streak or remote push changes.

Loaded data survives navigation without polling. Initial/explicit/justified long
background reads observe other-device changes; this is not realtime notification
delivery. Account changes retire all session state. See QA2_CONNECTIONS_INBOX.md
for exact semantics, rollout order and mandatory physical acceptance.

## 035 — QA3 Explore and native public post navigation

The physical QA brief explicitly authorizes vocabulary Search/Explore and related
public examples. Use existing concepts with indexed token-prefix target-term
search, saved reference translation, and Words/People categories. Keep username
prefix indexing and add only follow-state booleans. Public examples and one-post
reads reuse existing Discover eligibility, ratings and 60-second signing; no raw
RLS/Storage expansion, remote social notification or learning rule changes.

Replace modal post detail with a native card route/header for safe-area ownership
and iOS edge-back behavior. Pass only the submission ID through Router. Reuse fresh
session-scoped metadata/pixels, preserving invalidation and receipt synchronization.
Short background does not pop the route. Quick rating uses a transient accessible
palette rather than inline expansion; persisted score waits for server confirmation.

Displayed terms capitalize the first Unicode character without rewriting stored
snapshots or the remainder. Unchanged normalized username Save is disabled;
profile editing remains through the avatar pen and own public photos appear inline.
Remove routine comment/public-photo refresh buttons while retaining explicit error
recovery and established cache policy. See QA3_SEARCH_NAVIGATION.md. Phase 11 and
physical acceptance remain pending; no deployment is implied.

## 036 — Current-day library selection shares photo authority

The user explicitly authorizes library selection only for current-day assigned
words, superseding the earlier avatar-only gallery restriction for this scope.
Keep camera primary, with a native image-only picker as a secondary action. Reuse
the installed SDK-compatible picker; no broad photo-library permission preflight,
editor, new reward model, source-specific backend or historical-upload feature.

Use argument-free `get_my_progress` plus the owned unreplaced assignment to read
server current-day membership without generating a challenge. Recheck after the
picker and before new library bytes upload. Local draft provenance survives restart
so an old library draft cannot start uploading; it is not trusted backend identity.
Source-neutral reserve/upload/finalize authority, idempotency and already-uploaded
recovery stay unchanged, including crossing midnight. A network upload already
admitted may finish later; server finalization still chooses the completion day.

Native decoding normalizes orientation before computing the 1600px cap; re-encode
JPEG and strip APP/comment/trailing metadata for both sources. Never delete library
originals. Picker callbacks are fenced to the screen/account/session and do not
consume unscoped Android pending results after activity destruction. Rebuild native
config to pick up the broadened iOS photo-purpose text; Personal Team push behavior
is unchanged. See CURRENT_DAY_LIBRARY.md. Physical acceptance remains pending.

## 037 — Historical capture separates XP from daily completion

The latest explicit QA brief authorizes Past Words camera/library capture; the
user chose final, unreplaced assignments only. This supersedes decision 036's
current-day-only gallery scope, without opening Phase 11. The photo-context RPC
now supplies both server-owned admission flags in one read. New daily reservations
require today's server date; preexisting admitted uploads retain their daily mode.

Historical facts never enter daily completion/streak sources. Both modes share
the existing reversible assignment +10 entitlement so delete/resubmit cannot farm
net XP. Finished deletion reverses historical XP; later capture restores only word
credit. Keep daily-only completion metrics unchanged and use existing photo history
for visual dictionary counts. A private derived projection makes missing-first
keysets efficient without loading all prior challenges. No social label, new
uploader, Storage capability, remote notification type or separate XP engine.
See [PAST_WORDS.md](PAST_WORDS.md); physical acceptance remains pending.

## 038 — Semantic visual identity, separate from progression

The focused visual-identity request authorizes color presentation only. Indigo
expresses brand/actions/selection, orange energy/streak/discovery, yellow XP/reward,
green confirmed completion and red errors. Keep large surfaces neutral. Semantic
tokens replace legacy ambiguous color names; use readable ink on exact bright
accent fills and contrast-tested stronger text/control roles. Light success/error
are slightly darkened for normal-text contrast. Preserve third-party branding,
logo artwork and all product/backend behavior. See [COLOR_SYSTEM.md](COLOR_SYSTEM.md)
for exact values, measured pairs, verification and required physical iPhone review.

## 039 — Integrate the user's existing wordmark

The user approved replacing placeholder branding with the supplied Langtify SVG.
Preserve all lettering and marks; trim only transparent padding for in-app use.
Use derived PNGs with React Native Image, avoiding a runtime dependency, with
the established dark primary for dark surfaces. Auth, onboarding and session
restore share an accessible logo component. Configure native icons, light/dark
splash and web favicon explicitly, replacing the iOS Expo Icon Composer override
with the supported opaque PNG. Keep the complete artwork in launcher assets;
small-size readability still requires physical review. No backend, product,
notification or navigation behavior changes. See `assets/branding/README.md`
for reproducible conversion and local native rebuild commands. No deployment.

## 040 — Restrained motion and confirmed native feedback

The dedicated motion brief authorizes presentation polish without Phase 11 or
backend changes. Use built-in native-driver Animated and one shared accessibility
preference store; add only SDK-compatible `expo-haptics`. Keep native stack/back
behavior, disable movement under Reduce Motion and suppress background feedback.
Ordinary navigation, typing, loading and scroll remain silent. Existing account,
focus and mutation-admission guards must precede confirmation haptics.

Progressively disclose the same onboarding fields; intermediate steps are local
drafts and only Finish calls the existing onboarding RPC. Photo completion gets
one acknowledgement for an accepted explicit finalize, never passive restoration
or uncertain-response recovery. Server XP receipts distinguish word/full-day/
milestone presentation without new progression rules or duplicate haptics. Retain
the local photo and busy state through authoritative completion refresh to avoid
a blank preview or repeat action. Use static initial-load placeholders, unchanged
immediate obsolete-query cancellation, and no animation-triggered reads. Physical
acceptance remains pending; see [MOTION_POLISH.md](MOTION_POLISH.md).

## 041 — Consumer copy and enumeration-safe signup recovery

The product-copy audit authorizes interface changes, not new account policies.
Do not claim email delivery from a successful Supabase signup/resend response:
existing OAuth identities may produce an obfuscated no-op. Show the same conditional
inbox guidance, explicit resend, Sign in and Continue with Google for indistinguishable
signup outcomes. Keep Auth serialization, backend session/onboarding gates and
automatic identity linking. Password creation for an existing Google user and
forgotten-password recovery remain separately proposed security flows.

Use human-readable length guidance with the existing exact UTF-8 validation rather
than inventing a six-visible-character minimum. Live feedback confirms length only,
not password strength or future server acceptance. Known breach errors are safe
field errors; raw service messages must never become interface copy. Dev's length
and character policy were rechecked read-only on 2026-09-26. The user subsequently
confirmed custom Resend SMTP is enabled for hosted Dev, sending as
Langtify <no-reply@langtify.com>. Actual delivery remains pending a fresh-signup
hosted/physical test; neutral signup/resend guidance is unchanged. Leaked-password
protection still requires Dashboard confirmation. This documentation update changes
no auth logic or hosted configuration.
See [COPY_GUIDE.md](COPY_GUIDE.md) and [AUTH_COPY_AUDIT.md](AUTH_COPY_AUDIT.md).

## 042 — Today and one canonical post destination (QA #14–17)

Keep account totals/levels on Profile and daily progress/streak on Today. Today
word taps open Search's existing concept route with owned immutable assignment
context; expose existing private photo history without widening public examples.

Photo selection has one fixed primary Add photo action and a compact public/private
switch. Photo options progressively disclose retake, library selection and confirmed
discard. Cancelling retake/reselection preserves the reviewed draft. Uploaded
recovery objects cannot be silently replaced; existing discard/delete authority remains.

Replace the capture route with the shared post route after authoritative completion,
so native Back returns to the source rather than a result page. Extend the existing
post presentation to private owners using existing owner RLS and signing; never make
the public feed query return private content. Gate public interactions separately.
Only the exact bytes uploaded by this operation may seed the owner pixel cache after
trusted finalization. Fresh acknowledgements get one haptic and a brief server XP
receipt; lost responses, restored completions and ordinary revisits do not replay it.
No schema, function, entitlement, streak or bonus changes. Physical acceptance and
local integration verification must be reported separately from export success.

## 043 — Compact post conversation and restrained accents (QA #18/#20/#21)

Share one compact rating picker between Discover and detail, preserving the same
five meanings, confirmed selection and request ordering. Keep the photo and word
primary, an avatar/username author row secondary, and conversation ahead of its
docked multiline composer. Send uses a labeled 44-point icon; errors preserve
the draft and existing idempotent request ID. Owner privacy/delete and public
share/report/block remain menu actions with unchanged admission/confirmations.

Keep brand and semantic base colors intact. Neutral search icons distinguish tools
from orange streaks and yellow rewards; semantic badges use soft backgrounds,
neutral text and contrast-tested accent icons. Initial avatars respect the current
username-only feed projection without N+1 reads or backend changes. Uploaded feed
avatars required separately approved read-projection work (now authorized in decision 044). No display-name
field, feature, backend/progression change, dependency or Phase 11 work is introduced.
Physical review remains required; see `QA18_20_21_POST_POLISH.md`.

## 044 — Controlled Discover author avatars (QA #20 follow-up)

The user explicitly approves the smallest read-only backend extension for uploaded
author photos. Add one nullable opaque avatar ID to Discover feed, canonical post
and service-only photo-signing target responses. Keep profile/concept initial-page
RPCs unchanged; their existing shared signing revalidation supplies the reference.
No Auth owner ID, path, email or new profile field enters the public projection.

Reuse current-avatar verification and the existing partial unique index after
bounded pagination. Preserve eligibility, ratings, cursors and all writes. Reuse
the followers/People batch-avatar hook for Discover and canonical public detail;
fetch only distinct missing avatars in groups of at most 24. Keep downloaded
pixels session-scoped and bounded, preserve signed URL deadlines, cancel obsolete
reads and retain initials for missing or failed photos. No time-based refresh or
new dependency is introduced. See `QA20_DISCOVER_AVATARS.md` for staged rollout,
verification and physical acceptance.

## 045 — Identity-first Profile and owner visibility browsing (QA #19/#22)

Remove Profile's redundant public-feed section. Place the backend-derived Level
beside Followers/Following; preserve the existing avatar edit affordance. My photos
opens existing My Vocabulary instead of adding another gallery. Put existing XP,
streak and completion statistics behind a Learning progress disclosure, without
repeating Level or issuing another progress read. Consolidate learning settings into
one link to the existing form. Today stays free of level and total XP.

Use a restrained All/Public/Private segmented control in the owner browser and
concept history. Apply visibility in the existing security-invoker RPC before
latest-per-concept grouping, so older matching captures remain reachable. Count
only matching captures/concepts; search and CEFR continue to describe the displayed
latest capture. Existing invoker RLS, Auth-derived ownership, public-profile
eligibility, private Storage and 60-second batch access are unchanged.

Partition query caches/cursors by visibility and mask the previous query at render
boundaries. Keep session isolation, explicit refresh and mutation invalidation.
No unrelated profile feature, new public field, progression rule or Phase 11 work.
See `QA19_22_PROFILE_VISIBILITY.md` for verification and physical acceptance.

## 046 — Shared avatar reconciliation and honest loading (QA #23/#24)

Use one authoritative current-self-avatar pointer per Auth session, shared across
all author rows. Successful avatar changes patch that pointer and only affected
avatar-access batches; do not reset/refetch feed/search/comment pages. Exact bytes
from the matching confirmed owner upload may seed the existing bounded pixel cache.
Other avatars continue to use controlled projected IDs and batch signing; comment
and follower-inbox projections gain that minimal reference only. No public bucket,
new remote notifications, realtime subscription or identity-by-username heuristic.

Reserve media geometry with static neutral placeholders. Initial loading must not
show failure controls. Cached refresh keeps usable content, with a small pending or
error state; authority failures still clear it. Owner and non-owner post overflow
use the same plain trigger. See `QA23_24_AVATARS_MEDIA.md`; physical acceptance is pending.

## 047 — Signup code rollout without account disclosure (QA #25)

Redesign logged-out forms around restrained branding and one primary action. Add
supported email/password signup code verification, not passwordless signup. Keep
link mode by default until the manual hosted Confirm signup template change is
complete and the public digit-count rollout setting matches the verified provider
configuration. Verification stages a nonpersistent candidate and reuses the audited
session write/admission/recovery guards, including account and browser intent fences.
Do not put codes or emails in navigation or log provider responses. Normalize new,
obfuscated and known existing-account responses; never promise email delivery.
Preserve Google linking, password policy and authoritative onboarding. No hosted
configuration change or Phase 11 work. See QA25_AUTH_EMAIL_CODES.md.

## 048 — Onboarding hierarchy and optional language facts (QA #26/#27)

Keep the existing five onboarding decisions and authoritative final save. Present
language/CEFR choices as generous full-width rows, with restrained progress and one
persistent Continue action. Show a compact wordmark on the first step only; later
steps use a quiet setup label. Keep sign-out in an accessible options sheet.

Use a small sourced editorial catalog for optional facts during account restoration
and initial challenge preparation. Select once per mounted wait; reveal after
1.5 seconds without delaying completion. Reserve the chosen text's natural height
before revealing it, hide unrevealed copy from accessibility, and honor Reduce
Motion. No rotating trivia, new learning rules, stored vocabulary edits or facts
during routine mutations, pagination or cached refresh. Physical acceptance remains
required; see `QA26_27_ONBOARDING_LOADING.md`.

## 049 — Recognition without public eligibility; durable inbox opening (QA #28–31)

Show owner-history navigation only for actual captures. Add only authoritative
Level to eligible public profiles, using existing rules; QA #32 remains separate.
A blocked-account route is a recognition view, not a public-profile exception:
block ID, username and controlled avatar only. Keep normal mutual eligibility
denial. Explicit Unblock needs no second confirmation and reconciles scoped public
caches without refetching private learning data.

Treat a fresh inbox route opening as one server-admitted read event. Use a durable
UUID receipt rather than a caller timestamp or repeated "mark all" request. Snapshot
membership and no-write retries protect notifications committed after admission.
A network-delayed opening is admitted when it reaches the database; immediate
cosmetic zero is deliberately avoided until acknowledgement. Preserve cached rows
and pagination, and route ratings directly to canonical post detail. Retain receipts
until account deletion: this small storage cost preserves arbitrarily old retry
idempotency. No polling, new social event type or remote-push change.

On 2026-09-28 the user explicitly authorized applying this migration and running
the persistent local Supabase verification, resolving the earlier approval gate.
Hosted migration/function deployment remains unauthorized in this pass. See
QA28_31_PROFILES_INBOX.md for results and remaining physical acceptance.

## 050 — QA #32: Level 1 and a faster early curve

Explicitly approved: threshold(L) = `10 × (L - 1) × (L + 2)`, starting at Level 1.
One perfect current day reaches Level 2 (40 XP); adjacent costs grow by 20 XP.
Only total-XP-to-Level mapping changes. Keep the signed ledger, +10 word/+10 full-day,
historical +10, milestones, reversals and restoration untouched. Replace the shared
backend helper in one tracked additive migration; no persisted level/data rewrite.
Profile shows within-level XP (620 total = Level 7, 80/160 to Level 8).

Never interpret a migration/read/cache refresh as earning XP. Remove passive Level
and total-XP pulse animation; preserve existing one-use confirmed-finalize acknowledgement
and silent recovery/revisits. No new celebration system. Keep public Level-only privacy,
exact bigint boundary corrections, safe-integer client admission and scoped cache
invalidation after real XP-affecting photo operations. No new dependency/native build
requirement or Phase 11. See `QA32_LEVEL_PROGRESSION.md` for verification and rollout.

## 051 — Completed concepts never return as new Daily Words

The physical-QA request explicitly changes generation and replacement eligibility:
once a user genuinely completes a concept, exclude it permanently across languages.
Use verified server finalization, including Past Words, rather than active photo count
or positive net XP. Deleting a photo reverses its rewards as before but cannot reset
this learning history. Keep old assignments/reuploads valid and account erasure complete.

Store one private, immutable `(user_id, concept_id)` record with its original source
and time. Backfill retained verified submissions and linked durable positive word
events; refuse unresolved legacy identities rather than silently misclassifying them.
Use the existing owner lock and progress revision to serialize completion/selection.
Keep exact CEFR slots, current-challenge uniqueness, and unseen-first/oldest assignment
ordering for the remaining never-completed concepts. Exhaustion fails atomically;
never recycle completed words to mask the small development catalog. No seed expansion,
public read grant, new reward, Edge Function or client-side eligibility filter.
See `COMPLETED_CONCEPT_EXCLUSION.md` for verification and Dev rollout.
