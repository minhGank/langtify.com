# Daily selection policy v2

Approved 2026-10-20; implemented locally. No hosted migration or catalog import.

## Selection

All six learner levels and preferred patterns remain:

| Learner | Preferred levels | Allowed fallback |
| ------- | ---------------- | ---------------- |
| A1      | A1, A1, A2       | A1–A2            |
| A2      | A1, A2, B1       | A1–B1            |
| B1      | A2, B1, B2       | A2–B2            |
| B2      | B1, B2, C1       | B1–C1            |
| C1      | B2, C1, C2       | B2–C2            |
| C2      | C1, C2, C2       | B2–C2            |

The database counts eligible concepts with active target and reference terms and
plans all three levels together. It enumerates feasible sorted three-word patterns,
with at most one word above the learner. C2 first minimizes B2 consolidation; other
ranking is distance from the preferred pattern, more learner-level words, lower
total difficulty, then stable level order. Preferred patterns win when available.
A missing preferred slot cannot consume another slot's only available candidate.

Within each chosen level, never-assigned concepts precede unfinished history, then
oldest assignment first. Category variety is a soft tie-break among equally recent
candidates, followed by a stable user/date/concept hash. It never overrides level
limits, completion exclusion or recency. The date hash is independent of DateStyle.
Both literal and interpretive concepts use the existing photographable flag;
photographic complexity does not manufacture a higher CEFR level.

Permanent `private.completed_concepts` exclusions apply across languages and after
photo deletion. Pending uploads do not constitute completion. All three semantic
IDs must differ, and every concept ever assigned within this challenge is excluded
from replacement. Fewer than three usable concepts—or a pool that cannot satisfy
the one-above limit—returns `insufficient_vocabulary` and rolls back all changes.
Previously assigned unfinished words may recur on a later day.

## Replacement and saved challenges

Replacement keeps the other two cards fixed. C2 first avoids B2 when an eligible
C1/C2 replacement exists. Otherwise it prefers the replaced word's actual level,
then bounded nearby fallback, distance from the previous level and lower difficulty. It enforces the one-above limit against the
remaining cards. No legal replacement means the original card remains intact.
Existing submitted-word guards, owner locks and immutable assignment history stay.

`daily_challenges.selection_policy_version` is immutable. Migration backfills 1;
the public generation RPC explicitly creates 2. Existing days and their replacements
keep v1's exact-slot behavior. Trusted legacy fixtures default to 1. Replaying the
migration cannot upgrade old days or rewrite snapshots, photos or XP.

V2 retains stable internal review/target/stretch slot IDs but displays Word 1–3
with actual CEFR labels, because fallback/replacement need not preserve semantic
slot names or ascending difficulty. C2 B2 cards explicitly say “B2 consolidation”.
Legacy cards retain their original labels. Guidance remains optional.

## Authority and rollout

Migration: `20261020000000_bounded_challenge_selection.sql`. It changes selection
helpers/RPC bodies and assignment guards only; existing public RPC ACLs, RLS,
Storage, completion, account deletion and XP authority remain unchanged. New private
helpers are unavailable to anon/authenticated/service_role. Existing owner and
progress-revision serialization remains; a deferred guard validates the final mix
alongside the existing three-slot constraints. Catalog terms/concepts are locked
and revalidated when assigning; conflicting changes fail atomically.

Before a separately approved Dev rollout:

1. Review the additive migration and local verification results; verify prerequisites
   and exact migration history. Do not blindly include deferred cleanup migrations.
2. Apply only this migration to Dev and verify old challenges remain v1, new days v2,
   effective ACLs, constraints and trigger definitions.
3. Use disposable Dev accounts for all six levels, shortages, replacements, concurrent
   devices, language changes and completed-photo deletion. Never change real progress.
4. Test Today cards and photo guidance on iOS/Android, including VoiceOver/TalkBack,
   B2 consolidation, older saved days, replacement failures and offline recovery.
5. Approve Production separately after catalog readiness and device acceptance.

Deploy the updated client before enabling server v2: older clients may display
review/target/stretch labels for fallback levels. Avoid a rollback that reintroduces
v1-only assignment guards while v2 days exist; retain both policy implementations
and disable future v2 admission in a separately reviewed migration if needed.

## Catalog readiness and remaining decisions

The offline validator mirrors the joint planner; integration tests compare SQL and
JavaScript over bounded capacity combinations. Reports distinguish provisional and
fully reviewed bilingual inventory and simulate days of three new completions.
The simulation assumes a fresh user, no replacements and no access exclusions;
language switching, prior completions and replacement reserves shorten the horizon.
No launch-duration threshold has been invented. Approve a replenishment horizon
before launch. Completion exhaustion is permanent, not hidden by recycling words.

The 60 approved meanings, translations and CEFR estimates are unchanged. Linguistic
review remains pending, and this pilot cannot support all six learner levels. A
first-day coverage pass alone is not release readiness.

## Local verification — 2026-10-20

- `npm run check`: TypeScript, ESLint, formatting and 1,048 tests / 91 suites pass.
- Local SQL/RLS mirror: 1,844 assertions / 32 files pass, including preserved v1
  reads/replacements, six-level patterns and fallback, atomic shortage, real-level
  snapshots, direct-write mix guards, permanent exclusion and unfinished recency.
- All 19 existing sequential Auth/DB/Storage integration commands pass, including
  migration bootstrap/replay, completion/finalization races, photo deletion/recovery,
  XP, history, social/safety and notification admission. The challenge suite adds
  concurrent C2 fallback creation/replacement and 336 SQL/offline planner comparisons.
  The local rollback-only vocabulary-guidance import/replay test also passes.
- Catalog validator tests: 20 pass; capacity properties cover all 4,096 small count
  combinations across six learner levels. Draft validation passes; release validation
  correctly remains blocked. No pilot content or approval metadata changed.
- Database lint: no warnings/errors, both persistent local and disposable bootstrap.
- Edge Function typecheck/lint and 33 tests pass. CI setup/audit-policy tests: 24 pass.
- iOS/Android/web exports with source maps pass; credential scan passes for 596
  source/config/export files and both decoded Hermes bundles. These are exports,
  not native binaries or physical-device acceptance.
- Expo Doctor 21/21; SDK compatibility passes. Dependencies are unchanged.
- Existing unsigned-CI audit gate passes with 0 critical, 49 high and 16 moderate
  findings reported. The two existing exceptions still expire 2026-10-21 00:00 UTC;
  no scope/expiry/threshold changes. Signing/release security is not cleared.
- `git diff --check` passes. Nothing imported/deployed to hosted Supabase; no
  Production data changes, commit or push.

During verification, database lint identified a redundant PL/pgSQL loop-variable
declaration, which was removed. An obsolete review-document assertion was updated
for the approved policy. One intermediate photo-audit queue-order assertion failed;
the final sequential run passed unchanged from a verified empty local queue. Its
precise transient cause was not established; no cleanup guard was weakened.

The migration was applied only to the local Docker database for testing; bootstrap
also applies/replays it in a disposable database. SQL tests use the documented
Docker-shared temporary mirror. Local integration fixtures are disposable accounts;
no hosted or real user was tested. Physical iOS/Android checks and separately approved
Dev/Production rollout remain pending.
