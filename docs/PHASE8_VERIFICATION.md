# Phase 8 verification — Semantic Photo Ratings

Implemented locally under direct user approval, including the AGENTS scope update.
No hosted deployment, new dependencies, Phase 9 work or changes to XP, streak,
authentication, submission completion or private Storage authority.

## Schema and authority

`20260916000000_phase8_ratings.sql` adds `submission_ratings`: submission/rater
composite primary key, integer score CHECK 1–5, server timestamps and cascading
foreign keys. The rater index supports account deletion. Migration replay over
nonempty data preserves votes, feed summaries and every XP event.

Authenticated `rate_submission(submission_id, score)` derives its caller from Auth.
It validates exact integer input, upserts one current vote and returns a validated
viewer/target-scoped summary. A protected trigger locks the submission and rechecks
current Discover eligibility, including saved target, valid accounts, verified
image, public completion and nonownership. Visibility and deletion use the same
submission lock. Same-score retries preserve timestamps; concurrent changes use
the last serialized accepted database write. No client timestamps determine order.

RLS and revoked table privileges deny ordinary direct reads and writes. Only the
controlled RPC may accept client ratings. Private security-definer helpers have
empty search paths and revoked client execution. No raw rater identities/history,
owner identity, aggregate mutation fields or new Storage permissions are exposed.

## Aggregates, UI and lifecycle

One grouped query over at most 24 selected submission IDs computes average, count
and viewer score; `can_rate` indicates owner exclusion. Both feed pages and batch
photo renewal use this projection. There is no per-card request, cached counter or
unbounded rating history endpoint. Zero votes returns null average and zero count.

Discover asks how well the photo represents its assigned word and shows the exact
five semantic labels, aggregate/count and confirmed viewer selection. Pending intent
is visible while controls are disabled; aggregate values change only from server
responses. Owners see aggregates without rating controls. Failed requests support
explicit retry; uncertain responses first reconcile without automatically replaying
old score intent. Older reads cannot overwrite an accepted vote. Account, target,
sign-out, blur and background invalidation abort and discard obsolete work.
Existing 60-second signing and independent monotonic photo expiry are preserved.

Public → private or deletion intent immediately prevents later accepted votes and
future public reads/signing. Existing ratings remain stored while private or
soft-retired, hidden from public access; republishing restores eligible summaries.
Hard submission/owner or rater deletion cascades relevant votes. A replacement
submission ID starts unrated. Ratings have no effect on XP, streaks, completion or
feed ordering. Previously valid votes remain after a rater changes target or is
banned; subsequent writes require current eligibility.

## Verification

Checks ran against local development. Docker file sharing required the existing
documented `/private/tmp` SQL test/function mirrors, using current repository files.

| Command/check                                                 | Result                                                                     |
| ------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `npm run db:migrate`, `npm run db:types`                      | Migration applied; types regenerated                                       |
| `npm run check`                                               | Typecheck, zero-warning lint, formatting and 274 tests / 31 suites passed  |
| `npx supabase test db /private/tmp/langtify-db-tests/`        | 529 assertions / 13 suites passed, including 46 Phase 8 assertions         |
| `npm run db:test:ratings`                                     | 6 real Auth/Storage/concurrency/lifecycle groups passed                    |
| `npm run db:test:bootstrap`                                   | 11 bootstrap/backfill/replay groups passed                                 |
| `npm run db:test:discover`                                    | 7 privacy, signing, pagination and real expiry groups passed               |
| `npm run db:test:integration`                                 | 5 onboarding/username/migration groups passed                              |
| `npm run db:test:challenges`                                  | 4 challenge/catalog concurrency groups passed                              |
| `npm run db:test:submissions`                                 | 10 Storage/lifecycle/recovery groups passed                                |
| `npm run db:test:photo-audit`                                 | 6 byte verification/expiry/cleanup/concurrency groups passed               |
| `npm run db:test:progress`                                    | 7 XP/streak/reconciliation/concurrency groups passed                       |
| `npm run db:test:vocabulary`                                  | 7 history/lifecycle/signing/expiry groups passed                           |
| `npx supabase db lint --local --level warning`                | No schema errors                                                           |
| `npm run functions:check`, `functions:lint`, `functions:test` | Passed; 6 function tests                                                   |
| `npx expo install --check`, `npm run doctor`                  | Dependencies compatible; Doctor 21/21 passed                               |
| `npm run export:check -- --clear`                             | iOS/Android Hermes and web exported; 17 static routes                      |
| `npm run security:scan`, `git diff --check`                   | Source/config/web and both decoded Hermes bundles passed; clean whitespace |

New coverage includes scores 1–5, null/fractional/nonfinite/out-of-range rejection,
self/private/deleting/deleted/invalid-owner/anonymous denial, spoofed identity and
direct REST denial, exact averages/counts, viewer privacy, duplicate retries,
two-device concurrent changes, deterministic rating-versus-visibility/deletion
lock barriers, retain/restore and hard cascades. Application tests exercise pending
controls, owner denial, uncertain commits, explicit retries, unavailable content,
old read ordering, queued refresh, stalled mutation expiry and account/target/session
invalidation. Existing feed pagination and all prior database/RLS suites remain green.

Existing Node module-type/color and type-generator listener warnings are nonfatal
tooling output. Exports are not native binary builds or physical-device acceptance.

## Phone acceptance and deployment

1. Apply the migration to the intended hosted development environment, then deploy
   the matching `photo-authority` function before the app. Preserve the private
   bucket and existing cleanup job. No hosted changes were made here.
2. Use two onboarded accounts with the same target on iOS and Android development
   builds. Rate an eligible public photo 1–5, change a score, refresh and verify one
   vote, correct average/count and viewer selection. The owner sees no vote controls.
3. Use two devices for one voter. Submit changes concurrently, then refresh both;
   both must show the one server-accepted score. Rapid repeated taps must not add votes.
4. Make the photo private or start deletion during a delayed vote. Confirm an
   unavailable response clears the card; refresh/renew removes its public access.
   Republish and verify existing votes return. A new submission starts unrated.
5. Disconnect after sending a vote; reconnect and verify reconciliation, then test
   explicit retry. Background/resume, sign out, switch accounts or targets during
   delayed reads/writes; previous viewer selections/photos must not reappear.
6. Check large text, VoiceOver/TalkBack, dark mode, small screens and scrolling
   through more than 24 cards. Confirm the labels communicate vocabulary meaning.
   Leave Discover open beyond a minute and verify renewal and stalled-request expiry.
7. Smoke-test password/Google login, onboarding, camera, deletion, Today progress
   and My Vocabulary. Verify rating activity does not change XP or streaks.

## Remaining risks

- Hosted deployment and physical-device acceptance remain outstanding. Public
  production launch remains gated on moderation/safety, including blocking and
  reporting; none of that future functionality was implemented.
- Signed URLs are bearer capabilities until their existing 60-second expiry.
  Privacy changes prevent future signing but cannot recall downloaded photos.
- Bounded pages avoid N+1 requests, but aggregating a heavily rated photo still
  scans its current votes. Production-scale latency, abuse throttling and load
  testing remain operational work; no speculative cache or new product limit added.
- Cancelling a client request cannot undo a server transaction already accepted.
  Obsolete UI responses are discarded and later reads reconcile. Two devices use
  database serialization order, not device-clock or offline-intent ordering.
