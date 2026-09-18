# Phase 10 audit — Push Notifications & Beta Hardening

Audit scope: the approved at-most-one provider attempt contract, notification privacy,
server authority, token lifecycle, scheduling, recovery and existing feature regressions.
Phase 11 is not included. This audit preserves the existing uncommitted Phase 10 work.

## Findings and fixes

1. **Previous-account binding survived native lookup failure (privacy).** Registration
   inspected native permission and fetched an Expo token before revoking the old binding.
   A failed token fetch after switching accounts, or failed permission lookup during
   sign-out, prevented the revocation RPC entirely. Two new application tests reproduced
   this. Each new Auth scope/cold initialization now commits a capability revocation
   before native lookups; durable higher revisions fence older in-flight writes. Failed
   revocation stays retryable and prevents assuming registration succeeded. Offline
   server revocation still cannot be guaranteed.
2. **Custom DST times could send early (correctness).** The next-check calculation
   resolved gaps/folds to PostgreSQL's IANA instant, while claim and final authorization
   compared wall-clock values. A registration/settings refresh during Toronto's spring
   gap or first fall occurrence admitted a push early. The additive DST migration makes
   both admission stages compare the same resolved timestamp. Twelve transaction-scoped
   tests instrument the actual RPC clock/challenge input; six assertions failed before
   the fix. No deployed test clock or client date override is introduced.
3. **Rejected provider responses retained unread bodies (resource recovery).** An HTTP
   4xx/5xx returned without releasing the response stream. A Deno regression reproduced
   the missing cancellation. The transport now cancels rejected response bodies while
   retaining its deadline and single-call behavior.

4. **Batched scheduling could deadlock with account rebinding and send admission
   (concurrency).** The real PostgreSQL fixture paused the first candidate's preference
   update, moved the other candidate's installation into that account, and authorized
   its pending send concurrently. PostgreSQL reported `40P01`: preferences B → profile
   A → installation A → preferences B. A second additive migration takes the bounded
   batch's Auth-user, profile and learning locks, in ordered stages, before processing
   preferences. It preserves the same candidate limit/order, current eligibility
   rechecks and one-use attempt authority. No data or product rule is changed.

## Send-contract validation

The unique user/type/local-date source row commits before network I/O. One-use
server authorization is required before each fixed Expo endpoint call. Replaying a
claim, losing its acknowledgement, crashing after claim, losing result persistence,
provider rejection, malformed acknowledgement and network uncertainty cannot reopen
that source. Receipt lookups may retry; provider sends cannot. Historical blocked
rows remain terminal. Replacement leaves the original three-word snapshot unchanged
and creates no additional attempt. Provider expiration is the next local midnight.

The daily payload comes from the existing challenge authority, including its three
active target words. Streak eligibility requires a surviving run ending yesterday
and no surviving completion today, checked again at send admission. Restricted users
retain existing private-learning eligibility; banned, deleted, incomplete and ended-
session accounts are excluded. There is no XP, streak, public-feed or moderation rule
change. Ticket/receipt success means provider acceptance, not end-device delivery.
See [Expo's ticket and receipt distinctions](https://docs.expo.dev/push-notifications/sending-notifications/).

## Token lifecycle and account isolation

Registration derives the owner from Auth, validates a live Auth session, requires an
installation capability and persists a strictly increasing revision. Tokens are unique;
a different installation cannot claim an existing token. Ordinary callers cannot name
another owner or read token/history tables. Anonymous capability calls can only revoke.
Invalid-token tickets and receipts clear only the attempted installation, owner,
revision and token hash. A newer account or same-account token replacement survives
late provider errors. Rejected attempts do not become sendable after re-registration.

Client writes serialize revision allocation, abort obsolete requests and reject stale
responses. Scope revocation now precedes permission/token lookup, including cold start.
Preferences remain Auth-scoped and are reloaded on focus/foreground. Warm/cold taps
recognize only fixed notification types and a matching user, wait for Auth/onboarding,
and open Today. Payload routes/URLs and unknown types cannot navigate elsewhere.
Response IDs are deduplicated in bounded memory; cached OS responses are cleared.
An old matching-owner message opens current Today, never historical payload content.

## Verification

All final local checks below completed. Initial regression failures described above
were reproduced before their fixes and passed afterward.

| Command / check                                                 | Result                                                                                                                                    |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run db:migrate`                                            | Both additive audit migrations applied locally; no hosted changes                                                                         |
| `npm run check`                                                 | Typecheck, zero-warning lint, formatting and **325 application tests / 38 suites passed**                                                 |
| `npx supabase test db /private/tmp/langtify-db-tests/`          | **661 assertions / 17 files passed**, using the documented Docker sharing mirror                                                          |
| `npm run test:auth:integration`                                 | Real Auth session/password regressions passed                                                                                             |
| `npm run db:test:integration` / `db:test:challenges`            | Seed/migration/onboarding and challenge concurrency passed                                                                                |
| `npm run db:test:submissions` / `db:test:photo-audit`           | Real Auth/Storage, validation, expiry, recovery and deletion races passed                                                                 |
| `npm run db:test:progress`                                      | XP/streak/reversal/concurrency and cross-user denial passed                                                                               |
| `npm run db:test:vocabulary` / `db:test:discover`               | History/feed pagination, privacy, signing and actual URL expiry passed                                                                    |
| `npm run db:test:ratings` / `db:test:safety`                    | Rating/block/moderation/revocation races and unchanged learning authority passed                                                          |
| `npm run db:test:notifications`                                 | **6 groups passed**                                                                                                                       |
| `npm run db:test:notification-sender`                           | **13 groups passed**, including the reproduced deadlock and adversarial provider outcomes                                                 |
| `npm run db:test:bootstrap`                                     | **17 groups passed**, including both nonempty audit migration replays                                                                     |
| `npx supabase db lint --local --level warning`                  | No schema errors or warnings                                                                                                              |
| `npm run functions:check` / `functions:lint` / `functions:test` | Passed; **17 Deno tests** (11 notification, 6 photo), 12 files linted                                                                     |
| `npm run doctor` / `npx expo install --check`                   | **21/21 checks**, SDK-compatible dependencies                                                                                             |
| `npx expo config --type public --json`                          | Validated minimal projection: Langtify / langtify / com.langtify.app; native plugins present; real EAS UUID absent                        |
| `npm run export:check -- --clear`                               | iOS and Android Hermes plus web static export passed; **20 routes**                                                                       |
| `npm run security:scan`                                         | **272 source/config/bundle files and 2 decoded Hermes bundles** passed; no privileged credentials or server implementation in app exports |
| `npm audit --json`                                              | Completed with **14 moderate, zero high/critical** findings; exits nonzero because findings remain                                        |
| `git diff --check`                                              | Passed; untracked files also checked with `git diff --no-index --check`                                                                   |

The full shared-database regression chain was rerun after the lock-order correction.
Function checks and Expo Doctor also passed again. Exports cover the final mobile
and Edge transport changes; the later SQL-only lock migration does not enter bundles.

The expanded sender suite additionally forces socket loss, actual HTTP timeout,
400/429/500, malformed acknowledgements, five workers replaying the identical claim,
an invalid-token ticket arriving after token replacement, and the three-transaction
lock cycle. Neither losing authorizations nor delayed errors can reopen a source.

The sender integration uses real local Supabase Auth, PostgreSQL and Storage with an
instrumented loopback HTTP provider. It never sends test tokens to Expo. pgTAP time
fixtures roll back; bootstrap uses its own disposable database. Shared database suites
run sequentially. No hosted migration, function, credential or cron was deployed.

## Remaining hosted/device requirements and risks

- Deploy the ordered migrations and matching function/app to the reviewed Langtify Dev
  project, configure the dedicated job secret and server-only Expo access token, enable
  enhanced push security, and configure APNs/FCM. The checkout has no real EAS project UUID.
- Exercise physical iOS/Android registration, permission denial/re-enable, token refresh,
  cold/warm Today taps, foreground/background behavior, two devices, sign-out/account
  switching during slow token lookup and offline recovery. Verify actual ticket/receipt
  transitions and repeat cron invocations without resetting consumed attempts.
- Monitor the bounded scheduler's due-account backlog and runtime budget for the actual
  beta cohort. Five-minute scheduling can run late; neither local-time punctuality nor
  delivery/display is guaranteed. Interrupted work is intentionally missed, not resent.
- Admission cannot recall already in-flight/provider/OS-queued messages. Offline sign-out
  cannot synchronously revoke a server binding. Lost secure installation storage may
  need trusted recovery if the same Expo token survives reinstall; fail closed.
- `npm audit` reports **14 moderate, zero high/critical** transitive findings. Roots are
  [decode-uri-component malformed-input CPU exhaustion](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr)
  and [uuid optional-buffer bounds validation](https://github.com/advisories/GHSA-w5hq-g745-h8pq).
  Patched upstream versions exist, but npm's proposed top-level fixes downgrade Expo
  dependencies outside this SDK. No forced downgrade or unverified major override was
  applied. The installed query-string uses CommonJS `require` and calls the decoder
  as a function, whereas patched decoder 0.5.0 declares ESM exports; a blind override
  is not a verified compatibility fix. The inspected xcode call uses `uuid.v4()` without
  a supplied buffer, outside the advisory's v3/v5/v6 buffer path. Review compatible
  remediation and URL-input exposure before external beta acceptance.
- Receipt/attempt history and installation tombstones are intentionally retained; size,
  abuse limits and privileged operational access need monitoring. No history reset or
  broad client/table grant is an acceptable recovery procedure.

The local audit is distinct from hosted/device acceptance. Full Phase 10 closure
requires those acceptance checks and an explicit disposition of the dependency findings.

## Files changed by this audit

Implementation: `src/features/notifications/notification-provider.tsx`,
`supabase/functions/notification-scheduler/expo.ts`, and the new migrations
`20260918020000_phase10_audit.sql` and `20260918030000_phase10_lock_order.sql`.
No dependency, native identifier, route or public RPC signature changed in this audit.

Regressions: `tests/notification-provider.test.tsx`,
`supabase/functions/notification-scheduler/sender_test.ts`,
`supabase/tests/phase10-audit.test.sql`, `scripts/test-notification-sender-integration.mjs`,
`scripts/lib/notification-lock-audit.mjs`, and `scripts/test-db-bootstrap.mjs`.

Documentation: `AGENTS.md`, `README.md`, and `docs/ARCHITECTURE.md`, `DATA_MODEL.md`,
`PRODUCT.md`, `ROADMAP.md`, `DECISIONS.md`, `NOTIFICATIONS.md`,
`HOSTED_DEV_DEPLOYMENT.md`, `BETA_CHECKLIST.md`, `PHASE10_VERIFICATION.md`,
and this new `PHASE10_AUDIT.md`. Existing uncommitted implementation files outside
this audit were preserved; the overall Git diff also contains the prior Phase 10 work.

## Closure assessment

**The local Phase 10 code audit passes after four fixes.** No duplicate-send,
unauthorized sender, token-theft or cross-user read bypass was reproduced in the
expanded final checks. The approved attempt contract remains satisfied. Phase 10 is
ready for hosted/provider/physical-device acceptance; beta acceptance is still open
until those checks and the dependency disposition are recorded. No Phase 11 work.
