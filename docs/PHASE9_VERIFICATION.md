# Phase 9 implementation and verification

The subsequent [Phase 9 audit](PHASE9_AUDIT.md) records two UI fixes and expanded
verification. The results below describe the original implementation handoff.

Phase 9 implements the explicitly approved Reporting, Blocking & Moderation proposal.
No Phase 10 functionality, new dependencies or hosted deployment is included.
Local automated verification passes; physical-device and hosted operator acceptance
remain required. This is not a claim of public-production launch readiness.

## 1. Schema and migration

`20260917000000_phase9_safety.sql` adds `user_blocks`, `safety_reports`, immutable
`moderation_audit`, and private `safety_accounts`, `moderators`,
`submission_moderation`. Existing Auth users receive safety state and an Auth insert
trigger initializes future users. Report target identity, controlled categories,
length bounds, unique active reports/blocks and audit request uniqueness are database
constraints. Generated public database types are updated.

The migration preserves audited publication implementations in private functions
behind public admission wrappers. Ordered bootstrap and replay over nonempty safety
and learning history preserve existing records and XP. Apply the migration before
the matching function and app in any future hosted deployment.

## 2. Blocks

A directed, private block has a unique blocker/blocked pair and rejects self-blocks.
Public eligibility is mutual: neither account sees, signs or rates the other's
public submissions. Duplicate current blocks acknowledge safely. Own block-list
pagination exposes only opaque block IDs and usernames; unblock takes the owned
block ID so a delayed old unblock cannot erase a newer reblock. Personal Vocabulary
and existing votes remain intact.

## 3. Reports

Photo and user reports resolve subjects from an eligible public submission, without
accepting caller-selected reporter/owner identity. Seven controlled reasons and
optional details of at most 500 characters are enforced server-side. One open report
per reporter/target preserves the first report's details during retries. Creation
returns a safe acknowledgement; ordinary clients cannot read raw cases or outcomes.
Cases transition to resolved or dismissed through moderator authority and remain
reviewable. Reports never award XP or change streaks.

## 4. Moderator authorization

Only trusted SQL can provision `private.moderators`; see [operator instructions](MODERATION.md).
User metadata, existing JWTs, route knowledge and frontend booleans cannot grant
membership. Every privileged RPC checks current backend membership and account
validity. Revocation denies subsequent requests without requiring a new login.
Ordinary users see no moderator navigation, and direct routes load no case data.

## 5. Actions and audit

Remove/restore public photos, restrict/restore public account participation, and
resolve/dismiss reports are atomic with immutable audit events. Each event records
moderator, target, action, server timestamp and optional reason. Actor/request UUID
uniqueness makes retries idempotent; an older removal retry cannot undo a later
restore. SQL denies audit updates/deletes. Operational role revocation waits for an
already admitted write to finish.

Removal preserves submission completion and private learning. Restriction preserves
Auth sessions/private data but denies public reads, signing, publication, ratings,
new reports and new blocks; private management and unblocking remain available.
Restoration still respects independent privacy, removal and block state.

## 6. Discover, ratings and signing

Server eligibility excludes both block directions, removed content and restricted
owners/viewers. Existing bounded timestamp/UUID feed pagination and grouped rating
summaries remain. Sorted per-account revision locks precede submission locks for
safety-critical writes, including old snapshot rejection.

The bucket remains private. Public signing rechecks current eligibility and retains
60-second capabilities. The new moderator preview accepts only a report ID, verifies
the caller's backend role and signs the report's verified completed photo. It may
review a later-private/removed reported photo, as explicitly approved, but cannot
sign an arbitrary unreported private path, pending/deleted image or unverified version.

## 7. UI

Discover has nonowner Report photo, Report user and Block user actions, controlled
reason/detail confirmation and safe acknowledgements. Profile links to Blocked users
and, only with backend access, Moderation. The internal interface provides bounded
open/resolved/dismissed queues, case context, expiring previews, confirmed actions
and paginated audit history. State clears on account/focus/background changes;
requests use pinned identities, cancellation, generation checks and 20-second local
deadlines. All safety gateway methods refuse already-cancelled follow-up requests.

## 8. Security boundaries

All six new source tables have RLS and no raw client privileges. Reports, other users'
block relationships, moderator membership and audit history cannot be read or edited
through ordinary REST calls. Controlled RPCs derive actors from Auth. Only the
service role may invoke the report-photo target lookup, and its viewer comes from
verified Auth in the Edge Function. Reporter identity is omitted even from case UI
projections. No public owner UUID, email, service key or moderator provisioning API
is added. Existing private Storage, lifecycle, XP, streak and vocabulary authority
remain covered by regression suites.

## 9. Commands and results

All checks below ran against local development only. Shared Auth/Storage/SQL suites
ran sequentially; bootstrap uses a separate disposable database.

| Check                                                                                | Result                                                                                                     |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `npm run db:migrate` and final local migration replay with `psql -v ON_ERROR_STOP=1` | Passed                                                                                                     |
| `npm run check` (typecheck, lint, formatting, application tests)                     | Passed; 296 tests in 33 suites                                                                             |
| `npx supabase test db /private/tmp/langtify-db-tests/`                               | Passed; 610 assertions in 14 files, including 69 Phase 9 assertions                                        |
| `npm run db:test:safety`                                                             | Passed; 9 real Auth/Storage, authority, concurrency and expiry groups                                      |
| `npm run db:test:ratings` / `npm run db:test:discover`                               | Passed; 7 / 7 groups                                                                                       |
| `npm run db:test:integration` / `npm run db:test:challenges`                         | Passed; 5 / 4 groups                                                                                       |
| `npm run db:test:submissions` / `npm run db:test:photo-audit`                        | Passed; 10 / 6 groups                                                                                      |
| `npm run db:test:progress` / `npm run db:test:vocabulary`                            | Passed; 7 / 7 groups                                                                                       |
| `npm run db:test:bootstrap`                                                          | Passed; 13 groups, including nonempty safety replay                                                        |
| `npx supabase db lint --local --level warning`                                       | No schema errors                                                                                           |
| `npm run functions:check`, `npm run functions:lint`, `npm run functions:test`        | Passed; 6 Deno tests; new moderator branch also exercised through real local Edge/Auth/Storage integration |
| `npx expo install --check`, `npm run doctor`                                         | Dependencies compatible; Doctor 21/21                                                                      |
| `npm run export:check -- --clear`, final `npm run export:check`                      | iOS, Android and web exports passed                                                                        |
| `npm run security:scan`                                                              | Source/config and exported web/decoded Hermes credential checks passed                                     |
| `git diff --check`                                                                   | Passed                                                                                                     |

The SQL command uses the README's Docker file-sharing fallback: copy the repository
SQL tests to `/private/tmp/langtify-db-tests/` before running the same Supabase test
runner. No tests are skipped. Local integration fixtures are removed afterward.
Existing Node module-type/color warnings are informational; no check failed at handoff.

Tests cover duplicate reports/blocks, both rating/block lock orders, stale unblock
IDs, removal/publication/rating races, concurrent signing/removal, restrictions with
active JWTs, role spoofing/revocation, raw REST denial, immutable audit retries,
stale snapshots, private case previews and actual Storage capability expiry. UI tests
cover ordinary-user denial, account switching, backgrounding, stalled requests,
preview expiration, confirmation and bounded pagination. XP events remain unchanged.

## 10. Phone and admin acceptance

Use test accounts in the intended hosted development project after deploying the
migration, function and app. Provision/revoke a test moderator only through trusted SQL.

1. On iOS and Android, confirm existing password/Google login, onboarding, camera,
   private Vocabulary and progress still work. Repeat the public flow on web.
2. With accounts A/B, report a photo and a user, including duplicate taps and offline
   retry. Check controlled reasons, 500-character detail handling and safe acknowledgement.
3. Block B from A: refresh both devices and verify mutual feed/photo/rating exclusion.
   Confirm each private dictionary remains intact. Unblock from A's list and verify
   normal eligibility returns; check more than one block-list page.
4. Open the moderation route as an ordinary account and after account switching.
   Confirm no queue, case, preview or prior moderator state appears.
5. As a moderator, inspect all report statuses and multiple queue/audit pages. Review
   a reported photo after its owner makes it private, and confirm an expired preview
   disappears and reload requires current authorization.
6. Remove/restore a photo while another device changes visibility or rates it. Confirm
   new reads/signatures/votes respect the final backend state and XP/completion do not change.
7. Restrict/restore an active account. Confirm public publication/interactions are
   denied with its existing session while private learning and deletion remain available.
8. Retry an uncertain moderation action and confirm one audit event. Restore, then
   retry the old request and verify it cannot remove/restrict again.
9. Revoke moderator access while the screen is open; confirm subsequent privileged
   calls fail and role revalidation clears controls/data. Background/resume and switch
   accounts while reads/actions are pending; no stale context may cross accounts.
10. Confirm operator membership, audit access, staffing, case handling and incident/
    retention procedures before considering public launch. No real operator was provisioned here.

## 11. Remaining risks and release limits

- Exports are not native binaries or physical-device acceptance. Hosted migrations,
  Edge deployment, device testing and moderator provisioning have not been performed.
- Issued capabilities and already admitted read snapshots retain the existing short
  lifetime; removal cannot recall downloaded content. There is no realtime feed guarantee.
- Cancelling a client request does not undo an accepted transaction. Refresh and
  authoritative state/audit reconciliation remain necessary after uncertain responses.
- Reports can contain sensitive optional details. Durable case/audit identifiers
  survive hard deletion intentionally; no retention deadline or erasure policy is invented.
- Measure production query latency, hot-account lock contention and report abuse.
  Current indexed/bounded reads and duplicate/detail limits do not establish capacity
  or provide complex abuse scoring. Audit cursors beyond safe JavaScript integers
  are rejected rather than silently rounded.
- Operational readiness requires staff, content rules, access reviews and incident/
  retention procedures. Implemented safety mechanisms alone do not establish it.

Phase 9 is ready for hosted development and physical-device/admin acceptance.
Phase 10 remains unimplemented.
