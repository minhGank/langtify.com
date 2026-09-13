# Roadmap

## Phase 1 — completed

Expo/Router, strict TypeScript, npm, four tabs, UI primitives, lint/format/test
foundation, documentation and Langtify naming.

## Phase 2 — completed

Supabase identity schema/RLS, email/password auth, persisted sessions, onboarding,
profile summary and audited account/invariant protections. Historical verification
and audit reports retain their original scope and results.

## Phase 3 — completed and audited

Shared concept/term vocabulary model, modest bilingual development seed,
authoritative local-day challenges, CEFR slots, concept-level repeat avoidance,
replacement history, Today cards, atomic/concurrency/RLS tests and client lifecycle
checks. Target-environment setup and both-platform phone acceptance remain handoff
steps; no hosted project or production vocabulary catalog is assumed.

## Phase 4 — implemented and audited

Camera permission/capture/retake and normalized metadata-free JPEG preview,
private Storage, authoritative submissions, retry/recovery, owner visibility/detail,
safe deletion and maintenance cleanup. Local database/Auth/Storage tests, app tests
and platform exports accompany the implementation. Hosted migration, cleanup-job
installation, trusted function deployment and both-platform phone acceptance remain
deployment handoff steps. The audit adds actual image verification, fixed preview
lifetimes, Storage commit guards and stale-draft cancellation; see `PHASE4_AUDIT.md`.

## Phase 5 — implemented and audited

Server-authoritative signed XP ledger, daily progress, reversible streak milestones,
derived levels and Today/Profile/photo feedback. Concurrency, RLS, historical
reconciliation, DST and nonempty migration backfill tests accompany the work.
Hosted migration and iOS/Android acceptance remain deployment handoff steps.
The audit fixes session-dependent milestone identities and extreme level boundaries;
see `PHASE5_AUDIT.md`.

## Phase 5.5 — implemented and audited; hosted/device acceptance pending

Google OAuth through Supabase, guarded S256 PKCE callbacks, native development
build setup and the existing password/session/onboarding pipeline. Automated tests
cover SDK exchange, cancellation, replay and account boundaries. Real Google
consent and automatic identity linking require hosted Langtify Dev and device
acceptance; see `PHASE55_VERIFICATION.md` and `PHASE55_AUDIT.md`. The audit hardens
persistent session admission, cross-tab isolation, recovery identity and early link sanitation. Apple remains deferred until Apple
Developer membership is available.

## Phase 6 — implemented and audited; device acceptance pending

My Vocabulary groups verified personal photos by concept, with latest capture cards,
search, CEFR filtering, bounded capture history and existing photo management.
Owner/RLS queries and batch short-lived previews retain private Storage and account
isolation. No new completion or XP system. See `PHASE6_VERIFICATION.md` for checks,
deployment and physical acceptance. `PHASE6_AUDIT.md` records lifecycle, preview
expiry/retry and UUID fixes with privacy/pagination regression coverage. Google
physical acceptance remains pending.

## Phase 7 and later — not started

Further work requires explicit scope. Community
feed, ratings, comments, followers, notifications, leaderboards, achievements, subscriptions and moderation remain out of scope.
Other OAuth providers, password recovery UX, production vocabulary/content review, final
branding, production signing and store setup need separate planning.
