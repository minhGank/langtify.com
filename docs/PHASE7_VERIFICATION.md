# Phase 7 verification — Public Discover Feed

Implemented locally under explicit user authorization to update AGENTS and add
controlled public read/signing access. No Phase 8 functionality or hosted deployment.
No dependencies, authentication, completion, XP/streak or owner mutation rules changed.

## Implementation

- Migration `20260915000000_phase7_discover.sql`: private shared eligibility view,
  saved-viewer-target helper, authenticated public projection RPC, service-only
  signing target RPC, partial newest-feed index and assignment-language index.
  No new business tables or lifecycle triggers. Empty search paths and explicit
  grants protect privileged reads; source RLS and the private bucket remain intact.
- `get_discover_feed` returns only submission ID, historical target/reference terms,
  CEFR, public username and submission time. Its envelope includes the caller's own
  identity/target for stale-context validation. No owner UUID, email, private profile,
  raw Storage path, challenge ID or XP data is returned in feed items.
- Eligibility requires completed/public status, an onboarded owner with username,
  nondeleted/unbanned Auth account and an existing verified image ID/version. Viewer
  must be authenticated/onboarded with the matching saved target language. Repeated
  concept captures remain distinct. Owners see their own eligible photos.
- Keyset uses exact server `(submitted_at DESC,id DESC)`, default 12/max 24 rows
  with bounded lookahead. Client retains at most 24 items and batch-signs that window.
  Load more advances; refresh returns to newest. New publishing keeps original dates.
- Existing `photo-authority` adds `feed-previews`: Auth-verified viewer, bounded UUID
  batch, saved-target assertion and service-only eligibility lookup. One Storage batch
  signs eligible paths for exactly 60 seconds. Public metadata is revalidated with
  signatures, so newly private/deleting photos leave the retained window on renewal.
- Discover now has vocabulary cards, loading/empty/error states, pull-to-refresh,
  Load more, image retry and renewal. JWT/viewer/target guards and request cancellation
  isolate state; blur/background clears it. A monotonic 55-second client deadline
  clears URLs independently of stalled renewal. Visible batches renew every 45 seconds.
- Photo-preview public copy now explains current Discover exposure. Private remains
  the default. Canonical product/architecture/data/roadmap/decision/agent docs updated.

## Verification results

All checks run against local development only. Docker's `/Applications` sharing
restriction required the documented `/private/tmp` test/function mirrors.

| Command/check                                                 | Result                                                                                 |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `npm run db:migrate`, `npm run db:types`                      | Applied and regenerated successfully                                                   |
| `npm run check`                                               | Typecheck, zero-warning ESLint, formatting, 259 tests / 31 suites passed               |
| `npx supabase test db /private/tmp/langtify-db-tests/`        | 457 assertions / 11 suites passed; includes 32 Phase 7 assertions                      |
| `npm run db:test:discover`                                    | 6 real Auth/Storage/signing/privacy/pagination/expiry groups passed                    |
| `npm run db:test:integration`                                 | 5 onboarding/username/migration groups passed                                          |
| `npm run db:test:challenges`                                  | 4 creation/replacement/catalog concurrency groups passed                               |
| `npm run db:test:submissions`                                 | 10 Storage/ownership/lifecycle/recovery groups passed                                  |
| `npm run db:test:photo-audit`                                 | 6 byte verification/expiry/cleanup/concurrency groups passed                           |
| `npm run db:test:progress`                                    | 7 XP/streak/reconciliation/concurrency groups passed                                   |
| `npm run db:test:bootstrap`                                   | 9 bootstrap/replay/backfill groups passed, including Phase 7 replay over nonempty data |
| `npm run db:test:vocabulary`                                  | 7 history/RLS/batch expiry/lifecycle groups passed                                     |
| `npm run test:auth:integration`                               | 2 real Auth session/password regression groups passed                                  |
| `npx supabase db lint --local --level warning`                | No schema errors                                                                       |
| `npm run functions:check`, `functions:lint`, `functions:test` | Passed; 4 JPEG tests                                                                   |
| `npx expo install --check`                                    | Dependencies compatible                                                                |
| `npm run doctor`                                              | 21/21 passed                                                                           |
| `npm run export:check -- --clear`                             | iOS/Android Hermes and web; 17 static routes                                           |
| `npm run security:scan`                                       | Source/config/web and both decoded Hermes bundles passed                               |
| `git diff --check`                                            | Passed                                                                                 |

New tests exercise tied microsecond timestamps, no duplicate keyset results, minimal
public keys, immutable catalog snapshots, valid-owner checks, target overrides,
public/private transitions, missing/deleting/deleted images, mixed private/unknown
signing batches, arbitrary paths/TTL/identity inputs, existing owner-only endpoints,
actual URL server expiry and renewal, concurrent visibility/signing snapshots,
bounded memory/batches, pull refresh, image retry and stale account/target callbacks.

Initial development checks caught a reload callback type mismatch and a formatting
failure; both were corrected. Node's existing module-type/color and type-generator
listener warnings are nonfatal tooling output. No application or database failures
remain in final verification.

## Physical-device acceptance and deployment

1. Apply the new migration to the intended hosted development project, then deploy
   the matching `photo-authority` function before testing the app. Retain private
   bucket settings and the existing hourly cleanup job. No hosted changes were made.
2. On iOS and Android development builds, use two onboarded accounts with the same
   target. Submit one private and one public photo; only public should appear to the
   other account. Confirm the owner's own public card, vocabulary, username and date.
3. Scroll through more than 24 captures. Load more must maintain a usable scroll
   position as the retained window advances. Pull to refresh returns to newest.
   Check large text, dark mode, image loading/failure/retry and slow/offline recovery.
4. Change public → private and refresh/renew on the other phone; remove the card.
   Publish it again and check its original submission ordering. Begin/finish deletion
   and verify it disappears while Today, XP and My Vocabulary retain prior semantics.
5. Change target language; verify no prior-target cards or URLs remain. Switch
   accounts/sign out during a delayed load/signature, expire the session, background
   and resume the app; no previous account data may reappear.
6. Leave Discover open beyond a minute, then test slow/stalled renewal. Active photos
   renew; expired capabilities disappear and retries restore currently eligible ones.
   Previously issued public URLs may remain valid until their original 60-second expiry.
7. Smoke-test Google and password login, onboarding and existing camera/recovery flows.
   Hosted Google/device acceptance is separate from successful exports.

## Remaining limits and launch gate

- **Public production launch is gated on moderation/safety, including blocking and
  reporting.** Ratings and all other Phase 8/social functionality remain unimplemented.
- Public photos are bearer-readable after controlled signing; URLs can be shared for
  their short lifetime and downloaded images cannot be recalled. Privacy changes
  affect future eligibility snapshots; concurrent in-flight reads may observe prior
  state. This is not instantaneous revocation or realtime synchronization.
- Hosted migrations/function deployment, native binary builds and physical-device
  acceptance remain outstanding. Export does not establish native runtime acceptance.
- Indexes and bounded queries/batches are in place; production-scale load/latency,
  abuse throttling and operating-cost validation have not been performed. There is
  no arbitrary full-catalog fetch or per-card profile/term/signing loop.
- The existing vocabulary seed is development content. Production catalog review,
  Google/store acceptance and prior deployment handoff work remain separate.
