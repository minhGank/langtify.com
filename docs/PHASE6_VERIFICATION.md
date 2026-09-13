# Phase 6 verification — personal vocabulary history

Implemented on September 13, 2026 in `/Applications/langtify.com`. All database,
Auth and Storage tests target local Supabase with isolated/rolled-back fixtures.
No hosted migration/deployment, Google provider change or Phase 7 work was performed.

This report records implementation verification. The subsequent
[Phase 6 audit](PHASE6_AUDIT.md) contains the fixes and latest test results.

## Schema and query

`20260914000000_phase6_vocabulary_history.sql` adds an indexed read projection:
`get_my_vocabulary`. No new table, write endpoint, completion flag or XP projection.
It joins completed submissions to immutable assignment snapshots. Its stable,
security-invoker SQL statement uses JWT identity and source-table RLS. Anonymous
execution is revoked. Input limits: 100-character search, valid CEFR, paired finite
timestamp/UUID cursor, 1–24 results (app uses 12).

One semantic concept UUID produces one library card, even across dates and language
pairs. Spelling is never the grouping key. Latest submitted timestamp/UUID selects
the card, its terms, CEFR and image. Counts include surviving completed captures.
Detail retains every such capture, newest first; summary remains latest even on
older pages. Catalog text and current learning settings do not rewrite snapshots.

## UI and synchronization

Vocabulary is now My Vocabulary: total unique concepts, search, CEFR buttons,
photo cards and explicit bounded pages. Search is literal, case-insensitive substring
matching on the displayed latest target/reference terms. CEFR matches the displayed
latest level. Counts remain unfiltered; older captures are visible in concept detail.
No category inference or Profile metric change was necessary.

The protected `/vocabulary-concept` route opens capture history and existing `/photo`
management. Photo Back now returns through the stack, with Today as direct-entry
fallback. Visibility/deletion retain the existing authority. Deleting/pending/deleted
rows are hidden; surviving older photos become latest, and removing the last photo
removes its concept. Hiding deletion intent does not move Phase 5 XP reversal earlier.

Focus/resume/pull-to-refresh reload latest. Active 45-second refresh reloads the
current page without superseding an in-flight user page request. One page is retained,
not an accumulating full gallery. Errors/retries, no matches, empty/deleted concept,
missing image, failed image load and expired URL states have recovery controls.

## Photo and account security

The existing trusted function now accepts a bounded `previews` action: up to 24
distinct UUIDs, one owned-completed-row query and one batch Storage signing call.
No per-card RPC/term lookup, arbitrary path, transform, download option or caller TTL.
Missing, pending, deleting, deleted and foreign IDs produce no URL. Every URL has
the existing fixed 60-second lifetime, including public-visibility photos. The
bucket and all Storage policies remain unchanged/private.

The app validates returned owner/concept and exact signed-path identity, uses a
non-persisting token-pinned client, and stores no signed URL in routes or persistence.
Account-keyed screens and request generations discard late reads/photos on account,
session, token, query or focus changes. Background/blur clear data and images.
A 55-second deadline beginning before signing clears expired images independently
of stalled refreshes. Resume reloads server state. Password and Google sessions
use exactly the same UUID-based path; authentication code is unchanged.

## Verification results

| Command/check                                                 | Result                                                                                                                                          |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run db:migrate`                                          | Applied the additive Phase 6 migration locally                                                                                                  |
| `npm run db:types`                                            | Public types regenerated; CLI emitted its existing MaxListeners warning                                                                         |
| `npm run check`                                               | Typecheck, lint, Prettier and application tests passed; 238 tests in 28 suites                                                                  |
| `npx supabase test db /private/tmp/langtify-db-tests/`        | 387 assertions in 9 suites passed, including 32 new history assertions                                                                          |
| `npm run db:test:integration`                                 | 5 onboarding/seed/migration/concurrency checks passed                                                                                           |
| `npm run db:test:challenges`                                  | 4 generation/replacement/catalog concurrency checks passed                                                                                      |
| `npm run db:test:submissions`                                 | 10 real Auth/Storage lifecycle and access checks passed                                                                                         |
| `npm run db:test:photo-audit`                                 | 6 verification/cleanup/recovery checks passed, including actual server URL expiry                                                               |
| `npm run db:test:progress`                                    | 7 XP/RLS/concurrency checks passed                                                                                                              |
| `npm run db:test:bootstrap`                                   | 8 checks passed, including Phase 6 replay over existing photos/XP without mutation                                                              |
| `npm run db:test:vocabulary`                                  | 5 integration groups passed: actual JPEG completions, grouping/search/pages, batch signing/privacy/60-second TTL, deletion and concurrent reads |
| `npx supabase db lint --local --level warning`                | No schema errors                                                                                                                                |
| `npm run functions:check`, `functions:lint`, `functions:test` | Passed; 4 real JPEG validation tests                                                                                                            |
| `npx expo install --check`                                    | Dependencies compatible/up to date                                                                                                              |
| `npm run doctor`                                              | 21/21 passed                                                                                                                                    |
| Public Expo config assertion                                  | Langtify/`langtify`, scheme and both `com.langtify.app` identifiers preserved                                                                   |
| `npm run export:check -- --clear`                             | iOS/Android Hermes and web exports passed; 17 static routes                                                                                     |
| `npm run security:scan`                                       | Source/config/web and both decoded Hermes bundles passed; no privileged credentials/server implementation                                       |
| `git diff --check`                                            | Passed                                                                                                                                          |

The Docker file-sharing fallback copies SQL and current function source to
`/private/tmp`; the running function was refreshed before integration. The first
new integration attempt reached an older served function and failed at batch
previews. After updating that Docker-shared copy, the same tests passed. Existing
Node strip-types/module-format and Metro color/cache notices are informational.

Application coverage includes both auth provider paths, search/filter dispatch,
empty/error/retry/deletion refresh, existing photo route reuse, bounded cursor
navigation, old-account and obsolete-token responses, pending signed responses,
background/resume, expiry/reload and periodic-refresh/page-request races. SQL and
real API tests exercise first/repeated/multiple concepts, count/latest choice,
both search languages, CEFR, snapshot stability after catalog edits, owner/private
and foreign/public access, cursor boundaries, bounds and deletion fallback.

## Physical-phone acceptance

On both an iPhone and Android phone, using the Langtify development build:

1. Deploy the reviewed migration and updated photo-authority function to the same
   hosted development project. Keep existing cleanup scheduling. Check an empty
   account's Vocabulary state, then capture/submit a word and open its card.
2. Photograph multiple concepts; use a prepared development account with repeated
   concepts and more than 12 entries to check latest cards, counts, Next page and
   Back to latest. Open detail and a prior photo, then return with Back.
3. Search target and reference terms with mixed case; combine CEFR filters, no-match
   searches and clear/reset. Check keyboard, safe areas, text scaling and scrolling.
4. Change visibility in existing photo detail and return. Delete the latest of
   multiple captures, then the last one; check fallback/removal and existing XP.
5. Stay on the list past 60 seconds, background/resume and interrupt connectivity.
   Verify refreshing/expired-image recovery and that older pages remain navigable.
6. Switch password/Google accounts or sign out while history/photos load. No prior
   account's terms/photos may appear. Confirm onboarding still gates both methods.

Physical Google consent, verified-email automatic linking and cold/warm OAuth
callbacks remain the separate pending Phase 5.5 acceptance; no simulated test here
claims to validate an actual Google login on hardware.

## Remaining risks and deployment limits

- No hosted changes or physical native acceptance occurred. Export is not a signed
  native binary build, device camera test or Google acceptance.
- Exact grouping/counts still scan the owner's surviving history. Responses and
  client memory are bounded, but production-scale latency and original-image
  bandwidth need measurement before adding projections or thumbnails.
- Keyset pages are live database snapshots per request. Concurrent submissions or
  deletions can move a concept between pages; refresh returns to current latest.
  Remote visibility/deletion updates become visible on refresh, not push delivery.
- Existing signed URLs remain bearer capabilities until their fixed expiry; files
  already downloaded cannot be recalled. No new public photo policy was introduced.
- The existing development vocabulary catalog and hourly cleanup operational
  requirements remain unchanged. No community or Phase 7 functionality is included.
