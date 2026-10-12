# Production Storage cleanup runner

Implemented locally; **not deployed**. No hosted project, existing Mac job, SQL,
Edge Function or mobile dependency changed. Production is exclusively
`lfdgjewypbhukjrtwsef`; Dev remains `ssuyyrfncvyqsgkirvpq`.

## Platform and cost

Use one **DigitalOcean Basic Droplet, Ubuntu 24.04 LTS, 1 vCPU / 1 GiB**, with
systemd and Node 22 LTS (at least 22.13). Budget **US$6/month**, plus taxes, optional
backups and any provider overages. No inbound application port is needed. Restrict
SSH to the operator; enable OS security updates. This is a small self-managed VM,
so the operator owns OS/Node patching and recovery. It is independent of the Mac.
[DigitalOcean pricing](https://www.digitalocean.com/pricing/droplets).

Use two **Healthchecks.io** checks (photos and avatars). Its free plan covers 20
checks, so the expected additional monitoring cost is $0. Configure verified email
recipients and repeat reminders; test actual delivery. Neither a code test nor a
successful ping proves an operator received an alert.
[Pricing](https://healthchecks.io/pricing/),
[check configuration](https://healthchecks.io/docs/configuring_checks/).

## Execution and authority

The new `scripts/production-cleanup.mjs` imports the unchanged
`cleanupSubmissions` / `cleanupAvatars` adapters. Each independently claims at most
100 jobs and removes objects through the Storage API, finalizing only after absence.
The existing database queues, eligibility, backoff and Storage guards remain the
only deletion authority. Failed/uncertain removals or finalizations leave durable
work for the next run. There is no automatic network write replay or exactly-once
physical-deletion claim.

Both buckets start concurrently with separate clients and 120-second budgets.
Every Supabase network request has an eight-second deadline and rejects redirects
or a different origin. Each bucket is sequential internally (at most two operations
in flight across the two buckets). Deadline cancellation stops network dispatch;
already admitted server work can still complete. The five-minute systemd timeout
kills the complete process group if SDK code fails to settle. The next run safely
reclaims durable work; never infer that a timeout rolled back a Storage operation.

The hourly persistent timer catches a missed run after reboot. systemd serializes
starts of its oneshot service; `flock` additionally holds a kernel lock through the
worker lifetime and releases it after crashes. A conflicting lock exits 75. Always
invoke the service, including manual recovery; do not run the Node entry point
outside its lock. **Exactly one host and one scheduler are supported.** This is not
a distributed lease: stop the old host before enabling a replacement. Do not also
enable Supabase Cron, a second VM, the old generic cron example, or Mac cleanup for
Production. Dev's existing runner stays untouched.

No cleanup coordination migration, new RPC, Vault dispatcher or Edge Function is
needed. Production must already have the existing core cleanup RPCs and guards.
Account deletion itself still needs its separately approved Production migration.

## Alerts and backlog

Each bucket sends a counts-only Healthchecks POST after its attempt. `retry`,
`failed`, `timeout`, and `capacity` send `/fail`; only a successful run below the
batch limit sends success. A bad HTTP response/network failure from monitoring also
makes the process exit nonzero. Configuration errors log only a fixed status and
send no success. Host death, disabled timer, missing credentials, killed processes,
DNS/network outages and lock conflicts are detected by missing external heartbeats.

Create **two independent cron checks**, UTC schedule `0 * * * *`, grace **10 minutes**.
The worker budget is under five minutes. Turn on reminders for checks remaining
down and recovery notifications. Prime both checks during commissioning; unstarted
checks must not be mistaken for active monitoring. Do not use request-body match
rules or configure failures as successes. Do not send `/start`: the external cron
schedule is the source of missing-run detection.

A full 100-job claim always alerts, even if all 100 removals succeed. This deliberately
conservative capacity signal flags queues that may exceed hourly capacity and stays
failed while batches remain saturated. A retry/timeout alerts even for one stuck job.
**These are capacity/failure signals, not exact total queue depth, queue growth rate,
or oldest-age metrics.** Existing RPCs only return claimed paths. Adding a new
privileged metrics RPC solely for this runner was avoided. Do not claim an automated
oldest-age SLA. On an alert, inspect these counts-only queries in trusted Production
SQL (never print queue paths or object headers):

```sql
select 'photos' as bucket, count(*) as queued, min(created_at) as oldest
from private.photo_cleanup_queue
union all
select 'avatars', count(*), min(created_at)
from private.avatar_cleanup_queue;
```

Investigate increasing counts, age above two hours, repeated full batches or any
persistent failures. Review capacity before changing frequency/batch size. An hourly
schedule is not a guaranteed one-hour erasure promise; align the privacy disclosure
with measured operations and incident response. Exact queue-age alerting would need
additional read-only monitoring authority and is not supplied by this minimal runner.

## Secrets and environment

There are **no application environment variables to set**. Do not use `.env.local`,
Expo public variables, EAS, GitHub Actions secrets or build arguments for this worker.
The service uses systemd `LoadCredential` to mount a root-owned JSON configuration
read-only; systemd supplies `CREDENTIALS_DIRECTORY` to Node automatically.

Create `/etc/langtify-production/cleanup.json` on the host from
`ops/production-cleanup/cleanup.example.json` using a protected editor/secret manager.
Set directory permissions 0700 and file permissions 0600, owned by root. Never paste
real values into a shell command, repository file, terminal output or log.

| Field              | Required value                                               |
| ------------------ | ------------------------------------------------------------ |
| `environment`      | `production`                                                 |
| `supabaseUrl`      | `https://lfdgjewypbhukjrtwsef.supabase.co`                   |
| `serviceKey`       | Production-only server secret key or service-role JWT        |
| `photosHeartbeat`  | Dedicated photos `https://hc-ping.com/<uuid>` URL            |
| `avatarsHeartbeat` | Different dedicated avatars `https://hc-ping.com/<uuid>` URL |

The URL/environment are pinned; localhost, Dev and missing/public keys fail before
any requests. Legacy JWT role/ref/expiry are checked locally. Opaque secret keys
cannot be decoded to prove project membership; select the key in the Production
dashboard and verify server authorization during commissioning. Supabase itself
checks the credential. Heartbeat URLs are monitoring credentials and stay private.
The Supabase credential is broadly privileged: host access and operator access must
be restricted. SDK errors, provider bodies, object paths and keys are never logged.

## Manual deployment (not executed)

1. Review this patch. Provision the Droplet, SSH restrictions, OS updates, Node LTS
   and npm. Node must be available at `/usr/bin/node`; install util-linux (`flock`).
   Create both Healthchecks checks and alert recipients as above.
2. In trusted Production SQL, verify the four cleanup RPC grants (only service_role),
   both private JPEG buckets/limits and deletion guards. Confirm no other Production
   cleanup scheduler exists. Do not apply unrelated/deferred migrations.
3. Create the dedicated service account and directories:

   ```sh
   sudo useradd --system --user-group --no-create-home --shell /usr/sbin/nologin langtify-cleanup
   sudo install -d -o root -g root -m 0755 /opt/langtify-cleanup/scripts
   sudo install -d -o root -g root -m 0700 /etc/langtify-production
   ```

4. Transfer **only** the reviewed files listed below over SSH/SFTP (no `.env`, mobile
   checkout or credentials). Install them root-owned, read-only to the service user:
   - `scripts/production-cleanup.mjs`, `scripts/cleanup-submissions.mjs`,
     `scripts/cleanup-avatars.mjs` → `/opt/langtify-cleanup/scripts/`.
   - `ops/production-cleanup/package.json` and `package-lock.json` →
     `/opt/langtify-cleanup/` (isolated exact Supabase dependency; no Expo tooling).
   - The `.service` and `.timer` files → `/etc/systemd/system/`.
     Install dependencies in a nonprivileged staging directory with
     `npm ci --omit=dev --ignore-scripts`, audit with `npm audit --omit=dev`, then copy
     the resulting `node_modules` root-owned into `/opt/langtify-cleanup/`.
     Do not run npm with access to the real cleanup credentials. Verify artifact hashes
     against the reviewed source before activation. Create the protected JSON separately.
5. Validate the installed unit, leaving the timer disabled:

   ```sh
   sudo systemd-analyze verify /etc/systemd/system/langtify-cleanup.service /etc/systemd/system/langtify-cleanup.timer
   sudo systemctl daemon-reload
   sudo systemctl start langtify-cleanup.service
   sudo journalctl -u langtify-cleanup.service --since '10 minutes ago'
   ```

   **This first start performs real eligible cleanup**, not a dry run; obtain
   Production deployment approval first. Prepare disposable fixtures in both buckets
   and verify live-object guards, failed-removal persistence, eventual API absence
   and queue finalization. Never make test failures by changing real users' data.
   See `ACCOUNT_DELETION.md` for the separate account-deletion rollout order.

6. Verify both heartbeats, email alerts and recovery. In a controlled commissioning
   window, a deliberately invalid worker key should produce failed checks without
   deleting anything; restore it securely and rerun. Stop the timer temporarily to
   verify a missing-run alert. Do not claim commissioning complete until alerts
   actually reach the responsible operator.
7. Enable only after successful controlled verification:

   ```sh
   sudo systemctl enable --now langtify-cleanup.timer
   sudo systemctl list-timers langtify-cleanup.timer
   ```

   Confirm two scheduled runs and both external checks. Monitor queue counts and
   oldest work. Do not enable the mobile account-deletion release before successful
   Production cleanup and privacy/manual-native acceptance.

## Recovery and rotation

- Inspect counts/statuses in journald and the two check histories. Keep bounded
  journal retention (for example 100 MiB / 14 days). A failed monitoring request
  leaves the check without success; repair monitoring rather than ignoring it.
- Retry with `sudo systemctl start langtify-cleanup.service`; this preserves lock,
  deadlines and alerts. Never reset queues, change eligibility, SQL-delete Storage
  metadata or delete the lock file while a process owns it.
- For credential rotation or code replacement, stop the timer and wait for the
  service to finish (or stop it and allow the bounded in-flight server work to
  settle). Replace the protected credential/artifact, manually verify both buckets,
  then re-enable the timer. Do not rotate by changing public mobile configuration.
- To move hosts, disable the old timer, finish/stop its worker, and power off the old
  host before enabling the new one. Revoke its credential access. Never rely on the
  machine-local lock to coordinate two hosts.
- A crash after removal but before finalization is safe: the queue survives and the
  next adapter run can remove an already-absent object and finalize. Keep the DB
  queues as the recovery source, not local files or heartbeat history.
- Rollback: stop/disable this timer, retain durable work, fix/redeploy the runner.
  Do not substitute the Dev Mac worker or activate the deferred Supabase dispatcher.

## Automated verification

`node --test scripts/tests/production-cleanup.test.mjs` covers configuration guards,
real-adapter retry behavior, failed claims/finalization, parallel bucket isolation,
timeouts, bounded transport, capacity alerts/recovery and monitoring failures.
`tests/production-cleanup.test.ts` includes it in the existing `npm run check` gate.
The Linux-only kernel-lock regression is also runnable with
`sh scripts/tests/cleanup-lock.sh`; it proves overlap denial and crash release.
Native Mac runs skip that Linux test; run it in Ubuntu or Linux CI.

No new schema, RLS, function body, Storage rule, mobile dependency, or existing Dev
runner changes are required. Hosted deletion, actual email delivery, reboot/timer
activation and systemd sandbox behavior require the manual commissioning above.

## Local results — 2026-10-12

- `npm run check`: TypeScript, lint, formatting and 1,025 tests / 86 suites pass.
  The new Jest gate invokes 10 passing Node worker regressions; the Linux-only
  kernel test is skipped on macOS and was run separately in Ubuntu 24.04.
- Ubuntu 24.04 `flock` overlap/crash-release test passes. The initial attempt in the
  local Supabase container failed because that container provides BusyBox flock;
  the deployment explicitly requires Ubuntu/util-linux.
- `systemd-analyze verify` passes for both units in a disposable Ubuntu 24.04
  container. This validates unit syntax/dependencies, not a booted service with
  real credentials (the container used a placeholder Node executable for analysis).
- Isolated worker lockfile audit: 10 packages audited, 0 vulnerabilities. The root
  mobile package/lockfile and existing audit exception policy are unchanged.
- iOS/Android/web exports pass. Credential scan passes: 554 files and two decoded
  Hermes bundles, no privileged credentials or server implementation in exports.
- `git diff --check` passes. Expo Doctor remains 20/21; SDK compatibility still
  reports the seven existing recommended patches recorded in ACCOUNT_DELETION.md.
  No mobile dependency upgrade was made.
- No hosted request, deployment, actual alert delivery, commit or push was performed.
  No database schema or adapter changed, so the earlier database lifecycle tests
  were not rerun for this server-wrapper-only change.
