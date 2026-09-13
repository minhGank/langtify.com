# Phase 7 audit — Public Discover Feed

Scope: privacy, eligibility, signing, pagination, account isolation and query cost.
Audited the existing Phase 7 working tree; preserved prior implementation changes.
No Phase 8 features, new dependencies, product-policy changes or hosted deployment.

## Findings and fixes

| Severity | Reproduction / impact                                                                                                                                                                                                            | Correction                                                                                                                                                                                        |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Medium   | With a generic prepared plan, the optional-cursor OR expression was a filter on `submissions_discover_newest`, rather than an index bound. Deeper pages could rescan newer rows.                                                 | Additive `20260915010000_phase7_audit_pagination.sql` uses a direct timestamp/UUID upper bound and an internal first-page sentinel. External validation, eligibility and output are unchanged.    |
| Medium   | A missing/error result for one eligible Storage signing target was silently removed by `flatMap`. The client accepted the partial batch and advanced past the unseen card without a retry indication.                            | Explicit public projection in `feed-photos.ts` fails the whole batch with a retryable 503 when an eligible target lacks a valid signature. Only the eligibility lookup may silently exclude rows. |
| Medium   | When revalidation emptied the retained window, the following renewal called `load(null)` and returned to page one. In deeper browsing this could replay already viewed rows.                                                     | Keep the saved cursor and lookahead for an emptied window. Load more advances from that position; explicit refresh returns to newest. Corrected empty-window copy.                                |
| Low      | Invoking a retained AppState callback after gateway replacement or blur/refocus cleared the newer session's feed. Request guards did not protect the event callback itself. No cross-account response installation was observed. | Focus-local lifetime checks ignore stale lifecycle/interval callbacks, including when the same gateway is reused after refocus.                                                                   |

The signing and lifecycle regression tests failed against their original behavior
before passing with fixes. A separate test reproduced the empty-window first-page
restart before its correction. Original Phase 7 migrations remain intact.

Nested EXPLAIN of the actual RPC under a forced generic plan now shows:

```text
Index Scan using submissions_discover_newest on submissions
  Index Cond: (ROW(submitted_at, id) < ROW(COALESCE(...), COALESCE(...)))
```

The local probe used a rolled-back fixture and the local database administrator
for `auto_explain`; ordinary `postgres` cannot load that diagnostic library. It
made no lasting data, role or server-configuration changes. Sequential scans were
disabled for the small-fixture probe to establish indexability, not to claim a
production load benchmark. See [PostgreSQL prepared plans](https://www.postgresql.org/docs/current/sql-prepare.html).

## Privacy and authority review

No private-read, arbitrary-path signing, profile/email disclosure or public-mutation
bypass was found in the reviewed paths and adversarial tests:

- Feed and signing share one eligibility view: completed/public, active assignment,
  onboarded username, nondeleted/unbanned Auth owner and matching verified object
  ID/version/bucket/path. Pending/deleting/deleted and invalid images are excluded.
- Viewer identity comes from Auth; target language comes from saved learning state.
  The privileged signing helper checks the asserted target against that state and
  is executable only by service role. Caller identity/path/TTL overrides are ignored.
- Feed items contain exactly submission ID, historical target/reference text, CEFR,
  username and submitted date. The envelope's viewer UUID is the caller's own
  identity. No submitter UUID, email, private profile, challenge or XP fields are
  exposed by the feed projection. Username changes refresh through the signer.
- Signed capabilities necessarily contain the existing object address, including
  its owner UUID, in the URL path. This is documented Phase 7 behavior, not a raw
  profile field or an authorization grant to other private data. Hiding it would
  require changing Storage keys or adding a serving proxy; neither was introduced.
- Signed access remains 60 seconds. The bucket stays private; owner preview APIs
  remain owner-only. Mixed/max-size batches, UUID aliases, pending/unknown/private
  IDs and arbitrary path/target/TTL inputs cannot widen read access.
- Public visibility does not grant source-table access, Storage deletion or owner
  mutation rights. Tests verify direct REST/RLS and RPC denial. XP history is
  unchanged by feed reads, signing, username and visibility changes.
- Timestamp/UUID keysets retain microseconds and tied ordering, including when the
  cursor row becomes private. Pages remain live: a newly published row ahead of the
  cursor is found on refresh, not retroactively injected into older pages.
- JWT/viewer/target keys, request generations, aborts, focus/foreground guards and
  independent monotonic expiry protect account isolation and stalled renewals.
  Client memory and each signing batch remain capped at 24 items. Profile/term
  joins and batch signing avoid per-card network requests.

## Verification results

Local development only. Docker's documented `/private/tmp` test/function mirrors
were refreshed before running the suites.

| Command/check                                                 | Result                                                                                          |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `npm run db:migrate`                                          | Additive audit migration applied locally                                                        |
| `npm run check`                                               | Typecheck, zero-warning ESLint, formatting; 264 tests / 31 suites passed                        |
| `npx supabase test db /private/tmp/langtify-db-tests/`        | 483 assertions / 12 suites passed; 26 new SQL audit assertions                                  |
| `npm run db:test:discover`                                    | 7 real Auth/Storage/privacy/pagination/signing/expiry groups passed                             |
| `npm run db:test:integration`                                 | 5 onboarding/username/migration groups passed                                                   |
| `npm run db:test:challenges`                                  | 4 generation/replacement/catalog concurrency groups passed                                      |
| `npm run db:test:submissions`                                 | 10 Storage/ownership/lifecycle/recovery groups passed                                           |
| `npm run db:test:photo-audit`                                 | 6 byte verification/expiry/cleanup/concurrency groups passed                                    |
| `npm run db:test:progress`                                    | 7 XP/streak/deletion/concurrency groups passed                                                  |
| `npm run db:test:bootstrap`                                   | 10 bootstrap/replay/backfill groups passed; audit replay preserves nonempty feed, photos and XP |
| `npm run db:test:vocabulary`                                  | 7 owner history/RLS/signing/expiry groups passed                                                |
| `npx supabase db lint --local --level warning`                | No schema errors                                                                                |
| `npm run functions:check`, `functions:lint`, `functions:test` | Passed; all 6 function tests run by the expanded test command                                   |
| `npx expo install --check`, `npm run doctor`                  | Compatible; Doctor 21/21                                                                        |
| `npm run export:check -- --clear`                             | iOS/Android Hermes and web exports passed; 17 static routes                                     |
| `npm run security:scan`                                       | Source/config/web and both decoded Hermes bundles passed                                        |
| `git diff --check`                                            | Passed                                                                                          |

Existing module-type and terminal-color tooling warnings were nonfatal. The new
nullable Storage result type was corrected during function typechecking. Initial
intentional regression failures are resolved. Database types did not change: the
audit migration preserves every RPC signature and return type.

## Remaining risks and closure

The Phase 7 implementation/code audit can close after these fixes. Deployment and
physical-device acceptance remain open; this is not public-production approval.

- Deploy the additive audit migration and matching `photo-authority` source including
  `feed-photos.ts` to the intended development environment. No hosted changes were made.
- On iOS and Android, check long-scroll window eviction, complete-window visibility
  removal followed by renewal/Load more, failed-photo retry, rapid tab changes,
  account/target switching, session loss and background/resume on slow networks.
  Exports are not native binary or device acceptance.
- Signed URLs are shareable until their original expiry. Concurrent reads/signing
  may observe the pre-change eligibility snapshot. No immediate revocation or
  recall of already downloaded images is promised.
- Page output and client memory are bounded; total database work depends on eligible
  language density and data distribution. Sparse-language and production-scale
  latency, abuse throttling and operating costs still require load validation.
- **Public production launch remains gated on moderation/safety, including blocking
  and reporting.** Ratings, social interactions and all Phase 8 work remain absent.
