# QA #28–31 — useful history, profile identity and inbox opening

Level-rule update: [QA #32](QA32_LEVEL_PROGRESSION.md) supersedes the original
Level 0 curve recorded below. Current acceptance starts at Level 1 (0/40 XP).

Implementation and explicitly approved local verification (2026-09-28). No Phase 11, QA #32 level-rule
change, dependency/native configuration change, commit, push, deployment or hosted
modification. Prior uncommitted QA work is preserved. Physical acceptance is pending.

## Word detail

Search's existing concept read now includes `has_captures`, an indexed existence
check for the authenticated viewer's completed captures. The client renders Your
photos below examples only when true, with no extra history request or replacement
empty-state text. Today's immutable assignment detail retains its existing bounded
cached concept-history read and hides the action while unknown, empty or failed.
Completion/deletion invalidation refreshes existence through the existing vocabulary
tag. No arbitrary Add photo action or change to current-day/Past Words eligibility.

## Public Level

Eligible public profiles show **Level · Followers · Following**, matching the owner
summary. `get_public_profile` and the existing follow/connection profile projection
include one new integer: `level`. The backend sums the subject's signed XP ledger
using its owner index and the existing exact level helper. No total XP, ledger,
streak, timezone, email or Auth identity is exposed. Search/author rows do not issue
per-row progress reads. Blocking/moderation admission remains unchanged.

The current minimum remains Level 0. The UI supports Level 1 without a hardcoded
minimum; any separately approved QA #32 backend change must still update the shared
level helper, not invent a client calculation.

## Blocked accounts

The screen is a paginated avatar/username list with an explicit secondary Unblock
action. Tapping identity opens the existing native public-profile route in a distinct
`blockId` recognition mode. It never mounts the ordinary profile, posts or follow
controls. Recognition shows only username, avatar, blocked state and Unblock. There
are no counts, Level, posts, private fields or automatic relationship changes.

`get_blocked_profile` requires ownership of the specified outgoing block. The list
and recognition view return exactly block ID, username and nullable current avatar
ID. The new `blocked-previews` purpose in the existing **`avatar-authority`** function
uses a separate service-only lookup. It requires an active, onboarded viewer and
subject, an owned outgoing block, no account restriction, and the current verified
avatar's matching Storage object/version. Restricted/banned/unavailable avatars
fall back to initials. Ordinary public avatar signing still denies mutual blocks.
No public bucket, raw profile grant, caller-selected path, TTL or signing identity.

Avatars use batches of at most 24, fixed 60-second URLs and the existing 55-second
monotonic download admission. Only downloaded pixels may survive URL expiry in a
bounded session cache; blocked-recognition pixels have their own namespace. The
list keeps at most 40 rows, an independent keyset cursor, explicit refresh (including missing avatar access) and cached
navigation. No elapsed-time refresh or N+1 identity reads.

Successful Unblock removes the row immediately, provides a notice/haptic and
invalidates only this session's affected public relationship/profile/feed/comment/
inbox data. Existing backend rules decide which relationships become eligible.
Uncertain writes invalidate affected reads without automatically repeating Unblock.
Private vocabulary/progress/settings remain cached. Back/swipe-back and direct-route
fallbacks use the existing native stack. Controls retain 44-point targets, scalable
text, neutral light/dark surfaces and existing Reduce Motion behavior.

## Inbox admission and concurrency

A fresh inbox route mount generates one request UUID. `open_notification_inbox`
uses Auth identity, not a caller recipient or date. In one transaction it:

1. Locks the viewer's Auth row, then serializes inbox openings for that viewer.
2. Reuses a durable existing receipt, or captures a server cutoff and the current
   statement's eligible unread notification membership.
3. Updates only those captured rows and records the receipt atomically.
4. Returns the current authoritative unread summary and read/eligibility state for
   at most 60 displayed IDs. It does not fabricate zero on the client.

An uncommitted notification cannot join the opening snapshot, even if its creation
stamp precedes the cutoff. An event created after the cutoff remains unread. Reusing
an acknowledged or uncertain UUID never repeats the write, so later commits also
remain unread. A new explicit route visit creates a new admission. Returning from
child content, refreshing history, refreshing the JWT or resuming the same mounted
route does not silently create another opening.

The cutoff is **database admission time**, not the physical tap's device timestamp.
Network latency can delay admission; the UI keeps existing rows/badge until the
server responds. The durable receipt is retained until account deletion rather than
expiring and making old retries dangerous. This adds one small row per fresh visit;
future retention work must preserve idempotency.

Cached rows reconcile from returned ID states, including removal of now-ineligible
rows. The independent page cursor survives a fully filtered window. Stale badge and
page requests are cancelled/revision-checked; account changes retire their entries.
No polling or unrelated screen refresh. Manual read controls are removed; existing
read RPCs remain for older-client compatibility. Follower → public profile, rating →
canonical `/post`, daily → Today use server-resolved fixed destinations. No route,
photo URL, rater identity or client-generated event enters notification navigation.
Remote push remains DAILY_WORDS/STREAK_AT_RISK; social events remain in-app only.

## Migration and operation changes

Migration: **`20260927000000_qa28_31_profile_safety_inbox.sql`**, applied to the
persistent local Supabase database on 2026-09-28. No hosted migration was performed.

- Adds private RLS-protected `inbox_openings`, keyed by user/request with finite
  server timestamp and account-delete cascade; no direct client table grants.
- Adds `open_notification_inbox(uuid,uuid[])` and `get_blocked_profile(uuid)` for
  authenticated callers; adds service-only `get_blocked_avatar_targets(uuid,uuid[])`.
- Extends existing concept/profile/blocked-list/notification-target projections.
  All new security-definer functions set an empty search path; helper execution is
  revoked from ordinary roles. Existing RLS, Storage and write authority remain.
- Reuses owner-history, XP-owner, block-owner/keyset and notification-owner/unread
  indexes. Responses are bounded; exact Level/unread totals process the respective
  owner's indexed ledger/unread history.
- Changes only the existing `avatar-authority` Edge Function; no new function,
  hosted secret, cron, provider setting or native dependency.

The migration is transactional/replay-preserving. SQL tests cover ownership,
field minimization, existence/deletion, level boundaries, read cutoff/idempotency,
RLS/anonymous/cross-user denial and restricted profiles. Real integration additions
cover blocked avatar signing/expiry, concurrent inbox admission/production, later
arrivals, old retries and keysets. Bootstrap additions verify nonempty migration
replay preserves photos, XP, read state and durable receipts. See the local results
below; physical acceptance remains a separate requirement.

## Verification

Passed locally:

- `npm run check`: TypeScript, ESLint, formatting and **950 application tests / 79
  suites**.
- `npm run functions:check`, `npm run functions:lint`, `npm run functions:test`:
  all three functions compile; **24 function tests** pass.
- `EXPO_NO_DOTENV=1 npm run doctor`: **21/21** online checks.
- `EXPO_NO_DOTENV=1 npx expo install --check`: online dependencies up to date.
- `npm run export:check -- --clear` with dotenv disabled and local public fixtures:
  iOS, Android and web export.
- `npm run security:scan`: **491** source/config/bundle files and both decoded
  Hermes bundles; no privileged credentials/server implementation in app exports.
- `node --check` on updated inbox/avatar/bootstrap integration scripts and
  `git diff --check`: pass.

The initial full test run exposed three outdated RPC fixtures, which were updated
without weakening their privacy assertions. A subsequent concurrent test/export run
hit a Node segmentation fault; rerunning the unchanged full check after export passed.
Offline Doctor/npm-tool access initially failed due to sandbox networking; the
requested public-metadata/tooling checks subsequently passed with network access.

### Approved local verification — 2026-09-28

The user's explicit local-only approval resolved the previous automatic-review gate.
The migration was the only pending local version and applied successfully with
`npx supabase migration up --local`.

- SQL/RLS: `npx supabase test db <mirror>/supabase/tests/` passed **1,132 assertions
  across 24 files**, including QA #28–31 ownership, existence/deletion, level and
  reversal, field-minimization, cutoff/retry and cross-user/anonymous denial checks.
- `npm run db:test:bootstrap` passed fresh disposable bootstrap and nonempty replay,
  including preserved photos, XP, read state and durable inbox receipts. Existing
  large-fixture query-plan regressions and disposable-schema lint also passed.
- The real `db:test:inbox` and `db:test:avatars` suites passed. They verify concurrent
  openings sharing one receipt, later and initially uncommitted events surviving old
  retries, recipient-only read state, pagination, canonical rating targets, controlled
  blocked-avatar signing, fixed 60-second lifetime, restrictions and explicit unblock.
- All **18** integration/replay commands passed, run sequentially:
  `db:test:bootstrap`, `db:test:inbox`, `db:test:avatars`, `db:test:integration`,
  `db:test:challenges`, `db:test:submissions`, `db:test:photo-audit`,
  `db:test:progress`, `db:test:vocabulary`, `db:test:discover`, `db:test:ratings`,
  `db:test:safety`, `db:test:social`, `db:test:explore`, `db:test:past-words`,
  `db:test:notifications`, `db:test:notification-sender`, `test:auth:integration`.
  This includes real server expiry, upload/deletion/cleanup, XP reconciliation,
  visibility/rating/block/moderation races, session isolation and the existing
  at-most-one remote provider attempt contract.
- `npx supabase db lint --local --level warning --fail-on warning` passed with an
  empty result set and no schema warnings/errors for the persistent local database.
- After the test correction below, `npm run check` again passed TypeScript, lint,
  formatting and **950 app tests / 79 suites**. Function check/lint and **24 function
  tests** were rerun successfully. Credential/bundle scan passed **491 files** plus
  both decoded Hermes bundles; `git diff --check` passed. The earlier Doctor, SDK
  and all-platform export results above remain applicable: this local follow-up
  changes no app, dependency, native configuration or runtime function code.

One outdated integration assertion required correction. The initial
`db:test:safety` run stopped at `scripts/test-safety-integration.mjs:213`: expected
keys were `[id, username]`, but the explicitly approved projection now returns
`[avatar_id, id, username]`. The assertion still requires that exact minimal key
set and now additionally requires a null avatar for the no-upload fixture. The
full safety suite was rerun and passed before the remaining suites proceeded.
No application, migration, RLS, Storage or Edge Function defect was reproduced,
and no implementation/security change was required. No tests were skipped.

The documented temporary Docker-shareable mirror used unchanged repository SQL,
function and shared source files with normal JWT verification. The temporary server
was stopped and the mirror removed after testing. Persistent local database, Auth
and Storage services remain running, with migration `20260927000000` recorded.
No hosted Supabase project was accessed or modified. Nothing was committed or pushed.

**Local automated verification clears QA #28–31 for controlled Langtify Dev rollout
and subsequent physical iPhone QA.** Hosted rollout and physical acceptance remain
unperformed. The QA pass must not be closed until the device checklist passes.

## Exact Dev rollout prerequisites and order — not performed

1. Local verification is complete. Review the diff and obtain separate hosted
   rollout approval before applying anything to Langtify Dev.
2. With separate future hosted approval, apply outstanding migrations in order:
   `20260926000000_discover_author_avatars.sql`,
   `20260926010000_owner_history_visibility.sql`,
   `20260926020000_author_avatar_references.sql`, then
   `20260927000000_qa28_31_profile_safety_inbox.sql` (skip only those already applied).
3. Deploy the updated **avatar-authority** with normal JWT verification. No new
   secrets/settings are required. If prior QA #20 has not been deployed, also deploy
   its already-documented **photo-authority** update before that client release.
4. Load the updated application JavaScript only after the projection migration and
   function are available; smoke-test recognition access and inbox admission using
   two Dev accounts before physical acceptance.

No native rebuild is required for this batch on the existing compatible SDK 57
development client. A standalone app needs its normal JS/binary release mechanism.
Personal Team builds with push disabled still support this inbox.

## Physical iPhone QA

1. Concept detail: no history action for uncaptured words; correct history after
   capture and removal after last deletion. Check Today/Past Words eligibility and
   immutable context, Search, cached return and account switching.
2. Public profile: balanced Level/Followers/Following, accurate server value and no
   XP/streak fields. Confirm blocked/restricted profiles remain unavailable.
3. Blocked accounts: uploaded avatar/initials, pagination, cached Back return,
   pull-to-refresh, empty/error states. Recognition never unblocks or shows posts,
   Level/counts/comments. Explicit Unblock updates list, feedback and eligible views.
4. Inbox: begin with several unread events; open and verify acknowledged badge/read
   state. Use a second account to generate an event after opening: it stays unread
   on explicit refresh and return from a child post. A new inbox visit clears it.
5. Interrupt/open offline/retry/background/refresh token; preserve the first admission
   on retry. Switch accounts mid-request; no old badge, profile, avatar or navigation.
6. Follower, rating and daily rows navigate to profile, canonical post and Today;
   check iOS edge-back, Android Back/direct-route fallback and preserved list position.
7. Review dark/light, large text, VoiceOver labels, small-screen safe areas and Reduce
   Motion. Confirm no manual mark-read controls or unnecessary confirmation dialogs.

Do not close this QA pass until physical iPhone acceptance passes. Local automated
verification is complete. Nothing has been committed, pushed or deployed.
