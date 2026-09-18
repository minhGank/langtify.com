# Langtify beta acceptance — Phase 10

The approved delivery contract is at most one provider send attempt per user/type/
local date, accepting missed notifications and no device-delivery guarantee. The
sender is implemented and locally tested; **hosted/provider/device acceptance is
still pending**. Phase 11 remains out of scope.

Use [Dev deployment](HOSTED_DEV_DEPLOYMENT.md), [notification operations](NOTIFICATIONS.md)
and [the latest audit](PHASE10_AUDIT.md). Record tester, date, OS/build,
project reference and outcome; never attach tokens, secrets or sensitive signed URLs.
Checked automated items below refer to this local run, not hosted or device evidence.

## Automated checks

- [x] Strict TypeScript, zero-warning ESLint, formatting and application tests.
- [x] Local migrations, 661 database/RLS assertions and nonempty bootstrap/replay checks.
- [x] Password/session/onboarding authority; Google PKCE cancellation/replay/admission regressions.
- [x] Concurrent challenge creation/replacement and insufficient-vocabulary rollback.
- [x] Private Storage, real Auth/photo validation, upload/recovery, deletion and cleanup races.
- [x] XP/streak/milestone reversal, idempotency, timezone and account isolation regressions.
- [x] Vocabulary/Discover paging, signing, privacy, ratings and moderation regressions.
- [x] Fixed 60-second photo capabilities expire on the local Storage server.
- [x] Durable attempt admission snapshots three assigned words once; replacements/retries do not duplicate it.
- [x] Defaults/custom times/persisted zones/DST, preference disabling and streak eligibility.
- [x] Live-session token registration, revision fences, account switch, revocation and deletion.
- [x] Fixed Today tap parsing, pending Auth, mismatched recipient and stale-response denial.
- [x] Auth/network deadlines, safe errors and failed preference-save recovery.
- [x] Instrumented HTTP-provider tests cover concurrency, crashes, uncertainty, rejected tokens, stale receipts and receipt expiry.
- [x] Function checks/tests, database lint, Expo compatibility/Doctor and all-platform exports.
- [x] Source/config/web and decoded native Hermes credential scans; no privileged secrets or server implementation found.
- [ ] Actual Expo/APNs/FCM handoff and physical display — hosted/device acceptance pending.

The dependency audit still reports 14 moderate transitive findings; compatible
upstream resolution/review is an additional release consideration. Automation does
not prove native permissions, transport receipt, performance on low-end phones or
accessibility quality.

## Hosted checks — Langtify Dev only

- [ ] Verify reviewed Dev reference, backup, migration order and development seed coverage.
- [ ] Deploy matching photo authority; reject ordinary/cross-user and arbitrary-path requests.
- [ ] Configure email confirmation and real Google redirect/client credentials.
- [ ] Same verified Google/password identity follows Supabase linking; one profile, required onboarding.
- [ ] Apply RLS/Storage regressions using Dev test accounts without running local-only fixture scripts against hosted data.
- [ ] Scheduler: wrong/missing job or provider credentials fail closed; valid requests return safe counts only.
- [ ] Daily preparation contains all three real assignments; repeated checks/replacement remain one row.
- [ ] Persisted timezone/custom times and midnight produce correct current local-date preparation.
- [ ] No streak preparation after one completion; yesterday's surviving streak qualifies before completion.
- [ ] Banned/deleted/session-revoked accounts excluded; public restriction preserves private learning.
- [ ] Monitor candidate failures, overdue counts and cron HTTP responses; no provider sender is deployed.
- [ ] Hourly cleanup physically removes abandoned/deleting objects and converges XP/completion correctly.
- [ ] Actual daily 3-word and streak-reminder sends; repeat jobs never produce another attempt for the same source.

## Physical-device checks — repeat on iPhone and Android

- [ ] Install a fresh native development build; confirm Langtify name, scheme and package/bundle IDs.
- [ ] Email signup/confirmation/password login, failure messages, sign-out/relogin and cold session restore.
- [ ] Google success/cancel/provider error; warm/cold callback; replay and completion after sign-out.
- [ ] Onboarding validation/username collision, network failure/retry and no premature tab access.
- [ ] Today's three words, reference terms, replacement and insufficient-catalog safe retry.
- [ ] Camera permission allow/deny/Settings, capture/retake, accessible controls and image orientation.
- [ ] Upload interrupted by airplane mode/background; resume without duplicate completion or objects.
- [ ] Delete/finish deletion; private/public toggles; another account never opens a private photo.
- [ ] 1/2/3 words produce 10/20/40 XP; level/progress/streak UI agrees after delete/resubmit and relaunch.
- [ ] Vocabulary grouping/search/filter/paging, repeated captures, latest surviving image, no ghost concepts.
- [ ] Discover saved-target feed/paging, privacy changes and expired photo renewal without stale images.
- [ ] Rating 1–5/update/retry; no self/private rating and no XP or feed-order effect.
- [ ] Reporting confirmation/privacy and block/unblock mutual exclusion including signing/rating.
- [ ] Notification settings defaults 08:00/19:00, saved timezone, safe failed-save recovery and clear best-effort delivery explanation.
- [ ] Permission first opt-in, grant, deny without nagging, return from Settings and unavailable capability.
- [ ] Registration/token refresh on a real project; clear error/retry if credentials/network are missing.
- [ ] Switch learner A → B during registration; no A binding or preference result overwrites B.
- [ ] Switch accounts/sign out while native permission/token lookup fails or stalls;
      verify old binding revocation precedes lookup and recovery registers only the current account.
- [ ] Sign out online/offline, relaunch and re-register; verify backend revocation after connectivity returns.
- [ ] Reinstall/update app and test SecureStore/token continuity; fail closed on lost capability rather than transferring another installation's token.
- [ ] Notification tap → Today for warm/cold/background and expired Auth, matching recipient only — **real transport pending**.
- [ ] Daily three-word push near 08:00, streak reminder near 19:00, retries/two-device duplicate behavior — hosted/provider acceptance pending.
- [ ] Go offline on every async screen; no permanent spinner/raw SQL, and retry after connectivity returns.
- [ ] Background/resume near local midnight; current date follows saved timezone/DB authority despite a wrong device clock.
- [ ] Custom time during a DST gap/fold uses the documented resolved instant even
      after changing preferences or refreshing registration; no early or repeated attempt.
- [ ] Switch accounts during Auth, Today, upload, Vocabulary, Discover, Profile, Blocked Users and Moderation work; no stale private data.
- [ ] Large text, VoiceOver/TalkBack labels/focus, contrast, small-screen scrolling and light/dark mode.
- [ ] Observe battery/network behavior; inactive screens do not poll/sign repeatedly or retain unbounded pages.

Exports cannot check these boxes. Provider receipt is not proof of device display,
and no test should be recorded as exactly-once delivery merely because it passed once.

## Moderation and operations

- [ ] Trusted operator provisions/revokes a Dev moderator; ordinary users cannot self-grant access.
- [ ] Reports and reporter/block identities remain private; inspect only a report-authorized photo.
- [ ] Remove/restore content, restrict/restore account, resolve/dismiss reports and test old retries.
- [ ] Revocation takes effect with an existing session; privileged UI clears on failure/account switch.
- [ ] Moderation does not alter XP, streaks or private completion; deletion alone reconciles those effects.
- [ ] Inspect immutable audit history and verify no credentials/signed URLs in logs or support screenshots.
- [ ] Monitor cleanup and notification/receipt job, practice disabling cron and rotating job credentials.
- [ ] Review backups, least-privilege operator access, catalog quality and the dependency advisories.
- [ ] Verify one provider attempt, safe uncertainty, invalid-token replacement and receipt-only retry in hosted Dev; never reset attempts to resend.
