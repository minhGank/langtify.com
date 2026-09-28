# QA #32 — Level 1 progression

Only the approved total-XP-to-Level mapping, progress presentation and related cache
correctness. No change to XP earning, milestones, historical rewards, deletion or
restoration; no Phase 11, native dependency/configuration, commit, push or deployment.
Prior uncommitted QA work is preserved. Physical iPhone acceptance is pending.

## Model and authority

Old curve: Level 0 at zero XP; `25 × L × (L + 3)` cumulative threshold.
New curve: **Level 1 at zero XP**; `10 × (L - 1) × (L + 2)` cumulative threshold.
The cost from L to L + 1 is `20 × (L + 1)`, increasing by 20 XP each level.

| Level | Total XP threshold | XP to next level |
| ----- | ------------------ | ---------------- |
| 1     | 0                  | 40               |
| 2     | 40                 | 60               |
| 3     | 100                | 80               |
| 4     | 180                | 100              |
| 5     | 280                | 120              |
| 6     | 400                | 140              |
| 7     | 540                | 160              |
| 8     | 700                | 180              |
| 9     | 880                | 200              |
| 10    | 1080               | 220              |

The sole formula lives in **`private.level_progress(bigint)`**, replaced by
**`supabase/migrations/20260928000000_qa32_level_progression.sql`**. Both
`get_my_progress` and `private.public_profile_level` call it. Levels are derived
from signed authoritative ledger totals, never persisted or client-calculated.
No new field, public signature, generated DB type, table, index, RLS or write path.
The helper remains private and uses an empty search path. Migration tracking is
required by this repository, even for a function-only change.

Existing users resolve to the new level on their next authoritative read. No XP
backfill, history rewrite, reward write or notification is generated. The first
perfect daily challenge still earns 40 XP and now reaches Level 2. Historical
capture still earns only its existing reversible 10 XP entitlement. All streak
bonuses and deletion/restoration behavior are unchanged.

Numeric sqrt provides an estimate, corrected using exact numeric threshold products.
All nonnegative PostgreSQL bigint totals are supported, with no gameplay cap; even
next thresholds beyond bigint maximum remain exact numeric JSON. The maximum-input
level fits PostgreSQL integer. Client numbers must be safe nonnegative integers,
Level must be at least 1, and progress fields must agree. Unsafe JSON totals or
thresholds fail closed to the existing retry/unavailable UI, never rounded display.
This preexisting JavaScript transport limit is not a level cap; an implausibly large
XP account would require a future string/bigint transport contract.

## Presentation and cache audit

- Profile keeps Level with Followers/Following; public profiles expose only Level.
  Today still shows no Level or total XP. Onboarding has no separate starting-level
  field. Search, inbox and remote notification payloads contain no level formula.
- Learning progress displays within-level XP: **120 total → Level 3, 20 / 80 XP
  to Level 4**; **620 total → Level 7, 80 / 160 XP to Level 8**. Total XP remains
  a separate existing reward badge. The bar uses those same authoritative fields;
  VoiceOver also announces remaining XP and the destination level. Existing wrapping,
  typography, light/dark reward treatments and touch targets remain.
- Passive Level and total-XP read pulses are removed. There is no separate level-up
  event/celebration system to backfill. Existing one-use photo-added/XP acknowledgement
  remains limited to accepted fresh finalization; recovery, revisits, reversals and
  formula changes remain silent. No new animation is added; Reduce Motion remains.
- Caches are bounded, memory-only and account/session scoped. Loading new JS/app restart
  discards old entries. No new persistence or elapsed-time polling. Completion/deletion
  now invalidates only the originating session's owned public-profile/relationship
  summaries, including unresolved pending reads; other known users' entries stay cached.
  This closes the stale public Level gap while leaving backend progression untouched.
- Public/client validators reject Level 0. Updated fixtures use Level 1; historical
  migration files and audit records retain the former formula as history, clearly
  superseded in current documentation.

## Changed implementation locations

- Backend: the new migration replaces `private.level_progress`; owner/public RPCs
  retain their existing signatures and admission. Old migrations remain untouched.
- Presentation: `src/features/progress/progress-panel.tsx` renders within-level
  labels/accessibility and removes passive Level/XP animation. Existing Profile
  and public-profile summary components consume the resulting authoritative values.
- Validation: `src/services/progress.ts` and `src/services/social.ts` reject invalid
  levels/numbers and keep private progression out of public profile objects.
- Cache: `src/lib/server-cache.ts` adds bounded predicate invalidation;
  `src/features/social/cache.ts` selects owned session entries; photo finalization
  and deletion in `src/services/submissions.ts` invoke it.
- Tests: progression/profile/public-profile/photo-service fixtures; new
  `supabase/tests/qa32-levels.test.sql`; Phase 5 and QA #28–31 SQL expectations;
  progress/Past Words integration and nonempty bootstrap/replay scripts.
- Current product/architecture/data-model/decisions and AGENTS documentation now
  specify the approved curve. Earlier verification reports link to this superseding
  rule rather than erasing the original audit history.

## Verification

Passed locally:

- `npx supabase migration up --local`: the single QA #32 migration applied to the
  persistent local database; no hosted changes.
- `npm run check`: TypeScript, ESLint, formatting, **959 application tests / 79 suites**.
  Coverage includes new-user within-level labels, high safe integers, invalid responses,
  passive migration/reversal silence, cache/account isolation, existing fresh-finalize
  feedback, silent recovery and public privacy.
- `npm run db:test:bootstrap`: ordered disposable bootstrap and two applications of
  the new migration over nonempty history. Exact XP events/source balances, milestones,
  days, photos and inbox snapshots stay identical; existing and public levels remap.
- `npm run functions:check`, `npm run functions:lint`, `npm run functions:test`:
  all three functions check; **24 function tests** pass. No function code changed.
- `EXPO_NO_DOTENV=1 npm run doctor`: **21/21**; `EXPO_NO_DOTENV=1 npx expo install --check`:
  dependencies current.
- `npm run export:check -- --clear` with dotenv disabled and local public fixtures:
  iOS, Android and web pass. `npm run security:scan`: **494 files and two decoded
  Hermes bundles**, no privileged credentials/server implementation in app exports.

The first focused run used an unsupported Jest dynamic import in the new cache test;
using the ordinary static import fixed that fixture. An initial full app run then
ended in a Node segmentation fault without a failed assertion. After exports finished,
the unchanged full check passed all 959 tests. No tests were skipped or weakened.

- Full SQL/RLS suite via the documented Docker-shareable mirror: **1,215 assertions
  across 25 files**. Includes every requested early threshold, start/next thresholds,
  within-level/remaining XP, exact high-level boundaries, single/multi-level XP changes,
  signed reversal/restoration, full-day 10/20/40, milestones and direct/cross-user denial.
- All **18** integration/replay commands passed sequentially: `db:test:bootstrap`,
  `db:test:progress`, `db:test:past-words`, `db:test:integration`, `db:test:challenges`,
  `db:test:submissions`, `db:test:photo-audit`, `db:test:vocabulary`, `db:test:discover`,
  `db:test:ratings`, `db:test:safety`, `db:test:social`, `db:test:avatars`, `db:test:inbox`,
  `db:test:explore`, `db:test:notifications`, `db:test:notification-sender`,
  `test:auth:integration`. The Past Words suite also passed a final rerun with explicit
  historical-level boundary assertions. This covers real Auth/Storage, simultaneous
  finalization/deletion, retries, source idempotency, unchanged milestone authority,
  public privacy, moderation, signing and the existing remote-push contract.
- `npx supabase db lint --local --level warning --fail-on warning`: no schema
  warnings/errors. Final formatting, integration-script syntax and `git diff --check`
  pass. No dependencies changed.

The mirror served unchanged repository functions with normal JWT verification.
It was stopped/removed after testing; persistent local Supabase remains running
with the new migration applied. No hosted Supabase access or deployment occurred.
Automated checks clear this batch for review and controlled Dev rollout, followed
by physical iPhone QA. Device acceptance is still required before closing QA #32.

## Dev rollout — not performed

1. Review the complete uncommitted QA changes and obtain separate hosted rollout approval.
2. Apply any outstanding prior QA migrations in chronological order, then
   `20260928000000_qa32_level_progression.sql`. The formula migration updates existing
   users automatically; no ledger write/backfill or account script is needed.
3. QA #32 requires no Edge Function deployment, hosted secret or native rebuild.
   Prior QA #20/#23–24/#28–31 function requirements still apply if not yet deployed.
4. Load the updated client JavaScript after the migration. Relaunch the development
   app so its existing session-only caches start fresh; verify both owner/public Level.
   Standalone builds use the normal JS/binary release process.

## Physical iPhone acceptance

1. Fresh account: Profile Level 1, 0 XP, progress 0 / 40 XP to Level 2. No Level 0
   in owner/public profile, no invented value while loading/error, no Level/total XP on Today.
2. Complete today's words: 10, 20, 40 XP; first full day reaches Level 2, progress
   0 / 60 XP to Level 3. Existing streak and one-shot photo feedback remain correct.
3. Existing account with 120/620 XP: Level 3 with 20/80, or Level 7 with 80/160.
   Initial launch/refresh after migration must not replay reward/level celebrations.
4. Delete/reupload a boundary-crossing photo: XP/Level decrease and restore correctly;
   revisit own public profile and confirm consistency. Historical capture grants
   only existing word XP, without daily/streak effects.
5. Open another user's eligible public profile: correct Level, no private XP/ledger.
   Blocking/restriction behavior unchanged. Verify cached navigation and account switch
   during progress/finalization/deletion requests; no old-user data or animations.
6. Review progress labels and bar with VoiceOver, large text, dark/light modes,
   Reduce Motion and smaller iPhones. Follow existing native back/navigation behavior.

Do not close QA #32 until physical iPhone QA passes. Nothing committed, pushed or deployed.
