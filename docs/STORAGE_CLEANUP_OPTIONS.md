# Storage cleanup scheduling options — investigation only

2026-10-05. Dev target: `ssuyyrfncvyqsgkirvpq`. Production was not accessed.
No architecture, credential, extension, schedule or cleanup rule was changed.
Read-only Dev verification: cleanup Cron is paused; `http` is available but not
installed; `pgcrypto` is installed. Mac launchd remains enabled.

## Recommendation

Do not treat Supabase Support as the only next step. There are alternatives that
avoid placing a reusable cleanup secret in `net.http_request_queue`.

The smallest Supabase-native candidate is **Cron → synchronous `http` → existing
Edge Function**. It uses a supported extension and keeps existing worker/auth
logic, but still requires a bounded dispatcher and failure/recovery testing.
It is not demonstrably safer overall without validating the synchronous database
and network behavior. Do not implement or switch to it as part of this investigation.

Keep Mac cleanup for development for now. For production, the lowest application
change option is an always-on managed scheduled runner executing the existing Node
worker with protected server-side credentials and single-run concurrency. This
adds an external runner, but avoids both custom authentication and database HTTP
queues. No provider was selected, provisioned or contacted.

## 1. Native scheduler without a queued reusable credential

Supabase Cron runs database SQL/functions, or invokes Edge Functions through HTTP.
I found no documented built-in Cron workload identity or queue-free internal Edge
invocation API. Dashboard scheduling and Database Webhooks do not establish such
an identity; the documented scheduling recipe uses `pg_net`.
[Supabase Cron](https://supabase.com/docs/guides/cron),
[scheduled functions](https://supabase.com/docs/guides/functions/schedule-functions).

**Viable candidate: synchronous HTTP.** Cron calls a private, fixed-destination
SQL wrapper. It obtains the existing dedicated secret from Vault at runtime and
uses `extensions.http` to call the existing Edge Function over TLS. It persists
only request IDs, status and counts. The secret is not passed as literal Cron SQL,
returned, logged or written to a request table. It still exists transiently in the
trusted database process and outgoing HTTPS header; this is not credential-free.

- Queue credentials: none; `pg_net` is bypassed.
- Complexity/migration: moderate. Enable `http`, replace only the dispatcher and
  its HTTP-result tracking, keep the Edge worker and deletion RPCs unchanged.
- Reliability: the database session waits for HTTP completion. Bound connection,
  HTTP and SQL timeouts; account for the existing worker's maximum duration.
  Do not hold locks the Edge worker needs. An external deletion cannot be rolled
  back if the SQL transaction fails. Preserve a durable invocation identity and
  reconcile uncertain results before retrying; do not turn timeouts into fresh
  duplicate requests. Verify extension ACLs and safe exception logging.
- Production: plausible for one hourly bounded task after those tests. This is
  an engineering composition of supported primitives, not a documented turnkey
  Supabase cleanup service.

Sources: [Supabase HTTP extension](https://supabase.com/docs/guides/database/extensions/http)
and [upstream timeouts/blocking behavior](https://github.com/pramsey/pgsql-http#keep-alive--timeouts).
The upstream default timeout is five seconds, so an unmodified swap is unsuitable.

## 2. Database-side cleanup instead of an Edge Function

A pure SQL deletion procedure is **not viable**: Storage table rows are metadata;
removing them does not delete the underlying files. Supabase requires deletion
through the Storage API. [Storage deletion](https://supabase.com/docs/guides/storage/management/delete-objects).

A SQL procedure could call that API using synchronous `http`, but would need to
reimplement both cleanup loops, response validation, per-object retry/finalization,
concurrency, time budgets and uncertain-outcome recovery in PL/pgSQL. It would use
privileged Storage credentials at runtime and block database sessions across many
network requests. No pg_net queue secret is needed, but complexity and migration
cost are high; reliability is less attractive than retaining the tested worker.
Not recommended for Langtify. No direct metadata deletion or guard change is proposed.

## 3. Short-lived/non-reusable request authorization

**Viable custom design: signed per-run envelope.** Keep Cron/pg_net, but transmit
only a request UUID, short expiry, fixed-purpose data and an HMAC signature. The
signing key stays in Vault/Edge secrets and is never sent. Bind the signature to
project, endpoint, method and exact payload. Verify expiry and signature before
atomically admitting that UUID once, using the existing lease/run authority.

- Queue credentials: a sensitive, narrowly scoped signed request remains until
  expiry; the reusable signing key does not. A queue reader could race/replay the
  original request, so signature/expiry alone are insufficient. Atomic admission
  must ensure only the originally authorized fixed cleanup run can execute once.
  Queue write access can still cause denial of service.
- Complexity/migration: medium-high. Change dispatcher, handler/auth and replay
  validation; preserve the worker, eligibility and deletion guards. Add adversarial
  expiry, tampering, duplicate/concurrent request and lost-response tests.
- Reliability: asynchronous dispatch remains; delayed requests may expire and leave
  work for a later hourly run. Monitor missed/failed runs rather than hiding them.
- Production: viable after security review, but not the simplest next step.

An opaque one-time ticket with a private stored hash, expiry and atomic consumption
is another custom variant. It avoids transmitting a reusable key but still exposes
an unspent one-use capability in the queue. A plain expiring JWT remains replayable
within its lifetime unless backed by equivalent replay prevention. Do not mint
broad service-role JWTs or use ordinary user sessions as scheduler credentials.

Supabase documents handler-verified signed webhooks, but I found no built-in Cron
one-time-token issuer/consumer. This proposal is custom application authentication,
not a claim that Supabase supplies the replay protocol.
[Edge Function authentication](https://supabase.com/docs/guides/functions/auth#external-webhooks).

## 4. Official Cron → Edge pattern

The documented recipe is Cron → pg_net, with credential/config values retrieved
from Vault. Vault protects storage of the original secret; it does not remove a
secret from the HTTP header once queued. The public/publishable-key example is not
sufficient authorization for privileged cleanup: anyone with the public app key
must not be allowed to invoke maintenance. Switching to a named secret API key
would still queue a reusable credential. No qualifying turnkey alternative was
found in the scheduling/auth documentation above.

## External runner comparison

An always-on scheduled Node runner reuses `scripts/cleanup-submissions.mjs` and its
avatar helper. Keep the service credential in the runner's secret manager, inject
it only at execution, and keep logs counts-only. There is no pg_net request queue.
Code migration is low; deployment/monitoring work is moderate. Configure a hard
runtime bound, one active run, alerts and recovery. Disable Mac scheduling only
after verification. Production suitability is good with reliable operations; a
personal sleeping laptop is not an equivalent production runner.

## App Store timing

**This Supabase-hosted migration is not an App Store prerequisite.** Apple's
published requirements concern working backend services and actual account/data
deletion, not a particular scheduler vendor. Account deletion may be processed
manually or take time if the user is informed and receives completion confirmation;
associated user-generated photos must be covered.
[Apple account deletion guidance](https://developer.apple.com/support/offering-account-deletion-in-your-app/),
[review guidelines](https://developer.apple.com/app-store/review/guidelines/#before-you-submit).

Therefore the migration can be deferred past initial release **only if** an
operational alternative reliably fulfills deletion/recovery and stated retention
behavior. The existing Dev Mac job is Dev-only and does not establish production
coverage. In Langtify, cleanup can finish interrupted deletion and its progression
reconciliation; it is not solely a storage-cost optimization. Do not defer cleanup
itself without an accountable, monitored process. No production launch-readiness
or legal-compliance certification is made here.

## Next decision

Continue Mac cleanup during Dev and leave hosted Cron paused. If a Supabase-only
solution is important, separately prototype/test the synchronous HTTP dispatcher.
Otherwise plan a managed runner for the existing Node worker before relying on
cleanup for real users. Neither path currently requires a Supabase Support ticket.
No new architecture has been implemented.

Verification for this documentation-only pass: `npm run check` passed TypeScript,
ESLint, formatting and 967 tests across 79 suites; `git diff --check` passed.
No alternative dispatcher, short-lived authentication or hosted deletion was tested
or deployed. Those remain design evaluations, not operational acceptance results.
