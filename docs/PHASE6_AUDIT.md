# Phase 6 audit — personal visual dictionary

Audited September 13, 2026. Scope: owner-only history, immutable snapshots,
concept grouping, search/pagination, private batch previews, deletion and client
account/lifecycle isolation. Phase 7 was not started. Existing Phase 6 working-tree
changes were preserved; no migration, database policy, product rule, dependency,
Auth/provider flow or XP behavior was changed by this audit.

## Findings and fixes

1. **Medium — inactive or obsolete callbacks could start new history reads.**
   Generation checks protected requests already in flight, but initial background
   mounts/token changes still called the loader. A retained callback after unmount
   could also start work; after a gateway/filter change, an old callback could
   replace current results with the old query. Reproductions failed before fixes.
   Read admission now requires a focused foreground screen and the current gateway;
   blur/background/unmount revoke admission. AbortSignals cancel superseded HTTP
   work, and existing response-generation/owner checks remain. No cross-user data
   installation was reproduced; the account-keyed component boundary held.
2. **Low — a backward wall-clock adjustment could retain expired preview state.**
   After a signing response was delayed beyond 60 seconds, moving device time back
   made the client calculate a long positive lifetime. The server still rejected
   the expired URL. Client deadlines now use monotonic elapsed time, retaining the
   conservative 55-second bound beginning before signing. The regression exercises
   a real elapsed minute plus backward clock adjustment.
3. **Low — image retry could remain permanently marked failed for the same URL.**
   The card remembered a failed URI. Retrying a batch that returned that same
   still-valid URL did not clear failure, so the image was never retried. Accepted
   preview batches now create fresh image instances. The regression reproduces
   failure, same-URL renewal and successful remount.
4. **Low — UUID case handling and direct-entry recovery were inconsistent.**
   The signer accepted uppercase UUID syntax but compared returned lowercase IDs
   literally, producing null for an owned completed photo. Mixed-case aliases also
   bypassed duplicate-input validation. Both comparisons are now case-insensitive.
   Concept deep links normalize UUID case, and direct concept entry has a safe
   Vocabulary fallback when no navigation history exists.

Tests now explicitly model AppState as a string. The prior Jest Expo mock exposed
it as a function, leaving some timer assertions unable to exercise their intended
active-app branch. New tests cover background mounts, obsolete callbacks, aborted
network work, clock adjustment, identical-URL retry and direct-entry recovery.

## Security, correctness and performance review

No cross-user history/photo access, direct mutation bypass, ghost concept, immutable
snapshot rewrite or fixed-data pagination defect was found in the exercised paths.

- The history RPC is security invoker, has an empty search path, derives identity
  from `auth.uid()` and joins RLS-protected submissions/assignments. Anonymous
  execution is revoked. No caller user ID is accepted. Private and public-visibility
  photos are equally owner-only. A foreign concept or cursor never grants access.
- Only completed submissions qualify. Pending/deleting/deleted captures are excluded.
  Deleting the latest restores the prior snapshot/photo; deleting the last removes
  the concept and detail summary. Existing finished-deletion XP semantics remain.
- Semantic UUID grouping preserves ambiguous identical spellings as separate concepts.
  Repetitions retain one latest card plus every surviving capture. Catalog/learning
  changes do not rewrite immutable term, language or CEFR snapshots.
- Search/CEFR apply to the latest displayed capture as documented, before cursor
  pagination. Literal `%`/`_`, combined filters, timestamp ties, microsecond differences,
  and several page sizes match full expected results without omissions/duplicates
  when the underlying data is unchanged. A 36-capture concept traverses once across
  pages; default and maximum pages remain 12 and 24.
- One page uses one history RPC and one preview invocation, with no signing request
  for an empty page. The function uses one bounded owned-row query plus one Storage
  batch call. Tests check the token-pinned transport and cancellation signals.
  Actual image downloads are necessarily per image; there are no per-card term or
  authorization RPCs. Only one bounded page is kept in client state.
- Mixed batches of 24 IDs return images only for owned completed rows. Foreign,
  unknown, pending and deleting IDs return null. Case aliases cannot duplicate the
  same submission. Anonymous calls, direct Storage signing, caller TTL, foreign
  paths and download-option attempts do not broaden access.
- Actual batch previews expire after the fixed 60 seconds while their objects remain
  valid; fresh owner-authorized signing restores access. Expiration is therefore
  verified independently of deletion. URLs are not persisted or passed to Router.
- Password and Google sessions share the same UUID/JWT history service. Account
  switches, sign-out and lost readiness clear the protected screen; late results
  cannot populate a new account. The service pins its original JWT throughout.

## Verification

All checks target this checkout and local development Supabase. Docker-shared SQL
and function source were refreshed through the documented `/private/tmp` fallback.
No hosted project was modified.

| Check                                                         | Result                                                                                                           |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `npm run check`                                               | Typecheck, lint, format and 246 application tests in 29 suites passed                                            |
| `npx supabase test db /private/tmp/langtify-db-tests/`        | 425 assertions in 10 suites passed; 38 new audit assertions                                                      |
| `npm run db:test:vocabulary`                                  | 7 integration groups passed, including mixed batches, concurrent lifecycle reads and actual batch expiry/renewal |
| `npm run db:test:submissions`                                 | 10 real Auth/Storage lifecycle/access/recovery checks passed                                                     |
| `npm run db:test:photo-audit`                                 | 6 byte-verification, expiry, cleanup and concurrent Storage checks passed                                        |
| `npx supabase db lint --local --level warning`                | No schema errors                                                                                                 |
| `npm run functions:check`, `functions:lint`, `functions:test` | Passed; 4 JPEG safety tests                                                                                      |
| `npx expo install --check`                                    | Dependencies compatible/up to date                                                                               |
| `npm run doctor`                                              | 21/21 checks passed                                                                                              |
| `npm run export:check -- --clear`                             | iOS and Android Hermes plus web exports passed; 17 static routes                                                 |
| `npm run security:scan`                                       | Source/config/web and both decoded Hermes bundles passed                                                         |
| `git diff --check`                                            | Passed                                                                                                           |

The new reproduction tests initially failed against the implementation, then passed
after fixes. SQL audit fixtures alter only isolated rollback-owned test snapshots
when forcing equal/submillisecond timestamps; real JPEG/API tests retain all normal
production authority. Existing Node module-format and Metro color/cache notices
are informational. Platform exports are not physical native acceptance.

## Audit changes

Application/function files: `src/features/vocabulary/use-vocabulary.ts`,
`src/features/vocabulary/vocabulary-screen.tsx`, `src/services/vocabulary.ts`, and
`supabase/functions/photo-authority/index.ts`.

Tests: expanded `tests/vocabulary.test.tsx` and
`scripts/test-vocabulary-integration.mjs`; added `tests/vocabulary-service.test.ts`
and `supabase/tests/phase6-audit.test.sql`. Updated AGENTS, README, architecture,
decisions, roadmap and the implementation report's audit link. The original
Phase 6 migration and database schema are unchanged.

## Remaining risks and closure

**Phase 6 is safe to close as an implementation/code audit.** Hosted deployment and
physical-device acceptance remain release gates; no critical/high access-control
issue remains from this audit.

- Deploy the audited app/function alongside the existing Phase 6 migration to the
  intended development project. On iPhone and Android verify background/token refresh,
  sign-out/account switching during loading, failed-image retry, pagination, and
  visibility/deletion return paths. Google physical acceptance remains separate.
- Pages are live snapshots per request, not a frozen traversal. A concurrent new
  capture can move a concept before the cursor; deleting its latest capture can
  move it to a later page, so it can be encountered again while paging. Refresh
  restarts at current latest. This existing documented behavior was preserved;
  stronger cross-request snapshot guarantees would require a separate design decision.
- Exact counts/latest grouping scan the owner's surviving history even though the
  returned payload and client state are bounded. Review production-scale plans,
  latency and image bandwidth; this audit does not claim a large-scale load test.
- Already issued signed URLs remain bearer capabilities until expiry, and downloaded
  bytes cannot be recalled. Authorization is checked when each request reads the
  row; a concurrent deletion can occur after that read. Physical removal blocks
  subsequent object fetches. No stronger immediate-revocation policy was added.
- Existing cleanup scheduling and production vocabulary/content review requirements
  remain unchanged. No feed, ratings or other Phase 7 functionality was introduced.
