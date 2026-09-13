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
