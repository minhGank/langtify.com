# QA2 — connection lists and in-app inbox

Implementation and automated verification are local. **Physical iPhone acceptance
is pending; this scope is not complete.** No commit, push, hosted migration or
function deployment is authorized by this pass. Phase 11 remains unstarted.

## A. Followers and Following

Own and public-profile counts now open a native list route. Followers are people
following that profile; Following are people it follows. Rows show avatar, username,
current relationship and a Follow/Following action, with no self-follow action.
Tapping a row opens its public profile. Back navigation preserves the loaded list;
direct route entry has a Profile fallback. Loading, unavailable, empty and error
states have explicit feedback. Pull-to-refresh and pagination are available.

The RPC returns the profile/counts and at most 20 rows per normal client request
(server maximum 24). Descending relationship timestamp and immutable public profile
ID form an exact keyset. Each loaded window retains at most 40 rows; paging farther
keeps the last 40 encountered rows while continuing toward older relationships. Back to latest/pull refresh returns
to the newest window. The cache holds at most 12 list keys partitioned by viewer
Auth session, profile and direction. Mounted FlatList navigation retains scroll.

Only server receipts patch relationship state/counts. A successful follow response
contains the affected profile, viewer profile and authoritative relationship time.
Related profile and list caches update immediately; unrelated windows are untouched.
Uncertain/aborted writes require an authoritative read, never automatic follow replay.
This applies to both list rows and existing public-profile actions.

The query excludes any participant blocked/restricted relative to either the viewer
or the profile owner. Counts and lists use matching visibility. Profiles expose
opaque public IDs, usernames and current avatar IDs, not Auth IDs, email or learning
settings. Raw follow-table grants and existing write admission remain unchanged.

One list request supplies row data; there is no per-row profile fetch. Missing avatar
IDs are deduplicated and signed in batches of at most 24 using existing avatar
control. Downloaded pixels reuse the shared session cache. There is no signing timer,
raw Storage read, longer TTL or per-row ProfileAvatar request. Failures use initials;
explicit refresh retries. Privacy/account invalidations clear affected media.

## B. In-app Notification Center

A bell with unread badge appears in the title row of all four primary tabs. It opens
an authenticated inbox with timestamps, unread styling, read/unread actions, mark all
read, pagination, pull-to-refresh and loading/error/empty states. It works without
native notification permission or push support, including
`LANGTIFY_DISABLE_IOS_PUSH=1`. The existing Profile notification-settings entry remains
separate and is labelled accordingly.

| Event             | Authoritative source / deduplication                                                                                                                                               | Presentation and destination                                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| New follower      | New persisted follow; one durable event per recipient/follower pair. Retries/refollows do not create another event or reset read state.                                            | Username and public-profile destination. Hidden while the relationship is absent or ineligible.                                                |
| New rating        | Initial persisted rating; one event per rater/submission pair. Rating edits and retries remain silent.                                                                             | “Someone rated your photo” plus assigned word; no individual rater identity or score. Opens the recipient's existing owned photo/detail route. |
| Daily words ready | Newly created challenge commits with three active authoritative assignments; one event per challenge. Existing current-day challenges are recovered idempotently on an inbox read. | Daily-ready message opens Today, which resolves the current challenge server-side. Replacements/retries do not create another event.           |

The chosen deduplication rule prefers one notification for a relationship/rating
source over repeated alerts from follow cycles or rating edits. It was presented
as the recommended default during implementation. There is no historical social
backfill and no client endpoint for creating notifications. Existing current-day
challenge recovery uses database time and the saved IANA timezone; it does not
create challenges merely because the inbox is opened, require a registered push
token, or backfill old daily challenges.

Notifications retain their original creation time/read state when temporarily hidden
content becomes eligible again. Blocking, account restriction/ban/deletion, private,
deleting/deleted or moderated submissions filter reads, unread counts and targets.
Restricted users retain eligible private daily-learning notices but not social ones.
Hard account/content deletion cascades corresponding records. No XP, streak,
completion, feed ordering or remote notification attempt is modified.

Rating recipients receive no rater UUID, username, individual score or rating history.
No inbox row contains a Storage path, signed image URL, token or caller-defined route.
Opening an item revalidates its target and marks it read through recipient-bound RPCs;
only fixed public-profile, owned-photo and Today routes are allowed. Existing route
onboarding/owner checks remain in force. A changed or unavailable target fails closed.

Mark all read uses the latest server timestamp/UUID cursor captured by the displayed
inbox snapshot. Events newer than that cursor remain unread. Concurrent requests are
idempotent and update only currently eligible owner records. Read/unread changes are
independent of source creation; immutable event/source fields cannot be rewritten.

## C. Migration and RPCs

New migration:

`20260922010000_follow_lists_inbox.sql`

It adds directional follow-page indexes, private-by-grants/RLS-enabled
`public.in_app_notifications`, owner page/unread/source/foreign-key indexes,
immutable-source validation and source triggers. Recipient foreign keys reference
profiles to preserve the existing challenge/Auth deletion lock order; follow/rating
admission retains ordered Auth/safety locks. No ordinary role can read/write raw inbox
rows or execute private helpers. Security-definer functions use an empty search path
and explicit grants. No service-role capability enters the app.

Public RPCs:

- `get_profile_connections`: bounded public relationship projection.
- `set_follow`: existing authority with additive confirmed profile/count receipts.
- `get_notification_summary`: eligible unread count and latest read cursor.
- `get_notification_inbox`: recipient-only bounded newest-first projection.
- `set_notification_read`: mark one eligible owned event read or unread.
- `mark_notifications_read`: mark eligible owned rows through the response cursor.
- `resolve_notification_target`: current eligibility and fixed destination data.

The additive migration supports empty bootstrap and nonempty replay without resetting
source keys, read state, XP or remote send history. Existing profile, follow, rating,
submission and Storage RLS are preserved. Directional follow and owner inbox indexes
were checked under generic plans among 25,000 unrelated records. No avatar-authority
or photo-authority endpoint changes are needed.

Exact visible counts still inspect the relevant owner's relationships/unread events.
The indexes avoid scanning unrelated owners, but very large individual accounts
will need hosted load measurements. There is no retention/pruning policy in this pass.

## D. Cache and refresh

Loaded list/inbox/badge data survives ordinary navigation and elapsed time. No polling,
periodic signing, stale-time-only refetch or realtime transport is added. Data changes
from other devices appear on initial read, explicit refresh or the existing justified
resume after at least five minutes of actual background time. Merely leaving the app
open, switching tabs or showing a native inactive sheet does not refetch.

The inbox retains at most 60 items per window and two session keys; summary data uses
the same session scope and is shared by bells, with concurrent reads deduplicated.
Pagination remains bounded; explicit refresh returns to newest. Read-state receipts
patch the list and badge. Known safety/content changes discard relevant connections,
inbox and public caches. Newly observed authoritative daily challenge IDs invalidate
the inbox once, so a badge read preceding challenge creation reconciles after commit;
repeat loads/replacements do not repeatedly refresh it.

Blur/timeout/account changes fence pending callbacks. Uncertain writes reconcile via
reads without replay. Logout/account-session replacement clears cached data and queued
media. Partial receipt patches preserve outstanding invalidation obligations. Signed
URLs keep their 60-second server lifetime and 55-second monotonic download-admission
budget; only bounded session-memory pixels survive expiry. See QA2_CORRECTIONS.md.

## E. Remote push boundary

**Social notifications are in-app only.** The Expo/APNs/FCM sender, device-token
lifecycle, preferences, scheduler and at-most-one-attempt contract remain unchanged.
Remote types remain exactly `DAILY_WORDS` and `STREAK_AT_RISK`. In-app daily-ready
history is neither a provider attempt nor evidence of end-device delivery. There
are no comment notifications, likes, mentions, grouping algorithms or chat features.

## F. Verification

Run `npm run check`, the local database/RLS suites and existing sequential integration
regressions. New `npm run db:test:inbox` tests real local Auth, follow/list/inbox RPCs,
Storage-backed public rating events, privacy, read-state races and account erasure.
CI includes this script and discovers the new SQL test automatically. Bootstrap adds
nonempty event/read-state replay and query-plan checks. The final handoff records
actual counts/results; tests and exports do not constitute physical acceptance.

Local verification on 2026-09-22:

| Check                                                        | Result                                                                                                                                                                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run check`                                              | TypeScript, zero-warning ESLint, Prettier and **526 tests in 56 suites passed**.                                                                                                                             |
| Local migration application and `supabase test db`           | **897 SQL/RLS assertions in 21 files passed**, including 69 new assertions. Docker uses the documented `/private/tmp` mirror; no persistent database reset.                                                  |
| Sequential Auth/database integration and bootstrap scripts   | **All 16 passed**: Auth sessions, onboarding, challenges, submissions, photo audit, progress, vocabulary, Discover, ratings, safety, social, inbox, avatars, remote notifications, sender, bootstrap/replay. |
| `supabase db lint --local --level warning --fail-on warning` | No schema errors/warnings.                                                                                                                                                                                   |
| `functions:check`, `functions:lint`, `functions:test`        | All pass; **23 Deno tests** across photo authority, notification scheduler and avatar authority.                                                                                                             |
| `npm run doctor`, `npx expo install --check`                 | **21/21** Doctor checks; SDK dependencies compatible.                                                                                                                                                        |
| Public Expo config / existing entitlement regression         | Both modes retain Langtify identity. Default push remains enabled; Personal Team removes only iOS push entitlement and disables native registration.                                                         |
| `npm run export:check`                                       | iOS, Android and web pass with nonfunctional public CI fixtures.                                                                                                                                             |
| `npm run security:scan`                                      | Source/config and both decoded native Hermes exports pass; no privileged credentials or server implementation in bundles.                                                                                    |
| CI setup regression, dependency audit, diff check            | **4 CI setup tests passed**; no high/critical audit findings, 14 existing moderates remain; `git diff --check` passed. No dependency changes or audit fixes in this scope.                                   |

Review also fixed lost follow acknowledgements leaving cached counts stale, public
profile blur popping onward navigation, and Back to latest retaining an old inbox
scroll offset. Regression tests cover each. Device layout, gesture behavior and
hosted Dev acceptance have not been claimed from these automated results.

## G. Dev deployment order — only after separate authorization

1. Apply any unapplied prior product/UX migrations, in order:
   `20260921000000_product_social.sql`, `20260921010000_profile_avatars.sql`, then
   `20260922000000_public_profile_submissions.sql`.
2. Apply `20260922010000_follow_lists_inbox.sql`. Verify grants, event generation and
   counts with Dev test accounts before rolling out the matching client.
3. If the prior avatar pass has not been deployed, install its `avatar-authority` and
   updated avatar-inclusive hourly cleanup job. This pass adds no Edge Function,
   provider credential, secret, cron job or push type. Preserve deployed remote sender
   and photo authority.
4. Run the existing development client with this JavaScript update; rebuild only if
   earlier native dependency changes are not yet included. Personal Team builds keep
   `LANGTIFY_DISABLE_IOS_PUSH=1`. No new native dependency or capability is introduced.
5. Perform the physical checklist below. Record acceptance before closing QA2.

Use a corrective additive migration for rollback; do not delete applied migration
history or reset production data. All work and verification here remain local.

## H. Physical iPhone checklist — pending

- Open Followers/Following from own and another profile. Check avatars, counts,
  self rows, empty lists, long usernames, large text, dark mode and VoiceOver.
- Follow/unfollow from a list and public profile; confirm immediate button/count/list
  updates. Open a row and go back, including direct/deep-linked entry. Keep page and
  scroll position without a reload after several foreground minutes.
- Page beyond two connection pages and three inbox pages; verify bounded continuation,
  no duplicates, Back to latest, and explicit pull-to-refresh.
- Use a second Dev account to follow and rate a public photo. Refresh the recipient's
  inbox: see one follower notice and an anonymous rating notice. Edit the rating and
  refollow: no new event or read-state reset. Self actions must not notify.
- Verify the bell and inbox work in the Personal Team build with push disabled. New
  daily challenge readiness appears once without push registration; replacement does
  not create another notice. Tap daily -> Today, follower -> profile, rating -> own
  photo/detail; back returns predictably.
- Toggle read/unread and mark all read. Badge follows confirmed state. Have the second
  account create a newer event after the current snapshot; it must remain unread.
- Block either direction, restrict an account and remove/private/delete a related
  photo. After authoritative refresh, rows/counts/notifications disappear and stale
  targets cannot open. Restore/unblock to check original timestamps/read state.
- Interrupt follow/read requests, background briefly, then return. Check read-based
  recovery without a second mutation. Background for at least five minutes and verify
  intentional revalidation; native sheets and short background do not trigger polling.
- Switch accounts during list, avatar or inbox requests. Confirm no previous user's
  badge, relationships, notification text or navigation appears. Sign out and verify
  direct routes still require authentication and onboarding.
