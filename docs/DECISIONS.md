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
