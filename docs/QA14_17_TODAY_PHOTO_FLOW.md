# QA #14–17 — Today, preview and canonical post flow

Scope is presentation/navigation only. No Phase 11, dependency, native configuration,
schema, Edge Function, XP/streak rule, commit, push or deployment change.

## Design and changed surfaces

- Today retains the three words, 0–3 daily progress, completion bonus and streak.
  Profile retains total XP and level. Word/translation rows have one accessible
  disclosure target, distinct from Replace and Take photo.
- Today opens the existing `/explore-concept` screen used by Search. The owned
  assignment is resolved through the existing RPC; its concept must match the URL.
  Immutable translation, CEFR and language survive changed learning settings.
  Examples still use the current saved learning language, labeled when different.
  “Your photos” opens the existing concept-specific Vocabulary history. Its optional
  count is one bounded, cached metadata read, with no per-image requests.
- `PhotoPreview` prioritizes the photo and vocabulary context. `Screen` supplies
  an optional safe-area footer for privacy and the single Add photo CTA. The image
  must finish loading before that CTA becomes available. Small screens and large
  text retain scrolling content without burying the primary action.
- `PhotoOptions` puts Retake photo, Choose from library and Discard photo behind
  overflow. “Choose another photo” is removed. Camera and library use the same
  preview and existing normalization/reserve/upload/finalize path.
- Cancelling a library reselect or camera retake keeps the original draft and its
  privacy choice. Android Back cancels a retake before leaving capture. A confirmed
  discard uses the existing lifecycle; already uploaded objects cannot be silently
  overwritten by a local selection. The completed-owner menu retains visibility
  editing and explicit deletion/reward-consequence confirmation.

## Submission and authority

`PhotoScreen` no longer renders a completion/XP result page. A completed row replaces
the capture route with `/post?submissionId=…`; native Back/edge-back returns to the
source. A completed deep link/recovery uses the same destination without success
feedback. Only IDs enter navigation, never media URLs, receipt amounts or flags.

The existing `PostDetail` is shared by Discover and owner photos. `/post` resolves
owner linkage with a bounded owner-only RLS read, pinned Auth token and cancellation.
The authenticated assignment RPC verifies lifecycle and immutable snapshots; a
different submission ID on the same assignment cannot substitute for the URL's photo.
The owner can view private or publicly restricted content without enabling public
interactions. Comments, sharing and authoritative rating summaries require the
existing Discover read to admit the public photo. Self-rating remains unavailable.
There is no new table grant, service credential, public Storage policy or signing path.

An explicit successful finalize installs the authoritative completed row immediately.
Only when this operation uploaded the bytes may those exact prepared JPEG pixels
enter the existing bounded owner image cache; another device's preexisting upload
must use its own verified preview. Signed URL expiry and download admission remain
unchanged. Session clearing removes pixels, metadata and acknowledgement markers.

The existing accepted-finalize haptic runs once. A session-scoped, one-use marker
allows a four-second “Photo added” overlay on the post. An existing server XP receipt
may add its word/bonus/milestone total to that acknowledgement. It never blocks
navigation, invents XP or writes progression. Late, expired, background and old-account
receipt responses are ignored; revisits and lost-acknowledgement recovery stay silent.
Reduce Motion uses the existing shared animation setting. Private posts never mount
public comment/share controls or public photo-signing requests.

## Verification

Passed:

- `npm run check`: strict TypeScript, ESLint, formatting and **830 application tests
  across 72 suites**. Includes Today presentation/navigation, preview overflow,
  retake/reselect cancellation, private/public canonical post navigation, native
  Back, lost-acknowledgement recovery, no self-rating, eligible public controls,
  account switching, one-shot receipts and Reduce Motion.
- `EXPO_NO_DOTENV=1 npm run doctor`: **21/21** online checks.
- `EXPO_NO_DOTENV=1 npx expo install --check`: dependencies up to date, online check.
- `npm run export:check -- --clear` with dotenv disabled and public local fixture
  configuration: iOS, Android and web exports pass.
- `npm run security:scan`: source/config/web plus both decoded native Hermes bundles
  pass; no privileged credentials or server implementation in app exports.
- `git diff --check`: passes.

The ordinary navigation test fixture still emits its existing missing `past-words`
fixture warning; the application route exists and the tests pass. No tests were
skipped or weakened to conceal a failure. Old result-page assertions now exercise
the canonical post and its owner lifecycle instead.

### Local integration follow-up

The user approved the documented local-only Docker mirror after the initial test
failures. The failure was environmental, not a QA #14–17 regression:

- Docker could not mount `/Applications/langtify.com/supabase/tests` (exit 125).
- The local Edge Runtime was absent while Auth, Storage, REST and the database
  were running. A direct photo-authority gateway probe returned HTTP **503** with
  `{"message":"name resolution failed"}`, before application handling. This explains
  why reservation succeeded but the first function preview failed.
- Copied the unchanged config, SQL tests, functions and source into a fresh
  `/private/tmp/langtify-qa14-verify-*` directory, verifying identical source hashes.
  Started `npx supabase functions serve --workdir <mirror>` with the existing JWT
  configuration. No authentication bypass, hosted operation or code fix was needed.
- `node scripts/ci-supabase.mjs ready` confirmed the actual handler was running and
  rejected unauthenticated access. All **23** local migrations were already applied;
  no migration or reset was necessary.
- `npx supabase test db <mirror>/supabase/tests/`: **1,068 assertions across 23 files
  passed**, using exactly the repository SQL tests.
- `npm run db:test:submissions` now passes fully, including private Storage,
  recovery, concurrency, cleanup and source-neutral **10/20/40 XP** behavior.
- `npm run functions:check`, `npm run functions:lint`, `npm run functions:test`:
  passed for photo-authority, avatar-authority and notification-scheduler; **23
  function tests** passed. `npm run check` again passed all **830 app tests**.

All remaining local suites passed sequentially (no shared-fixture overlap):

| Commands                                                                                                    | Result                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run db:test:photo-audit`                                                                               | Passed: malicious image/metadata denial, real 60-second expiry, interrupted uploads, cleanup and upload/deletion races.                         |
| `npm run db:test:progress`                                                                                  | Passed: multi-session finalize/delete races, bonus/milestone idempotency, reversal and no XP farming.                                           |
| `npm run db:test:vocabulary`, `npm run db:test:discover`                                                    | Passed: history grouping/deletion, public eligibility, owner-only/batch signing, pagination and actual expiry.                                  |
| `npm run db:test:ratings`, `npm run db:test:safety`, `npm run db:test:social`                               | Passed: rating, block, moderation, visibility, follow/comment and account-erasure concurrency; authority and XP preserved.                      |
| `npm run db:test:inbox`, `npm run db:test:explore`, `npm run db:test:past-words`, `npm run db:test:avatars` | Passed: controlled reads, deduplication, historical-only rewards, gallery/Storage authority and cleanup.                                        |
| `npm run test:auth:integration`, `npm run db:test:integration`, `npm run db:test:challenges`                | Passed: Auth/session/account isolation, onboarding, challenge creation/replacement and ownership.                                               |
| `npm run db:test:notifications`, `npm run db:test:notification-sender`                                      | Passed: existing scheduling/token authority and at-most-one attempt, using local DB and instrumented provider transport; no real push delivery. |
| `npm run db:test:bootstrap`                                                                                 | Passed: ordered bootstrap, nonempty replay, fail-closed migration preflights and bounded query plans in a disposable local database.            |
| `npx supabase db lint --local --level warning --fail-on warning`                                            | Passed: no schema warnings/errors in the persistent local database.                                                                             |

No application/backend fix or test weakening was necessary. The only repository
change during this follow-up is this verification report. The existing database,
Auth and Storage remain intact; no migration was applied to the persistent stack.
The temporary function server was stopped and its source mirror removed afterward;
future local integration runs must serve the functions again as described in README.
Local automated verification is cleared for physical-device QA. This does not
claim physical acceptance, hosted validation or real provider delivery.

## Physical acceptance

No new native dependency/config change requires a rebuild for this batch. Reload
the existing SDK 57 development build through Metro; a standalone build needs a
new binary or its existing update distribution mechanism. Prior Haptics changes
still require the previously requested rebuilt development client.

1. Today: no level/total XP; correct 0/3 through 3/3, completion bonus and streak.
2. Tap each word (including completed/pending words): same word detail as Search,
   correct translation/CEFR, examples, history, iOS edge-back and Android Back.
   Change learning settings after generation and verify snapshot/example labels.
3. Camera and gallery: preview is primary; Add photo stays visible above the home
   indicator; privacy is clear; no visible retake/discard/library button stack.
   Verify light/dark, large text, VoiceOver, Reduce Motion and smaller iPhones.
4. Overflow: retake, cancel retake, reselect, cancel picker, discard/keep. Cancelling
   preserves the photo/privacy; confirmed discard actually clears the draft/object.
5. Submit private and public photos: post opens directly with correct pixels/context,
   one brief acknowledgement, native back to origin, no result page or self-rating.
   Public comments/share follow eligibility; private/restricted photos keep them hidden.
6. Complete one, two and three daily words: verify server +10/+20/+40 totals in
   Profile, daily bonus/streak unchanged. Historical captures retain only their
   existing word entitlement. Delete/reupload preserves reversal/idempotency.
7. Interrupt upload/finalization, lose acknowledgement, revisit, background/resume,
   or switch accounts while pending: recover without duplicate writes or reward
   replay; never show or navigate to an old account's photo.
8. Owner post options: privacy change, photo reload after failure, deletion and
   interrupted-deletion recovery; validate Discover/Vocabulary updates afterward.

Local integration verification is complete. Physical iPhone acceptance remains
pending; QA #14–17 must not be marked physically accepted until the checklist passes.
