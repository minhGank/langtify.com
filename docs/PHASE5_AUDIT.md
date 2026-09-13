# Phase 5 audit — Progress, Streaks, XP and Levels

Audited locally on 2026-09-12. The existing uncommitted Phase 5 implementation was
preserved as the audit baseline. No Phase 5.5/6 features, reward policy, routes,
client architecture, dependencies or environment variables were changed.

## Findings and fixes

### Medium — milestone XP identity depended on session date formatting

The original reconciliation key concatenated `window_end::text`. A milestone ending
2026-01-03 used `milestone:3:2026-01-03` under ISO output, but
`milestone:3:03/01/2026` under SQL/DMY output. Reproduced against the original
implementation: after three qualifying days, changing session DateStyle and
completing another word increased net milestone XP from 10 to 20. The durable
candidate was unchanged; reconciliation treated its formatted alias as a new source.
This was a database-session/configuration defect, not an exposed client-controlled
XP argument or a demonstrated ordinary REST capability to change DateStyle.

Fixed in `20260913010000_phase5_audit_integrity.sql`: format the date explicitly as
`YYYY-MM-DD`, after casting to `timestamp without time zone`. The explicit cast
also prevents an implicit session-timezone conversion from moving a skipped date;
a probe using Pacific/Apia and 2011-12-30 demonstrated that conversion risk during
fix validation. Tests cover six date styles, session timezone changes, deletion,
restoration, source uniqueness, and signed ledger/projection agreement. Existing
canonical source strings remain identical.

PostgreSQL documents configurable date output and timezone-dependent timestamp
conversion in [Date/Time Types](https://www.postgresql.org/docs/current/datatype-datetime.html),
and explicit output templates in [Formatting Functions](https://www.postgresql.org/docs/current/functions-formatting.html).
The reproduction and regression assertions run against the local database itself.

### Low — numeric rounding advanced extremely large totals one XP early

The level formula used a floored numeric square root without checking the estimated
level against its actual threshold. At Level 100,000,000, a total of
250,000,007,499,999,999 XP (one below the threshold) incorrectly returned that level.
The defect also reproduced near Level 600,000,000. These totals are far beyond
realistic app use; early levels and the 620-XP example were already correct.

The additive migration keeps the estimate, then adjusts it using exact numeric
threshold comparisons. Tests cover below/at/above early and large thresholds,
multiple-level advancement, invalid inputs and the maximum signed bigint total.
The required formula and client authority remain unchanged.

### Coverage gaps closed

Added direct Auth REST probes for another user's ledger, challenge summary and
photo receipt, ledger INSERT/UPDATE/DELETE, anonymous access, caller-supplied XP
and private-helper invocation. Added last-qualifying-word deletion versus a different
finalization, locale-independent reversal, parent challenge cascades and preservation
of valid migration history. UI tests now explicitly cover background invalidation,
foreground refresh, late expired-token errors and old-account photo XP feedback.
The UI lifecycle test initially failed because it restored an already mocked native
method; the corrected test setup passes without changing application behavior.

No additional defect was reproduced in 10/20/40 XP, one qualifying day for multiple
words, all six milestone rewards, normal retries, delete/resubmit net XP, original
milestone windows, historical deletion, current/longest streak, ordinary DST,
concurrent same-owner writes, cross-user access or account-scoped client responses.
This is bounded test evidence, not a claim that all possible attacks are excluded.

## Migration and durable history

The original Phase 5 migration remains unchanged. The new migration locks progress
writers, checks existing milestone keys and ledger/source balance/revision agreement,
and replaces only the two private calculation/reconciliation functions. It preserves
all valid existing events and source balances. Normal tracked migration reruns are
a no-op; explicit audit-function replay is also tested to preserve existing history.

If a deployed database already contains noncanonical milestone aliases or inconsistent
projections, the migration aborts atomically with a descriptive error. Locale dates
can be ambiguous, so it does not guess an association, rewrite immutable events,
delete history or silently adjust XP. Such data requires reviewed signed reconciliation
before migration. The local preflight passed; it had no existing XP events outside
isolated test fixtures. Disposable-database tests prove refusal rolls back completely
and valid nonempty history survives installation and replay.

## Commands and final results

| Command                                                         | Result                                                                                        |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `npx supabase migration up --local`                             | Audit migration applied; tracked rerun has no pending migrations                              |
| `npm run typecheck`                                             | Pass                                                                                          |
| `npm run lint`                                                  | Pass, zero warnings                                                                           |
| `npm run format:check`                                          | Pass                                                                                          |
| `npm test`                                                      | 158 tests across 20 suites pass                                                               |
| `npx supabase test db /private/tmp/langtify-phase5-audit-tests` | 355 assertions across 8 SQL files pass, including 60 new audit assertions                     |
| `npm run db:test:integration`                                   | 5 identity/seed/migration scenarios pass                                                      |
| `npm run db:test:challenges`                                    | 4 challenge/concurrency scenarios pass                                                        |
| `npm run db:test:bootstrap`                                     | 7 scenarios pass, including nonempty Phase 5 backfill, audit refusal, preservation and replay |
| `npm run db:test:submissions`                                   | 10 real local Auth/Storage/lifecycle scenarios pass                                           |
| `npm run db:test:photo-audit`                                   | 6 image, signing, expiry, concurrency and recovery scenarios pass                             |
| `npm run db:test:progress`                                      | 7 XP concurrency/recovery/Auth REST scenarios pass                                            |
| `npx supabase db lint --local --level warning`                  | No schema errors or warnings                                                                  |
| `npx expo install --check`                                      | Dependencies compatible                                                                       |
| `npx expo config --type public`                                 | Pass                                                                                          |
| `npm run doctor`                                                | 21/21 checks pass                                                                             |
| `npm run export:check`                                          | iOS, Android and web exports pass                                                             |
| `npm run security:scan`                                         | Source/config/bundle scan passes, including both decoded Hermes bundles                       |
| `git diff --check`                                              | Pass                                                                                          |

SQL files were copied exactly to the temporary directory using the documented Docker
file-sharing fallback. Database/Auth/Storage tests used local Supabase only, with
rollback-only SQL or disposable users/databases. Real concurrency coverage includes
two Auth sessions, concurrent finalizations/retries, full bonus and milestone races,
last-word deletion, cleanup at REPEATABLE READ and retry after serialization failure.

## Files changed by this audit

New: `supabase/migrations/20260913010000_phase5_audit_integrity.sql`,
`supabase/tests/phase5-audit.test.sql`, `docs/PHASE5_AUDIT.md`.

Updated: `scripts/test-db-bootstrap.mjs`, `scripts/test-progress-integration.mjs`,
`tests/progress.test.tsx`, `AGENTS.md`, `README.md`, `docs/DATA_MODEL.md`,
`docs/DECISIONS.md`, `docs/ROADMAP.md`.

All other Phase 5 changes predated this audit. No production client code was changed.

## Remaining risks and closure

- Hosted deployment was not performed. Apply the audit migration before release;
  investigate any preflight refusal without disabling checks or rewriting history.
- Physical iOS/Android acceptance and signed native builds remain outstanding.
  Use the phone checklist in PHASE5_VERIFICATION.md, especially account switching,
  interrupted deletion, simultaneous devices and local-midnight refresh.
- Legacy Phase 4 photos still use the saved challenge timezone during backfill;
  their original finalization-time timezone was never recorded.
- Persisted timezone changes affect future calendar-day qualification. There is no
  timezone-change cooldown or travel abuse policy; none was invented by this audit.
- Reconciliation scans an owner's indexed history. Production-scale latency and
  ledger growth need monitoring. The existing hourly photo cleanup remains required;
  deletion credit reverses when physical removal and retirement finish.

Phase 5 is safe to close for the implemented scope after these fixes and passing
local checks. Production release remains conditional on migration preflight and the
existing deployment/device acceptance steps. Phase 5.5 and Phase 6 have not begun.
