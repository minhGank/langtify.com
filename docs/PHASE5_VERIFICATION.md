# Phase 5 implementation verification

Verified locally on 2026-09-12. Phase 6, social features, leaderboards, achievements
and subscriptions were not implemented. No mobile dependencies, environment
variables, routes or deployment services were added.

## Delivered behavior

Migration `20260913000000_phase5_progress.sql` adds private completion facts,
owner revision locks, durable qualified-date identities, milestone windows and XP
source balances, plus owner-readable immutable `public.xp_events` and two read RPCs.
Generated public database types match the local schema. Finalization and finished
deletion synchronously reconcile progress in the existing transaction. Cleanup uses
the same owner/assignment lock order. RLS and revoked grants deny client mutation
and cross-user progress reads.

The ledger records signed source revisions: +10 per valid assignment, +10 for a
three-word challenge, and fixed milestone rewards. Deletion reverses invalidated
sources; restoration credits the same source rather than accumulating farmable
positive-only lifetime XP. Total XP is the signed sum. Level L begins at
`25 × L × (L + 3)`; 620 XP is Level 3, not the illustrative Level 4.

Streaks group distinct active completion dates into consecutive calendar runs.
Server finalization time and the persisted learning timezone select the date.
Current streak ends today or yesterday; longest is recomputed from surviving days.
Milestones at 3/7/14/30/60/100 days give 10/25/40/75/125/200 XP. Candidates retain
original windows, are created only on a date's first qualification at the exact
threshold, and are limited to one eligible reward per threshold/current run.
Historical deletion revokes broken windows without inventing new past candidates.
See PRODUCT.md and DECISIONS.md for the exact restoration/merged-run interpretation.

Today shows n/3, full bonus, level, XP and current streak. Profile adds the next-level
bar, longest streak and valid totals. Completed photo detail shows an authoritative
XP receipt. Account keys, token binding and request generations prevent obsolete
responses from crossing accounts. Focus/resume and active-minute refresh revalidate
server progress; failures show retry rather than fabricated zero XP.

## Commands and results

| Command                                                                       | Result                                                                                                     |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `npx supabase migration up --local`                                           | Applied locally; tracked rerun applies nothing                                                             |
| `npm run typecheck`                                                           | Pass                                                                                                       |
| `npm run lint`                                                                | Pass; zero warnings                                                                                        |
| `npm run format:check`                                                        | Pass                                                                                                       |
| `npm test`                                                                    | 155 tests, 20 suites pass                                                                                  |
| `npx supabase test db /private/tmp/langtify-phase5-tests`                     | 295 assertions, 7 files pass; exact copies of repository SQL files use the documented Docker path fallback |
| `npm run db:test:integration`                                                 | 5 identity/seed/migration scenarios pass                                                                   |
| `npm run db:test:challenges`                                                  | 4 challenge/concurrency scenarios pass                                                                     |
| `npm run db:test:bootstrap`                                                   | 5 disposable-database scenarios pass, including nonempty Phase 5 completion/deletion replay                |
| `npm run db:test:submissions`                                                 | 10 real Auth/Storage/lifecycle scenarios pass                                                              |
| `npm run db:test:photo-audit`                                                 | 6 image/signing/expiry/concurrency/recovery scenarios pass                                                 |
| `npm run db:test:progress`                                                    | 5 real Auth/Storage XP concurrency/recovery scenarios pass                                                 |
| `npx supabase db lint --local --level warning`                                | No schema errors or warnings                                                                               |
| `npm run functions:check`, `npm run functions:lint`, `npm run functions:test` | Pass; 4 decoder tests                                                                                      |
| `npx expo install --check`                                                    | Dependencies compatible                                                                                    |
| `npx expo config --type public`                                               | Pass                                                                                                       |
| `npm run doctor`                                                              | 21/21 checks pass                                                                                          |
| `npm run export:check`                                                        | iOS, Android and web exports pass                                                                          |
| `npm run security:scan`                                                       | Source/config and exported bundles pass, including decoding both Hermes bundles                            |
| `git diff --check`                                                            | Pass                                                                                                       |

The new SQL suite covers 10/20/40 XP, duplicate finalization, full bonus idempotency,
all six milestones, same-day qualification, threshold boundaries, multiple-level
advancement, reset, historical deletion, repeat restoration, DST transitions,
timezone changes, foreign challenge/history/receipt denial, private mutation denial
and injected XP failure rollback/retry. Application tests cover display, accessible
level progress, service ownership validation, failure/retry and stale account/token
responses. Integration tests use two actual Auth sessions and verified Storage
photos, simultaneous completions, deletion/finalization overlap, cleanup under a
stale REPEATABLE READ snapshot and retry, plus signed ledger consistency.

## Phone acceptance — still required on iOS and Android

1. Sign in to a fresh account: confirm Level 0, 0 XP and 0/3.
2. Submit three camera photos: confirm 10, 20, then 40 XP and the full-completion
   label. Check the word/bonus receipt and Profile totals/progress bar.
3. Delete one completed photo: wait for deletion to finish, then confirm 2/3, 20 XP
   and no full-challenge count. Resubmit repeatedly; the total returns to 40 only.
4. Interrupt upload/finalization/deletion with airplane mode, backgrounding and
   app termination. Resume/retry and confirm one result with matching XP on a
   second device. Pending upload must earn no XP.
5. Switch accounts while a photo or progress read is pending. Confirm no previous
   account progress or feedback appears; sign back in and verify server state.
6. Use a controlled test account across local midnight and streak thresholds;
   confirm one qualification per day, yesterday's grace, reset after a missed day,
   milestone feedback and reversal after deleting the last qualifying photo.
   Changing device date/time alone must not select the streak day.
7. Check small screens, large text, VoiceOver/TalkBack, light/dark themes and the
   Profile progress bar. Verify level crossing and level decrease after deletion.

## Deployment limits and remaining risks

- Local checks are not signed native builds or physical-device acceptance. No
  hosted migration, function deployment or cleanup scheduler installation occurred.
- Existing Phase 4 photos lack a finalization-time timezone snapshot. Backfill uses
  the saved challenge timezone and labels this `legacy_challenge_snapshot`; it
  cannot reconstruct a timezone change that was never recorded.
- Backfill holds a submission write lock while replaying history. Back up hosted
  data and size the migration window before deployment. Normal tracked migration
  reruns are safe; do not manually replay the raw SQL over existing ledger history.
- Reconciliation scans the affected owner's indexed history. Monitor latency and
  ledger growth for large histories; load testing at production scale remains.
- Timezone changes affect future local-day qualification. No timezone-change
  cooldown or travel/anti-abuse policy was requested or silently introduced.
- Existing private Storage and trusted photo verification remain required. The
  existing hourly cleanup job must run to finish abandoned deletions; credit remains
  until retirement completes. Signed photo URLs retain Phase 4's 60-second lifetime.

Phase 5 implementation and local verification are complete. Production release
still requires deployment planning and the device checklist above.
