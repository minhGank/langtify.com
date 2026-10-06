# Hosted Storage cleanup — Dev

Scope: Supabase Dev `ssuyyrfncvyqsgkirvpq` only. No Production changes, mobile
behavior changes, valid-photo deletion, commit or push.

## Authority and execution

`storage-cleanup` invokes the same service-only `claim_photo_cleanup` /
`finish_photo_cleanup` and `claim_avatar_cleanup` / `finish_avatar_cleanup` RPCs
as the existing Node scripts. It accepts a request UUID, never a path, bucket,
identity, batch size or eligibility override. Both buckets remain private.

Submission claims cover deleting rows, expired pending uploads (existing 24-hour
rule), and orphan objects allowed by the existing query. Avatar claims cover
retired/replaced avatars, expired pending uploads (existing one-hour rule) and
eligible orphan objects. Storage triggers still reject deletion of pending or
completed submissions and pending/current avatars. Deletion uses the Storage API;
finalization requires the object to be absent. Existing deletion/XP reconciliation
is unchanged. Failed removals/finalizations remain in durable queues.

Migration `20261003000000_storage_cleanup_coordination.sql` adds private run history,
a singleton lease and two service-only coordination RPCs. One concurrent invocation
wins. Repeated request UUIDs cannot execute again. A 15-minute lease outlives the
Edge runtime's maximum invocation lifetime; crashes eventually release authority.
Unknown failures retain the lease rather than immediately admitting another worker.
Terminal results are immutable through the RPC. No client can read/write these tables
or execute these functions. Migration replay preserves existing runs and leases.

Each run claims at most 100 paths per bucket, runs up to four removals concurrently,
stops dispatch after 70 seconds, and bounds each network operation at eight seconds.
The final in-flight remove/finalize pair and result write can finish after that
70-second dispatch budget. This fits below the 150-second free-tier invocation
limit. Undispatched paths remain queued. A successful Storage removal with a lost
acknowledgement is retried safely through the existing authority; this is not an
exactly-once physical-deletion guarantee.

The endpoint has JWT gateway verification disabled deliberately and authenticates
its dedicated 256-bit `STORAGE_CLEANUP_JOB_SECRET` header instead. It rejects
ordinary user tokens and anonymous calls. The built-in service credential is read
only by the function. No server secret is supplied to Expo. Responses and durable
results contain statuses/counts, never paths, credentials or provider error bodies.

## Cron and credential

`ops/storage-cleanup-dev.sql` enables `pg_cron` and `pg_net`, installs a private
Vault-backed dispatcher and the named hourly `langtify-dev-storage-cleanup` job
(`0 * * * *`, UTC). It uses the fixed Dev endpoint. Reapplying this file updates the
named schedule, not a second job. A unique UTC-hour dispatch record serializes
concurrent/replayed dispatches and retains the pg_net request ID. Hourly attempts
are not automatically resent after a lost response; durable queue work is retried
by a later run. A separate manual invocation must use a fresh UUID deliberately.

The identical dedicated job key lives in Edge secrets and Vault under
`langtify_dev_storage_cleanup_job_key`. Credential creation was explicitly approved
by the operator. Never display either value, query decrypted Vault data for logging,
put a key in shell history, or use mobile/public environment variables. Rotation
must update both locations together while the schedule is paused.

The Node scripts remain available for fallback, but do not participate in the new
hosted lease. They must **not** run concurrently with hosted cleanup. During the
one-time cutover, hold the existing Mac `worker.lock` with `/usr/bin/lockf`; verify
hosted execution, then disable/boot out launchd before releasing that lock. Keep
the Mac disabled while hosted Cron is active. Do not simply run the old CLI manually.

## Monitoring and rollback

Inspect counts-only durable history in trusted Dev SQL:

```sql
select started_at, finished_at, state, result
from private.storage_cleanup_runs order by started_at desc limit 24;
select jobname, schedule, active from cron.job
where jobname = 'langtify-dev-storage-cleanup';
select d.created_at, r.status_code, r.timed_out
from private.storage_cleanup_dispatches d
left join net._http_response r on r.id = d.request_id
order by d.created_at desc limit 24;
```

Cron SQL success only means the HTTP request was enqueued. Verify the HTTP response
and terminal run record too. `retry`, `failed`, `abandoned`, overdue `running`, HTTP
errors and a missing hourly run require attention. pg_net responses have short
retention; run/dispatch history persists. No external alert service or retention
purge is installed in this task; provision monitoring and history retention before
Production. Never “repair” a queue by deleting valid object metadata directly.

Pause hosted dispatch with:

```sql
select cron.alter_job(jobid, active := false) from cron.job
where jobname = 'langtify-dev-storage-cleanup';
```

Before re-enabling Mac fallback, wait for all admitted hosted work to finish and
any uncertain 15-minute lease to expire. Existing Mac files and its protected env
remain available; no service credential needs to be copied back into the repository.
Remove hosted scheduling with `cron.unschedule('langtify-dev-storage-cleanup')`.
Do not drop history or change cleanup eligibility as a rollback shortcut.

## Production prerequisites

Production is untouched. A future separately approved rollout needs its own target
verification, migration review, dedicated credential/Vault entry, endpoint and job
name, monitoring/alerting, retention policy, runtime capacity/batch sizing and a
controlled cleanup test. Do not reuse the Dev-only SQL file unchanged.

## Verification and rollout status

Local and hosted results are recorded below after execution. A deployed function
alone does not establish that Cron or actual cleanup succeeded.

### Local results (2026-10-04)

- `npm run check`: TypeScript, ESLint, formatting and 967 tests / 79 suites pass.
- SQL/RLS mirror: 1,265 assertions / 27 files pass.
- All 18 existing sequential Auth/DB/Storage integration commands pass, including
  bootstrap/replay; the new `db:test:cleanup` also passes. Twelve concurrent
  admissions produce one lease owner; replay preserves the lease and completed
  UUIDs do not run again. Both queue adapters execute successfully locally.
- Function typecheck/lint and 33 tests pass, including nine cleanup tests.
- Local database lint: no warnings/errors.
- iOS/Android/web exports pass. Security scan: 511 source/config/export files and
  both decoded Hermes bundles pass. `git diff --check` passes.
- Expo Doctor: 20/21; SDK compatibility fails because four existing dependencies
  now have recommended patches: expo 57.0.25 → 57.0.26, expo-camera 57.0.5 → 57.0.6,
  expo-constants 57.0.19 → 57.0.20, expo-router 57.0.23 → 57.0.24. No dependency
  changes were made in this operations task.

### Hosted cutover status

Verified the exact Dev project and migration head, both existing Storage guards,
Vault and both cleanup RPCs. Created the operator-approved dedicated credential in
Dev Vault/Edge secrets without displaying its value. Applied only the new
coordination migration and recorded migration history atomically. Deployed only
`storage-cleanup` using API bundling after Docker bundling failed on the unshared
workspace path. Production was not accessed.

### Cutover retry (2026-10-05): stopped at permission verification

Re-verified the linked and explicitly targeted Dev project
`ssuyyrfncvyqsgkirvpq`, migration `20261003000000`, Vault, both cleanup RPCs and
both Storage guards. Acquired the existing Mac execution lock before installing
only `ops/storage-cleanup-dev.sql`. No eligibility, guard, function logic or
dependency changes were made.

The dispatcher and one named Cron job installed successfully. The job is
`langtify-dev-storage-cleanup`, schedule `0 * * * *`, with the expected dispatcher
command. There are no duplicate cleanup jobs (one Cron job total).

**Security blocker:** Dev's installed `pg_net` gives both `anon` and
`authenticated` USAGE on schema `net` and SELECT on `net.http_request_queue`.
The queue has RLS disabled and no policies. That queue can hold the cleanup
credential in HTTP headers. This establishes overly broad database-role access;
it does not establish public REST exposure or an observed credential leak.
The authenticated role cannot read decrypted Vault secrets or execute the private
dispatcher. No secret values or queue contents were retrieved.

Stopped before manual execution, as required. Paused the new hosted Cron job and
verified **active=false**, **zero dispatches**, **zero cleanup runs**, **zero
running cleanup runs**, and **zero pending cleanup HTTP requests** before releasing
the Mac lock. Manual and scheduled hosted counts/HTTP success are **not available**;
no hosted cleanup executed in this attempt. The Mac job was not disabled or booted
out: it remains loaded and enabled. Production was not accessed.

Cutover is **incomplete**. Review and explicitly authorize narrowly scoped HTTP
queue permission hardening before retrying. Do not resume the hosted job or disable
the Mac job until role access is safe and both required hosted executions reach
successful terminal records with zero retries. Existing implementation tests above
remain the prior results; this operations-only attempt did not rerun application
or database integration suites.

### Changed files

- `.github/workflows/ci.yml`
- `package.json` (scripts only; no dependency/lockfile change)
- `src/types/database.ts`
- `supabase/config.toml`
- `supabase/migrations/20261003000000_storage_cleanup_coordination.sql`
- `supabase/tests/storage-cleanup.test.sql`
- `supabase/functions/storage-cleanup/deno.json`
- `supabase/functions/storage-cleanup/deno.lock`
- `supabase/functions/storage-cleanup/index.ts`
- `supabase/functions/storage-cleanup/store.ts`
- `supabase/functions/storage-cleanup/worker.ts`
- `supabase/functions/storage-cleanup/handler.ts`
- `supabase/functions/storage-cleanup/cleanup_test.ts`
- `scripts/test-storage-cleanup.mjs`
- `scripts/scan-credentials.mjs`
- `ops/storage-cleanup-dev.sql`
- `docs/HOSTED_DEV_DEPLOYMENT.md`
- `docs/STORAGE_CLEANUP_HOSTED.md`

Existing Mac cleanup scripts, protected env and launchd files were not changed.
The 2026-10-05 inspection confirmed the Mac job remains loaded and enabled,
not currently running. Launchd reported 92 runs and last exit code 1; this is not
claimed as a new successful Mac execution. The existing counts-only log ends with
`worker_timed_out` after an earlier successful run. That separate Mac timeout was
not changed or retried in this cutover. No manual Mac cleanup was started.

### Security-hardening investigation (2026-10-05)

The requested database-level hardening is **blocked by managed object ownership**,
not completed. `net`, `net.http_request_queue`, `net._http_response` and
`net.http_request_queue_id_seq` are owned by `supabase_admin`. Table/sequence
privileges come from `PUBLIC`; schema USAGE also has explicit client grants.
Revoking only explicit `anon`/`authenticated` table grants would not remove the
inherited access.

A rollback-only Dev transaction attempted to revoke queue SELECT and asserted
that effective client access was removed. It failed with:

```text
P0001: Managed pg_net ACL unchanged: project role cannot revoke inherited queue read access
```

No ACL change persisted. No attempt was made to impersonate the managed owner,
replace the extension, reset data, or bypass its permissions. Supabase Support or
an authorized managed object owner must execute/review
[`ops/storage-cleanup-dev-net-hardening.sql`](../ops/storage-cleanup-dev-net-hardening.sql).
This file is a **not-applied operations proposal**, not an automatically applied
migration. It keeps Cron paused and does not send any HTTP request.

The observed dispatcher owner, Cron username and `pg_net 0.20.4` worker username
are all `postgres`. The proposed minimum operational permissions preserve schema
USAGE, queue SELECT/INSERT/DELETE, response SELECT/INSERT/DELETE and sequence USAGE
for that trusted role. Function EXECUTE is unchanged. The managed owner retains
its inherent rights. Support should check other trusted consumers before applying
this beyond the inspected Dev project. Recheck privileges after extension upgrades.

Exposure verification:

- `anon` and `authenticated` are NOLOGIN roles. Metadata inspection found no public
  function or view referencing the queue, responses, `net`, Vault or the dispatcher.
- Requests using the existing **public** Dev app key, requesting zero rows and
  `Accept-Profile: net`, returned **406 / PGRST106** for both queue and response
  tables. No response data, credentials or queue headers were read or printed.
- Supabase's [documented pg_net defaults](https://supabase.com/docs/guides/database/extensions/pg_net#permissions)
  distinguish these broad SQL grants from Data API exposure. The grants alone do
  not demonstrate client-side access. Langtify's stricter requested database-role
  denial remains unmet and is not being waived based on the API restriction.
- Post-hardening client denial and trusted dispatch are **not verified**, because
  the hosted ACL could not be changed. No hosted cleanup was invoked or Cron enabled.

A rollback-only local fixture validated the proposed SQL: inherited schema/table/
sequence access was removed for both client roles, while each required `postgres`
privilege remained. This is syntax/ACL evidence, not hosted pg_net execution proof.

#### Mac timeout diagnosis and protected retest

The timed-out run began at **2026-10-05 10:11:23 UTC** and logged `worker_timed_out`
at **13:21:38 UTC**, with 11,415,498 ms wall-clock duration. The wrapper labels this
only for the child's `ETIMEDOUT`; it had already acquired the execution lock and
validated configuration. This was not lock contention or credential rejection.

macOS power records show a dark wake at **06:11:19 EDT**, sleep starting at
**06:11:21 EDT**, additional brief dark wakes, then full wake from hibernation at
**09:20:54 EDT**. The failure therefore correlates with sleep/hibernation interrupting
a network-dependent worker. The log cannot identify the pending RPC/Storage call
or distinguish its network outcome, so a particular network/provider failure is
not claimed. Several preceding runs succeeded in roughly two seconds.

With hosted Cron verified paused and no hosted cleanup in flight, one manual run
used the existing `lockf`/validated wrapper under `caffeinate -i`:

```json
{
  "submissions": { "claimed": 0, "removed": 0, "retry": 0 },
  "avatars": { "claimed": 0, "removed": 0, "retry": 0 },
  "status": "success",
  "exitCode": 0,
  "durationMs": 1755
}
```

This supports a transient sleep/interruption timeout rather than a reproducible
worker regression. No Mac script, launchd configuration or credential was changed.
The manual run does not overwrite launchd's historical last-exit record. Its lock
and temporary idle-sleep assertion were released on exit. Mac launchd stays enabled.

No cutover was resumed. Production remains untouched; no commit or push was made.

This pass also passed `npm run check` (TypeScript, ESLint, formatting and 967 tests
across 79 suites) and `git diff --check`. Only this runbook and the new unapplied
owner-level hardening proposal changed in this pass. Hosted application regression
suites and real post-hardening enqueue tests were not claimed: the hosted ACL
transaction rolled back and managed-owner intervention remains required.

### Scheduling alternatives investigated (2026-10-05)

See [the architecture comparison](STORAGE_CLEANUP_OPTIONS.md). Managed-owner ACL
hardening is no longer the only proposed path: synchronous `http` can avoid the
pg_net queue, while a custom single-use signed request can avoid queuing a reusable
key. Both need further implementation/recovery validation. The recommendation for
now is to retain Mac cleanup in Dev, keep hosted Cron paused and avoid contacting
Support. No architecture or hosted state was changed during this investigation.
