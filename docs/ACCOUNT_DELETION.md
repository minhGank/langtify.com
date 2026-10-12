# Account deletion

Implemented locally and applied to Dev on 2026-10-12 under separate explicit
approval. Production remains unchanged. No Production rollout, new scheduling,
Auth settings changes, commits or pushes have been performed.

Profile → Settings → Delete Account explains permanence, lists erased data and
requires typing DELETE. Setup options also exposes Account settings so users can
delete an account without finishing onboarding. Cancel performs no mutation. The request has no user ID,
path or bucket arguments. The existing protected Auth navigation returns to sign-in
after confirmed deletion and local sign-out. Errors never display provider bodies.
A lost response is uncertain, not evidence that deletion was rolled back; an
explicit retry is safe. Never restore or recreate account data to compensate.

## Authority and privacy

`20261012000000_account_deletion.sql` adds `delete_my_account()`, executable only
by `authenticated`, using a fixed empty search path. PostgREST verifies the JWT;
the RPC derives the identity from `auth.uid()` and checks that the JWT's session ID
belongs to a real, unexpired Auth session. It locks the Auth row, then deletes that
row and its dependent records in one database transaction. It does not use the
client-supplied identity or expose a service credential. An already-absent Auth row
returns success for a signed-token retry. Existing stale-token operations remain
subject to their existing RLS, FK, live-owner and session checks.

This deliberately uses a narrowly scoped database function rather than splitting
Auth Admin deletion and personal-data cleanup across network requests. Auth's
user/session/identity relationships and existing product cascades do the erasure.
Legacy refresh tokens and pending PKCE/linking states without user foreign keys
are explicitly erased by the same transaction. No new Edge Function or privileged
mobile configuration is needed. A local real
Auth/Storage integration test verifies deletion while queued objects remain;
Supabase's Admin delete endpoint normally refuses users who still own objects.
Recheck this lifecycle before adopting a different hosted Storage/Auth version.

Profile, learning settings, challenges, assignments, submission metadata,
verification records, completed concepts, XP, streak facts, avatar records,
comments, votes, follows, blocks, inbox references and notification deliveries
cascade away. Existing push cleanup clears user/session/token/platform bindings;
anonymous installation capability tombstones remain to fence stale rebindings.
Shared vocabulary and other people's accounts/posts remain intact.

Safety reports previously retained identifying snapshots indefinitely. The new
Auth deletion trigger erases reports involving the deleted reporter/subject and
associated moderation audit rows, plus audit entries authored by the deleted
moderator. This is an explicit privacy exception to audit immutability, not a new
moderator capability: a private, RLS-protected erasure scope is populated and removed
inside the Auth-deletion transaction. Ordinary audit update/delete still fails;
clients and service_role cannot populate the scope. No identifying audit retention
exception or legal hold is assumed. Failures roll back the complete erasure.

## Files and release prerequisites

SQL never deletes Storage object metadata or bytes, changes object ownership,
disables guards or publishes buckets. Existing submission/avatar delete triggers
queue each path; the RPC also queues already-orphaned objects owned by the caller
in the two application buckets. Both queues survive Auth deletion. Removed
reservations cannot accept new uploads, including stale signed-upload commits.
Previously issued read links retain their existing fixed lifetime (60 seconds).

Existing `cleanupSubmissions` and `cleanupAvatars` remove bytes through the Storage
API and finalize only when objects are absent. Failed removals/finalizations retain
queue entries for retry. Physical erasure is asynchronous and does not depend on
the deleted user staying signed in or keeping the app open.

**Production release blocker:** provision and monitor a trusted Production cleanup
worker for both queues before enabling this feature in a released binary. The
existing Mac worker is Dev-only; the deferred hosted cleanup migration is not a
prerequisite for this SQL, and this change does not enable that migration or Cron.
Choose a supported operational deployment separately, with a defined file-erasure
time expectation reflected in the confirmation copy/privacy policy. Do not claim
complete file erasure merely because the account RPC succeeded. Alert on failed or
aged queue items and verify eventual zero outstanding work for a controlled account.

Rollout requires separate approval to apply the new migration, verify its grants
and triggers, establish cleanup operations and release the mobile change. No new
Edge Function deployment is required. Review backup/provider-log retention and
publish accurate privacy disclosures separately; this feature cannot purge managed
backups or already downloaded copies. App Store acceptance is not established by
local automated tests.

## Verification

- `supabase/tests/account-deletion.test.sql`: caller/session grants, other-account
  protection, atomic rollback, personal-data cascades, audit exception boundaries,
  repeated deletion, durable queues and absence-before-finalization checks.
- `node scripts/test-account-deletion.mjs`: disposable local Auth accounts, genuine
  JWT sessions, both Storage uploads, pending-object guards, actual account removal,
  repeat RPC, denied login, injected Storage removal failure and successful retry
  through the real Storage API. No SQL physical-object deletion.
- `tests/account-deletion.test.ts` and `tests/account-settings.test.tsx`: confirmation,
  cancellation, duplicate dispatch, failure/retry and stale-account/session fencing.

Manual native checks: VoiceOver and keyboard confirmation flow; Google and password
accounts; network interruption before/after commit; app restart after a lost response;
local sign-out/cache clearing; a second signed-in device; current/pending/retired
avatars and daily/historical public/private captures. Verify other accounts remain
usable, the deleted password login fails, signed links expire and physical objects disappear
through monitored cleanup. Confirm with the real Production Auth/Storage versions
only after explicit approval, using disposable accounts and no real user data.
Google sign-in after erasure may create a fresh account; it must never restore the
erased account or its data.

References: [Apple account deletion requirements](https://developer.apple.com/support/offering-account-deletion-in-your-app/)
and [Supabase user lifecycle](https://supabase.com/docs/guides/auth/managing-user-data).

## Local results — 2026-10-12

- `npm run check`: TypeScript, ESLint, Prettier and 1,024 tests / 85 suites pass.
- SQL/RLS mirror: 1,743 assertions / 30 files pass, including 43 account-erasure
  assertions. The ordinary command hit the documented Docker sharing restriction;
  the same files ran from `/private/tmp/langtify-account-db-tests/`.
- All 19 existing sequential integration commands pass: DB integration, challenges,
  submissions, bootstrap/replay, photo audit, progress, vocabulary, Discover,
  ratings, safety, notifications, notification sender, social, avatars, inbox,
  Explore, Past Words, cleanup and Auth (now including account erasure).
- Local database lint reports no warnings/errors. The new migration also replays
  locally without losing state. Existing Edge Functions were served from a shared
  temporary mirror for the integration tests; no function was deployed.
- iOS/Android/web exports pass. Credential scan passes for 547 files and both decoded
  Hermes bundles. `git diff --check` passes.
- Expo Doctor is 20/21; SDK compatibility reports seven newly recommended patches:
  expo 57.0.27 → 57.0.28, expo-auth-session 57.0.14 → 57.0.15,
  expo-crypto 57.0.3 → 57.0.4, expo-dev-client 57.0.19 → 57.0.20,
  expo-router 57.0.25 → 57.0.26, expo-splash-screen 57.0.9 → 57.0.10,
  jest-expo 57.0.5 → 57.0.6. Dependency files were not changed.
- Physical-device, hosted version compatibility, Production cleanup timing and
  App Store acceptance are not established by these local results.

## Changed files

- UI: `app/account-settings.tsx`, `app/_layout.tsx`,
  `src/features/profile/account-settings-screen.tsx`,
  `src/features/profile/profile-screen.tsx`,
  `src/features/onboarding/onboarding-screen.tsx`.
- Client authority/types: `src/services/account-deletion.ts`, `src/types/database.ts`.
- Database: `supabase/migrations/20261012000000_account_deletion.sql`.
- Tests: `supabase/tests/account-deletion.test.sql`, `tests/account-deletion.test.ts`,
  `tests/account-settings.test.tsx`, `scripts/test-account-deletion.mjs`,
  `scripts/test-auth-sessions-integration.mjs`, `scripts/test-safety-integration.mjs`.
- Runbook: `docs/ACCOUNT_DELETION.md`.

## Dev rollout — 2026-10-12

Applied **only** `20261012000000_account_deletion.sql` to
`ssuyyrfncvyqsgkirvpq`, explicitly targeted through the authenticated Supabase CLI.
The migration and its history row committed in one transaction with permission
assertions. SHA-256:
`f5b6d6ec4f65f20e4e86e0120fb3813ad2433b3343ced023f70edd29fa57e54f`.
Dev history now contains 31 migrations, headed by `20261012000000`; the two October 5
Production-default grant migrations were not applied to Dev as unrelated work.

Preflight confirmed the hosted Auth `flow_state.user_id`/`linking_target_id` columns,
required Auth table privileges and existing helper ownership. Postflight confirmed:

- `delete_my_account()` is SECURITY DEFINER with an empty search path and no
  arguments. Only `authenticated` can execute it; `anon` and `service_role` cannot.
- Both private erasure helpers deny client/service execution. The private erasure
  scope denies client/service insertion and is empty after deletion.
- The new Auth erasure trigger and both existing Storage deletion guards are enabled.
- Both buckets remain private, JPEG-only, with 5 MiB challenge / 1 MiB avatar limits.
- All four cleanup claim/finalize RPCs remain service-only.

Disposable hosted Auth/Storage verification passed with genuine password sessions:
no anonymous/service-role deletion, no caller-selected victim argument, pending
object deletion blocked in both buckets, caller hard deletion, same-token retry,
old password login denied, other disposable account retained, and profile/session/
challenge/submission/avatar cascades verified. Both queues retained work while
objects existed; premature finalization failed. Targeted Storage API removal and
finalization then succeeded for both uploaded fixture paths. No global cleanup
claim was invoked. Additional rollback-only disposable SQL fixtures verified
missing, foreign and expired sessions are rejected under the authenticated role.

The first harness attempt stopped because it incorrectly expected an avatar path
to include the owner UUID. Correcting the temporary harness to use the actual
reservation ID resolved this; no application change was needed. All four persisted
test accounts were removed. One avatar reservation cleanup entry from that aborted
attempt remains without a corresponding Storage object; the regular worker can
finalize it. Final observed queue counts: photos 0, avatars 1, queued avatar objects 0.
No real user was deleted. Full completed-photo/XP/social/audit rollback cases remain
covered by the earlier local suites, not claimed as newly run hosted tests.

During the hosted lifecycle test, `/usr/bin/lockf` held the existing Mac worker lock
and `caffeinate -i` prevented idle sleep; both were released on exit. Mac launchd
remains enabled (observed 259 historical runs, last exit 0). Hosted Cron remains
paused, with zero hosted runs. No Production project was accessed.

After the runbook update, `npm run check` passed again: TypeScript, ESLint,
formatting and 1,024 tests / 85 suites. `git diff --check` passed. No application or
migration code changed in this operational pass; the full local database suites
listed above were not rerun.

## Production cleanup implementation and deployment order

The recommendation is now implemented locally in the
[Production cleanup runner and deployment runbook](PRODUCTION_STORAGE_CLEANUP.md).
It reuses both unchanged adapters on one always-on Ubuntu runner, with bounded
requests, independent bucket budgets, a kernel lock, hourly systemd timer and
external failure/missing-run monitoring. It has **not been deployed**.

Follow that runbook to provision the host and protected credentials, verify the
existing Production RPC grants/Storage guards, commission disposable fixtures and
alert delivery, then enable scheduling. Separately approve and apply the account
migration with atomic history and permission assertions; never use an unfiltered
migration push that includes deferred cleanup coordination. Do not release the
mobile deletion feature until Production cleanup and privacy/native acceptance pass.

Automatic backlog monitoring uses conservative full-batch capacity warnings and
retry/timeout alerts. It does not expose total queue depth or automate oldest-age
alerts; the runbook includes trusted counts/age queries for incident investigation.
This distinction supersedes the earlier proposed oldest-age monitoring requirement.
Align any promised erasure deadline with measured operations and operator response.
The existing Dev Mac runner and paused hosted dispatcher remain unchanged.

Supabase documents that deleted users' JWTs can remain valid until expiry; existing
live-session/live-owner checks therefore remain important. Already issued signed
media links have their existing expiry. This SQL-based deletion was verified with
Dev's hosted Auth/Storage versions; repeat that controlled compatibility check in
Production rather than assuming the projects are identical.
[Auth lifecycle](https://supabase.com/docs/guides/auth/managing-user-data),
[Storage deletion](https://supabase.com/docs/guides/storage/management/delete-objects).
