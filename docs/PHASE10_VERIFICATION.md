# Phase 10 implementation and verification

This records the implementation pass. The later [Phase 10 audit](PHASE10_AUDIT.md)
contains corrective migrations, reproduced defects and the latest verification counts.

**The delivery-contract blocker is resolved.** The user approved at most one provider
send attempt per user/type/local date, accepting rare misses and no guarantee of
device delivery. The sender and receipt/error handling are implemented. Hosted Dev,
real provider credentials and physical-device acceptance remain deployment steps;
no hosted deployment or live device notification occurred here. No Phase 11 work.

## 1. Features implemented

Profile notification settings, explicit native permission handling, secure device
registration/revocation, fixed matching-account Today taps, daily vocabulary/streak
admission, real Expo HTTP sending and receipt reconciliation. Web supports settings
without push registration. UI no longer says sending is blocked and never claims that
saving preferences means a notification was delivered.

## 2. Schema changes

`20260918000000_phase10_notifications.sql` adds preferences/installations and historical
blocked preparation. `20260918010000_phase10_sender.sql` adds durable attempt identity,
consumption/authorization timestamps, token fingerprint, ticket/result/receipt state,
private transition events, indexes, constraints and narrowly granted RPCs. A unique
user/type/local-date source and one-use pre-send authorization prevent duplicate work.
Legacy blocked history remains terminal; it is not dispatched as a backlog.

All notification tables have RLS and no raw ordinary/service-role access. Public
clients can only manage their own preferences and capability-bound registration.
Sender/receipt RPCs are service-only. Auth account deletion clears token bindings and
cascades owned notification history. Existing photo, Storage, moderation and XP/streak
authority remains intact. See [data model](DATA_MODEL.md).

## 3. Token registration

Installation secret/hash, monotonic persisted revision and actual live Auth session
bind the Expo token to the authenticated owner. Older requests lose to newer revisions;
anonymous capability calls can only revoke. Foreground/explicit refresh can recover
provider-invalidated bindings. Definite DeviceNotRegistered responses clear only the
same installation/owner/revision/token hash; delayed receipts cannot revoke newer
registrations or a different account. No provider secret enters public env/bundles.

## 4. Daily three-word content

The server uses saved IANA timezone/DB time, ensures today's challenge via existing
authority and snapshots its three active target words. Replacements never trigger
another attempt. Generation and claim roll back together on candidate failure.
Default time is 08:00 local, and provider expiration is the next local midnight.

## 5. Scheduler architecture

Protected job → at most 10 due accounts → atomic claims → one-use current eligibility
check → one single-recipient HTTP request per attempt, four concurrent calls maximum
→ durable result → later receipt reads. RPC claim maximum is 50 accounts; receipt
reads are bounded to 100 tickets. Indexed next-check times avoid full-account scans.
Failed candidates defer 15 minutes without partial challenges. Streak reminders at
19:00 require a surviving run ending yesterday and zero valid words today.

The final authorization rechecks exact binding/session, account, preferences, timezone/
date and streak state. No SQL lock spans HTTP. Changes after admission cannot retract
in-flight or OS-queued pushes, including after offline sign-out.

## 6. Preferences

Master/daily/streak switches and minute-precision HH:MM times, persisted timezone,
loading/retry/save states, explicit permission opt-in and denial → device Settings.
Account/focus guards reject stale results. Defaults remain daily 08:00 and streak
19:00. PostgreSQL resolves custom DST gaps forward and folds to standard time.

## 7. At-most-one attempt, outcomes and receipts

A committed claim consumes the source permanently, before network I/O. Lost claim or
authorization responses, a crashed worker, timeout, 429/5xx, malformed result, definite
rejection and failed result persistence never cause a resend or device fallback.
One most-recent eligible device is selected; there is no per-device fan-out. Rejected
final eligibility leaves a consumed attempt without a provider call.

Ticket acceptance is distinct from provider acceptance and neither means device
receipt. Safe state/error codes and transition events are recorded. Receipt lookup
starts after 15 minutes; missing/failed lookups retry only reads and become terminal
after 24 hours. Abandoned attempts become uncertain after 10 minutes. No attempt
lease, administrative retry route or state reset can reopen a send through the app.

## 8. Deep links

Only fixed DAILY_WORDS/STREAK_AT_RISK types with a matching account can open Today,
after Auth/onboarding. Warm/cold callbacks deduplicate IDs, reject arbitrary routes
and ignore another account. Sign-out clears cached responses. Real remote-device
receipt/tap acceptance remains an operator check.

## 9. Beta hardening and defects fixed

- Auth restoration/account loading now have recoverable 15-second deadlines.
- Mobile SDK fetch waits are bounded to 20 seconds, 90 for Storage object mutations,
  preserving caller cancellation and avoiding automatic mutation replay.
- Uncertain registration invalidates cached assumptions; durable revisions fence old
  writes and prevent missed sign-out revocation.
- Settings have visible labels, strict times, safe failed-save recovery and honest
  delivery language. Foreground registration recovers invalidated server bindings.
- Today/recovery defer background reads; obsolete progress callbacks cannot start
  old-token work. Existing Auth, onboarding, photo/recovery, history/feed, Profile,
  blocked users and moderation state machines retain their safe retry/account guards.
- Sender migration correctly removes the old blocked-reason NOT NULL requirement;
  explicit JSONB initialization removes database lint warnings.
- One-use pre-send revalidation suppresses work invalidated after claim; exact-binding
  token invalidation protects account switches and refreshes.

The prior SDK-compatible Notifications/Device/SecureStore additions and Expo 57.0.23 /
image-manipulator 57.0.18 patches remain. No additional sender dependency or custom
backend was introduced. Native IDs/scheme remain `com.langtify.app` / `langtify`.

## 10. Deployment

[The Langtify Dev runbook](HOSTED_DEV_DEPLOYMENT.md) orders migrations → development
seed → functions → notification/receipt cron → photo cleanup → moderator provisioning
→ hosted config → native build → smoke tests. Configure server-only job secret and
Expo access token with enhanced push security before cron. APNs/FCM/Google credentials
stay in trusted tooling. Build commands: `npm run build:ios:dev`,
`npm run build:android:dev`, `npm run start:dev -- --clear`. No store publishing needed.

## 11. Verification

| Command/check                                                   | Result                                                                                                                                                   |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run db:migrate` and local sender replay                    | Applied locally; no hosted migration                                                                                                                     |
| `npm run db:types`                                              | Regenerated public types from local schema                                                                                                               |
| `npm run check`                                                 | Passed: typecheck, zero-warning lint, formatting; **323 application tests across 38 suites**                                                             |
| `npx supabase test db /private/tmp/langtify-db-tests/`          | **649 assertions, 16 files passed**, documented Docker sharing fallback                                                                                  |
| `npm run db:test:notifications`                                 | **6 groups passed**: Auth/preferences, times, words, revisions, restrictions, streaks, session loss, rollback                                            |
| `npm run db:test:notification-sender`                           | **10 groups passed**: real Auth/DB plus instrumented HTTP provider, concurrency, crashes, retries, invalidation, receipts, authorization and REST denial |
| `npm run db:test:bootstrap`                                     | **15 groups passed**, including nonempty blocked/attempted history replay without resetting outcomes or XP                                               |
| `npm run test:auth:integration`                                 | Passed: real session/password regression                                                                                                                 |
| `npm run db:test:integration` / `db:test:challenges`            | Passed: migration/seed/onboarding concurrency, challenge generation/replacement                                                                          |
| `npm run db:test:submissions` / `db:test:photo-audit`           | Passed: actual private Storage/Auth, image verification, expiry, concurrency and cleanup                                                                 |
| `npm run db:test:progress`                                      | Passed: XP/streak/reversal/idempotency and cross-user denial                                                                                             |
| `npm run db:test:vocabulary` / `db:test:discover`               | Passed: history/feed, paging, batch signing and actual URL expiry                                                                                        |
| `npm run db:test:ratings` / `db:test:safety`                    | Passed: vote/block/moderation races, revocation, privacy and unchanged XP                                                                                |
| `npx supabase db lint --local --level warning`                  | Passed, no schema errors/warnings                                                                                                                        |
| `npm run functions:check` / `functions:lint` / `functions:test` | Passed; **16 Deno tests** (10 scheduler/sender, 6 photo)                                                                                                 |
| `npx expo install --check` / `npm run doctor`                   | Compatible; **21/21 Doctor checks passed**                                                                                                               |
| `npm run export:check -- --clear`                               | Passed: iOS/Android Hermes and web static exports, 20 routes                                                                                             |
| `npm run security:scan`                                         | Passed: **267 files and 2 decoded Hermes bundles**, no privileged credentials or server implementation in exports                                        |

Shared-database suites ran sequentially; bootstrap uses an isolated disposable DB.
The HTTP integration runs the real worker/store/transport against real local Auth/DB
and an instrumented loopback provider, not live Expo. It verifies actual HTTP attempt
counts without sending test-user tokens externally. Deno tests additionally cover
fixed endpoints, body/deadline handling, 429/5xx/malformed results and missing receipts.
A hosted Edge/cron invocation, actual Expo handoff and device display are not claimed.

The existing dependency audit has 14 moderate transitive findings, zero high/critical;
forced suggestions include incompatible SDK downgrades. Track compatible upstream
fixes, particularly Router percent decoding and Xcode-tooling UUID advisories. Runtime
module-type/color and type-generator listener warnings did not fail checks; database
lint warnings introduced during implementation were corrected and rerun cleanly.

## 12. Acceptance checklist

[BETA_CHECKLIST.md](BETA_CHECKLIST.md) separates automated, hosted, physical iPhone/
Android and operator checks. It includes password/Google/onboarding, daily challenges,
photo/recovery/privacy, XP/streaks, Vocabulary/Discover/ratings, safety/moderation,
notification send/tap, account switch, offline/background/midnight, accessibility
and light/dark mode. Hosted/device/operator boxes remain unchecked.

## 13. Remaining release gates

The contract is resolved and implemented; there is no longer a delivery-policy blocker.
Configure/deploy hosted Dev, Expo project/native credentials and cron/cleanup; verify
actual provider handoff and device behavior on iPhone/Android. Keep rare missed sends,
post-admission account changes and queued/offline-signout behavior within the accepted
best-effort contract. Complete operational acceptance and dependency-advisory review
before closed-beta release. Phase 11 has not begun.
