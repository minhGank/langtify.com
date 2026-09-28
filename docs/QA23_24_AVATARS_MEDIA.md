# QA #23 and #24 — Avatar consistency and media loading

Only avatar reconciliation, existing author-avatar presentation, media loading and
post overflow consistency. No Phase 11, unrelated feature, progression/write-rule
change, dependency or native configuration change. Prior uncommitted work is preserved.
No commit, push or deployment. Physical iPhone acceptance remains pending.

## Findings and avatar reconciliation

The avatar editor previously invalidated only avatars/public-profile/search caches.
Discover, comments and connection metadata could retain the old avatar ID or null.
Profile and lists also kept separate signing-result caches. Comments always rendered
initials, and follower inbox rows had no avatar reference in their projection.

`ownAvatarEntry` is now the one current-avatar pointer per authenticated session.
The editor and all self-avatar rows share it through `useAvatarRows`. A confirmed
save/removal publishes the server receipt, cancels an older pointer read, forgets
replaced pixels and invalidates only affected avatar-access batches. It does not
refresh whole feeds, reset pagination or remount screens. Cached projection fields
cannot overwrite this pointer. Self identity uses the existing server-owned flags
(`isSelf`, `isOwn`, or the feed's owner-only `canRate: false`), never username matching.

Only the exact JPEG bytes uploaded by this operation can seed its matching finalized
avatar ID. If a retry discovers an already-current upload or a different current ID,
normal controlled signing supplies pixels instead. Uncertain writes retain the
existing request ID and reconcile the pointer without replaying a new intent.

Profile, Edit profile, Discover, public/private owner post detail, comments, People
search, followers/following and public profiles now use the same pointer resolver
and bounded batch/pixel cache. NEW_FOLLOWER inbox rows use that same batch access;
NEW_RATING remains anonymous and daily-word rows retain their contextual icon.
There are no avatars in the other safety/moderation rows to synchronize.

Signing stays through `avatar-authority`, in distinct missing-ID batches of at most 24. No per-row profile reads, public bucket, caller path or caller-selected TTL.
Signed URLs keep their original 60-second lifetime; only bounded in-memory decoded
JPEG data survives navigation. Missing/denied/failed avatars retain initials.
Account/session changes and safety invalidation retain their existing clearing and
abort behavior. No elapsed-time polling is added. Another device/user's later edits
appear on existing explicit refresh/revalidation, not a new realtime subscription.

## Minimal database read extension

Migration: **`20260926020000_author_avatar_references.sql`**.

- `get_submission_comments`: nullable `avatar_id`, resolved for the already eligible,
  bounded 20-row page. Internal author Auth UUID is stripped from the returned JSON.
- `get_notification_inbox`: nullable `avatar_id` only for NEW_FOLLOWER, after existing
  owner/eligibility filtering and bounded pagination (default 20, maximum 24).
  Rating/daily events never gain an author avatar.

Both reuse `private.current_avatar_id`, including current status and verified object
version, with the existing unique current-avatar index. Existing Auth, grants, block,
restriction/moderation, deletion, cursor, event generation and read-state authority
are unchanged. No new table, index, RLS policy, Storage grant or Edge Function.
Older payloads without the field still parse to initials during staged rollout.

## Loading and post actions

Vocabulary image frames now reserve their actual square or 4:3 detail geometry.
A quiet neutral image placeholder remains until native Image loading succeeds,
including the signing/download interval. Retry appears only after a real media/read
failure. Existing downloaded pixels are supplied immediately; no extra timer or
per-image spinner is added. Static shapes need no Reduce Motion exception.

Post access and uncached detail reads use a full-width square-photo skeleton with
word/author shapes. The native header/back gesture is available throughout. Normal
owner loading no longer displays Try again. An authoritative absent/deleted post
shows unavailable; an actual failed read offers retry.

Loaded post context remains visible during refresh, with a small refreshing label.
A failed refresh retains usable session-cached pixels and shows a compact recovery
message. Owner reads distinguish transport/server availability failures from Auth,
identity and lifecycle errors: only the former may retain verified completed pixels.
Public eligibility/settings failures still clear content and interactions. Cached
content is never a substitute for authorization or a reason to reuse expired URLs.

Owner public/private post overflow now uses the same plain IconButton as other-user
posts: 24-point icon, 48-point target, circular shape, transparent resting surface,
shared pressed state and accessible action label. Ownership-specific privacy/delete
and public share/report/block menu contents are unchanged.

## Verification

Passed locally:

- `npx supabase migration up --local`: only the new read migration applied.
- `npm run check`: strict TypeScript, ESLint, formatting and **879 application
  tests across 76 suites**. Includes every self-avatar surface, first upload,
  replacement/removal, cached navigation, old pointer responses, session isolation,
  inbox anonymity, trusted-pixel version matching, controlled expiry, stable media
  frames, initial/refresh/error post states and owner/non-owner overflow parity.
- `npx supabase test db <mirror>/supabase/tests/`: **1,096 assertions / 23 files**.
- All **18** local integration commands, run sequentially: `db:test:integration`,
  `db:test:challenges`, `db:test:submissions`, `db:test:bootstrap`,
  `db:test:photo-audit`, `db:test:progress`, `db:test:vocabulary`, `db:test:discover`,
  `db:test:ratings`, `db:test:safety`, `db:test:notifications`,
  `db:test:notification-sender`, `db:test:social`, `db:test:avatars`, `db:test:inbox`,
  `db:test:explore`, `db:test:past-words` and `test:auth:integration`.
  Avatar integration now checks actual comment/inbox references across replacement,
  removal, blocking and restriction, with no Auth-ID leak. Its new parent photo is
  removed through the existing cleanup worker after fixture Auth deletion.
- `npx supabase db lint --local --level warning --fail-on warning`: no schema issues.
- `npm run functions:check`, `functions:lint`, `functions:test`: pass, **23 tests**.
- `EXPO_NO_DOTENV=1 npm run doctor`: **21/21**. SDK compatibility via
  `EXPO_NO_DOTENV=1 npx expo install --check`: dependencies up to date.
- `npm run export:check -- --clear`, dotenv disabled with public local fixtures:
  iOS, Android and web exports pass.
- `npm run security:scan`: source/config/web plus decoded native Hermes bundles pass.
- `git diff --check`: passes.

The existing owner history planner fixture initially required one exact index name. PostgreSQL selected
`submissions_owner` with an owner-ID index condition, visibility filtering and only
three owner rows among 25,000 unrelated rows. The assertion now accepts either
existing suitable owner index; owner/index, filter and no-table-scan checks remain.
This correction changes no database or query authority. Navigation regression
coverage also caught an eager cache lookup with no cached rows/configuration; the
lookup now runs only for existing rows. No tests were skipped and authority checks
were preserved. Existing missing `past-words` navigation-fixture warnings and Node
module-type notices remain; the real route is present.

Tests used the approved temporary Docker-shareable source/test mirror with normal
JWT verification, then removed it. Persistent local Supabase services remain running.
No hosted project was touched.

## Dev rollout — not performed

Apply pending migrations in filename order, including this batch's
`20260926020000_author_avatar_references.sql`, then load the updated JavaScript.
The prior QA #20 Discover avatar migration and matching photo-authority deployment
remain separate prerequisites if not deployed yet; see `QA20_DISCOVER_AVATARS.md`.
This batch adds no Edge Function deployment, hosted secret or native rebuild.
Reload the existing compatible development client after Dev migration deployment.

## Physical iPhone acceptance

1. Upload a first profile photo, replace it, then remove it. Check Profile, Discover,
   owner public/private post, your comments, People search, connections and public
   profile without restarting. Revisit cached screens and verify no old initials/photo.
2. With a second test account, check follower inbox and comment avatars. Refresh
   after the author replaces/removes a photo. Rating events must remain anonymous.
3. Block/restrict an author: profile/comments/inbox/feed and avatar signing continue
   to exclude them. Private owner learning remains intact.
4. Switch accounts, background or navigate away while choosing/saving/signing.
   Late results must not change the new account. Retry a lost acknowledgement;
   confirm current avatar and no duplicate upload intent.
5. Use a slow connection for Vocabulary grid/detail. Check stable photo frames,
   placeholders until image arrival, no early retry, and cached navigation without
   another image request. Simulate a real failure and retry explicitly.
6. Open an uncached post, then reopen a cached one. Verify immediate native Back,
   initial skeleton, unobtrusive refresh, preserved cached content after a network
   failure, and unavailable state after actual privacy/deletion denial.
7. Compare owner public/private and other-user overflow triggers and their different
   menu contents. Check iOS edge-back, keyboard, safe areas, light/dark, VoiceOver,
   large text and Reduce Motion.

Automated results do not replace physical review; this QA batch is not closed.
