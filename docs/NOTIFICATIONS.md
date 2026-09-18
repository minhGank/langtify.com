# Phase 10 push notifications — one provider attempt

The approved contract is **at most one provider send attempt per user + notification
type + local date**. The earlier delivery block is superseded. A rare missed
notification is accepted; no guaranteed device delivery/display is claimed.

```text
private scheduled backend check
→ due preferences + valid account/live registered session + saved IANA timezone
→ ensure/get today's challenge or evaluate streak risk
→ commit unique consumed attempt and authoritative content
→ one-use current eligibility authorization
→ one Expo HTTP send attempt to one selected device
→ record ticket/rejection/uncertainty
→ later poll receipts (read retries only; never resend)
```

A claim commits before provider I/O. Lost responses, network timeouts, HTTP 429/5xx,
malformed results, definite rejection and failed result persistence do not reopen it.
Even a crash between claiming and sending can cause a missed notification. An attempt
left unresolved for 10 minutes is marked uncertain, never retried. Historical blocked
rows remain terminal and are not a backlog; their original local dates are not resent.

Daily content is the three authoritative target words at claim time, default 08:00.
Replacement does not edit/resend it. The default 19:00 streak reminder requires a
surviving run ending yesterday and zero valid completions today. The server uses saved
IANA timezone/DB time, never device date. DST gaps shift forward and folds use standard
time; jobs consider today only. Provider expiration is the next local midnight.

Claim and pre-send admission compare resolved IANA timestamps too, including when
registration or preferences trigger a fresh check during a DST gap/fold.

One most-recent eligible installation is selected, with UUID as a deterministic tie
breaker. There is no per-device fan-out or fallback device resend. Immediately before
HTTP, one-use authorization rechecks account, exact binding/session, preferences,
local date/timezone and streak eligibility. Already admitted/in-flight or queued
messages cannot be recalled after subsequent changes. Publicly restricted users keep
private learning reminders; banned/deleted/incomplete/sessionless accounts are excluded.

The function handles at most 10 due accounts (up to 20 messages) per run. The claim RPC
allows 1–50 accounts; a job lock serializes claims. At most four independent single-
recipient HTTP calls run concurrently, isolating malformed/foreign-project tokens.
Per-user candidate errors roll back generation/claim and defer reevaluation 15 minutes.
Due and receipt indexes avoid full-account scanning. Monitor backlog for the actual
Dev cohort; the five-minute cron is not a delivery-time guarantee.

Before processing preference rows, the bounded candidate batch takes Auth-user,
profile and learning locks in ordered stages. This keeps cross-account registration
and concurrent send authorization from forming a cross-candidate lock cycle.

A ticket means Expo accepted the payload. After 15 minutes, receipt lookup checks
provider handoff; absent/unavailable receipts can be read again every 15 minutes and
expire after 24 hours. Receipt success does not prove device delivery. Only safe error
codes are retained, never raw provider messages. DeviceNotRegistered on a ticket or
receipt clears only the attempted owner/installation/revision/token hash, preserving
new registrations and account switches. These distinctions follow the
[Expo ticket/receipt API](https://docs.expo.dev/push-notifications/sending-notifications/);
Langtify deliberately does not use its send-retry recommendations.

## Native setup and account isolation

Use a physical development build, not Expo Go. Expo Notifications and SecureStore
plugins are configured. `expo-device` gates registration to physical devices in
this app; browser and simulator registration reports unavailable. Preferences still
work on web. Defaults never prompt automatically: Allow notifications explicitly
requests permission; denial offers device Settings without repeated prompts.
Foreground refresh notices changed permission and token refresh replaces the binding.

Set the public `EXPO_PUBLIC_EAS_PROJECT_ID` to the real Expo project UUID. The build
validates its form. Android also needs the Firebase **client** `google-services.json`
for `com.langtify.app`; `LANGTIFY_GOOGLE_SERVICES_FILE` is its local/build-system path.
That file is not an FCM service-account credential. APNs keys and FCM service-account
credentials belong in trusted provider/EAS tooling and must never enter public env,
source, logs or bundles. Follow [Expo native credential setup](https://docs.expo.dev/push-notifications/push-notifications-setup/)
when the operator configures the actual Dev project. An iOS push credential requires
Apple Developer membership. Neither membership nor credentials were provisioned here.

An installation has a random UUID, secret and durable increasing revision in
SecureStore. The database stores the secret hash, current owner/session and unique
Expo token. Registration derives the owner from Auth and verifies `auth.sessions`;
it never accepts a client user ID. Capability-authorized anonymous calls can only
revoke, allowing sign-out recovery after the JWT is gone. Older requests lose to a
higher revision; exact same-revision replay is idempotent. The client aborts obsolete
work and does not cache uncertain registration as successful. Hard account deletion
clears its binding; ended sessions cannot qualify for preparation. Token possession
must be treated as sensitive even though it is not an authentication credential.

On cold initialization and Auth-scope changes, revocation precedes native permission
and token lookup. A failing native API cannot prevent the previous scope's revocation;
failed server revocation remains retryable. See [audit regressions](PHASE10_AUDIT.md).

Offline sign-out cannot immediately reach the backend or retract an OS-queued push.
The client retries reconciliation on foreground; already admitted or queued pushes cannot be recalled. Retained installation tombstones prevent late writes from recreating a revoked
binding. If storage is lost/reinstalled and the same Expo token survives, registration
fails closed rather than letting a new installation steal it. Test reinstall behavior
on both OSes; recovery requires proving ownership through trusted operations, not
loosening the uniqueness constraint.

## Fixed navigation

Only `{ type: 'DAILY_WORDS' | 'STREAK_AT_RISK', userId: <UUID> }` is recognized.
Payload routes, URLs and unknown types are ignored. A warm/cold tap waits for ready
Auth and onboarding, matches the authenticated user, then opens Today. A different
account consumes/ignores the tap. Replayed response IDs are bounded/deduplicated;
sign-out dismisses cached OS notifications and clears the last response. No callback
payload, auth token, Expo token or signed photo URL is logged.

Navigation is unit-tested; real remote-device receipt/tap acceptance remains pending.

## Scheduler access and operations

Deploy to Langtify Dev using [the ordered runbook](HOSTED_DEV_DEPLOYMENT.md).
`notification-scheduler` requires POST with `x-notification-job-key`, matching the
server-only 64-character lowercase-hex `NOTIFICATION_JOB_SECRET`. Ordinary Auth JWTs
are not job authority. Configure `EXPO_ACCESS_TOKEN` on the server and enable Expo
enhanced push security for the project. Missing credentials fail before claims are
consumed. Standard Supabase URL/service credentials stay in the Edge environment.
Neither provider endpoint is caller/env-configurable; no open proxy is exposed.

Successful responses contain only counts: attempted, ticketAccepted, rejected,
uncertain, preparationFailures, recordFailures, receiptsChecked, receiptFailures.
“Attempted” means consumed database attempts; a crash or eligibility change can leave
one without an HTTP call. No response exposes recipient/token/word payloads. Disable
request body/header logging. Alert on failures/uncertainty/backlog and missing runs;
never remediate these by resetting attempts or resending the same date.

Trusted SQL can inspect counts without exporting recipients or token hashes:

```sql
select kind, state, count(*)
from private.notification_deliveries group by kind, state;
select count(*) as due_accounts from public.notification_preferences
where enabled and next_check_at <= now();
```

Disable scheduling with `select cron.unschedule('langtify-notifications-dev');`.
Rotate the job secret in Vault and Edge together; keep the Expo access token separate.
Provider credential failures require configuration repair for future attempts, not a
same-day resend. Existing hourly photo cleanup is independent and remains required.

Tests include notification application/pgTAP cases, admission integration, migration
replay, Deno transport tests and `npm run db:test:notification-sender`. The latter runs
real Auth/Postgres against an instrumented loopback HTTP provider, never live Expo.
Hosted credential/cron operation, actual Expo/APNs/FCM handoff and physical-device
acceptance are still required before beta release.
