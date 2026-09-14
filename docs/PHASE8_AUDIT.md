# Phase 8 audit — Semantic Photo Ratings

Audited on 2026-09-14. Phase 8 only; no Phase 9 functionality, product-policy changes,
dependencies, hosted deployment or additional migration. The existing Phase 8
implementation was already present in the working tree and has been preserved.

## Findings and fixes

**Medium — stalled mutation could permanently block rating controls and refresh.**
`useDiscover` waited indefinitely for `gateway.rate`. While waiting, every rating
control remained disabled and explicit refresh queued behind that promise. Photo
expiry removed the image but did not release the write. Added a 20-second local
deadline and a cancellation promise that settles even if the transport ignores
AbortSignal. Timeout follows uncertain-response recovery: release queued reads,
re-read authoritative state, and offer explicit retry without automatically
resubmitting a score. Clear timer/listener resources on settlement or account/focus
cancellation. Later transport responses cannot overwrite a newer vote or viewer.

Two new tests failed before the fix and pass afterward: recovery from a never-settling
vote with queued refresh, and a committed-but-unacknowledged vote recovered by read
without replay. A third verifies the new account's score on the same public photo
survives the previous account's delayed response. Existing expiry coverage now also
stalls the automatic recovery read to retain its original expiry assertion.

**Low — documentation still listed settled rating rules as open questions.**
Corrected PRODUCT and documented the audit recovery and test execution constraints.
AGENTS, README, architecture, data model, roadmap and decisions now link or describe
this audit. No rating-policy changes.

**Coverage gaps closed; no database authority defect reproduced.** Added 12 pgTAP
assertions for ±Infinity, pending/missing/unknown submissions, aggregate bounds,
banned/deleted raters and mismatched verified image versions. Added a real stale
REPEATABLE READ visibility race and unchanged feed-order assertion. Added nested
EXPLAIN of the actual feed RPC under a forced generic plan with 50,000 unrelated
votes: one primary-key-backed rating aggregate, no full rating-table scan. The plan
fixture uses a disposable database and rolls back all synthetic data; ordinary
tests retain their original database role.

## Authority review

- Score validation rejects null, fractional, nonfinite and out-of-range numeric
  values before conversion. The table CHECK and composite primary key enforce
  the stored range and one vote per submission/rater. Updates retain identity and
  creation timestamp; same-score retries preserve the full logical row.
- Auth derives the rater; the RPC accepts no caller identity or aggregate values.
  Self, private, pending, deleting/deleted, invalid-account, wrong-target and
  unverified-image cases are rejected. RLS plus revoked table privileges deny raw
  reads/writes and aggregate manipulation through REST. Privileged helpers retain
  empty search paths and cannot be called by ordinary clients.
- Ratings and visibility/deletion share the submission lock. Tests exercise both
  visibility orders, deletion intent, two sessions for one voter, simultaneous first
  votes, retries and stale snapshot rejection. Failed transactions leave the prior
  vote intact. Hard rater/owner cascades produce correct recomputed summaries.
- Feed/signing expose average/count/current-viewer score and owner exclusion,
  without rater IDs or raw history. Pages/signing remain bounded to 24 submissions,
  with one grouped rating query and the existing timestamp/UUID pagination.
  Votes do not move feed items or alter XP, streak or completion authority.
- Account/target/session/focus cancellation, JWT-pinned gateways, receipt identity
  checks and request generations discard obsolete reads and writes. The audit fix
  adds bounded recovery without optimistic aggregate authority or new global state.

Snapshot expectations were checked against PostgreSQL's documentation on
[transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html)
and [function volatility](https://www.postgresql.org/docs/current/xfunc-volatility.html),
then exercised against the local database. Read Committed revalidation follows
committed visibility changes; an old Repeatable Read transaction aborts when it
tries to lock the changed submission.

## Verification results

All checks used local development. The documented Docker `/private/tmp` SQL mirror
contains current repository tests. No remote schema, credentials or data changed.

| Command/check                                                 | Result                                                                     |
| ------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `npm run db:migrate`                                          | Already current; no audit migration needed                                 |
| `npm run check`                                               | Typecheck, zero-warning ESLint, formatting; 277 tests / 31 suites passed   |
| `npx supabase test db /private/tmp/langtify-db-tests/`        | 541 assertions / 13 suites passed; 58 Phase 8 assertions                   |
| `npm run db:test:ratings`                                     | 7 real Auth/Storage/rating concurrency and lifecycle groups passed         |
| `npm run db:test:bootstrap`                                   | 12 migration/backfill/replay/query-plan groups passed                      |
| `npm run db:test:discover`                                    | 7 privacy/signing/pagination/expiry groups passed                          |
| `npm run db:test:integration`                                 | 5 onboarding/username/migration groups passed                              |
| `npm run db:test:challenges`                                  | 4 challenge/catalog concurrency groups passed                              |
| `npm run db:test:submissions`                                 | 10 Storage/lifecycle/recovery groups passed                                |
| `npm run db:test:photo-audit`                                 | 6 verification/expiry/cleanup/concurrency groups passed                    |
| `npm run db:test:progress`                                    | 7 XP/streak/reconciliation/concurrency groups passed                       |
| `npm run db:test:vocabulary`                                  | 7 history/lifecycle/signing/expiry groups passed                           |
| `npx supabase db lint --local --level warning`                | No schema errors                                                           |
| `npm run functions:check`, `functions:lint`, `functions:test` | Passed; 6 function tests                                                   |
| `npx expo install --check`, `npm run doctor`                  | Compatible dependencies; Doctor 21/21 passed                               |
| `npm run export:check -- --clear`                             | iOS/Android Hermes and web; 17 static routes                               |
| `npm run security:scan`, `git diff --check`                   | Source/config/web and both decoded Hermes bundles passed; clean whitespace |

Initial test execution exposed fixture interference when shared-database pgTAP and
integration suites overlapped. No application fix was made for those failures:
integration cleanup left zero fixture users/submissions/ratings and the sequential
pgTAP rerun passed. These suites are now explicitly documented to run sequentially.
Nested EXPLAIN initially required the local Supabase admin role; instrumentation
uses it only in the disposable bootstrap database, without changing grants.
Existing Node module-type/color warnings remain nonfatal tooling output.

## Remaining risks and closure

Phase 8 is suitable to close as an audited implementation after the passing local
checks. Physical-device acceptance and hosted release work remain outstanding;
this is not approval for unrestricted public production launch.

- Verify the existing phone checklist in `PHASE8_VERIFICATION.md`, especially
  delayed/offline writes, refresh while saving, two-device edits and switching
  accounts while viewing the same photo. Verify timeout recovery on both mobile OSes.
- Cancelling HTTP does not undo a database transaction already accepted. A late
  server commit can appear on a subsequent refresh; no stale response populates
  another account and no automatic vote replay is performed. Accepted concurrent
  writes follow database serialization, not device-clock intent order.
- The query bounds submission IDs and output, but exact aggregation still processes
  all votes belonging to a heavily rated photo. Production-scale hot-photo latency,
  request abuse and operational throttling remain unmeasured. No speculative cache,
  new rating limit or product rule was introduced.
- Existing photo URLs remain bearer capabilities until their fixed 60-second
  expiry. Future signing revalidates privacy; downloaded images cannot be recalled.
- Public launch remains gated on moderation/safety, including reporting and blocking.
  Those and all other Phase 9 features remain unimplemented.
