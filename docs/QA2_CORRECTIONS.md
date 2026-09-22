# Physical-device QA2 corrections

Scope: the six items in the follow-up iPhone QA brief. This is a correction pass,
not Phase 11. No commit, push, hosted migration, deployment or physical acceptance
was performed by this pass.

## Findings and corrections

1. **Edit Profile navigation:** saving triggered the full Auth reload, which briefly
   removed the protected ready route while a back action was queued. A normalized
   unchanged username now performs no write or account read. Changed saves await a
   deduplicated account refresh that preserves the ready route, then use one guarded
   back action or replace `/profile` for direct entry. Learning Settings used the
   same faulty ordering and now follows the same correction. Reads begun before a
   mutation cannot satisfy its post-save refresh; obsolete account replies are ignored.
2. **Own avatar interaction:** the Profile avatar is an accessible Edit Profile
   button with a subtle pencil indicator. It does not add another avatar workflow.
3. **Empty public profile:** only identity/follow data was loaded; there was no posts
   query. A bounded owner-scoped public RPC now supplies the existing photo/detail
   presentation, signing and ratings. It uses the viewer's saved target language,
   which the UI labels explicitly, and the existing public eligibility checks.
   Private/pending/deleting/deleted, blocked, restricted and removed content stays
   excluded. Own public posts display but cannot be self-rated. Detail returns to
   its public-profile origin without recursively opening that same profile.
4. **Visible refetches:** 30/60/300-second cache thresholds and 55-second photo
   renewal were acting as automatic request triggers. Loaded metadata now survives
   navigation regardless of age. Downloaded pixels are separately reused in bounded
   session memory; no expired signed capability is retained or reused. Related
   mutations, explicit refresh, cache misses and justified long-background recovery
   remain request triggers. Accepted rating receipts synchronize matching Discover
   and public-profile windows without rereading unrelated windows. Interrupted
   votes reconcile on return without replay; sibling receipts preserve pending
   pagination and do not erase another mutation's invalidation. Confirmed signing
   denials retire affected public caches; omitted posts disappear from sibling
   windows. Interrupted completed-photo downloads resume without an extra metadata
   read when the metadata already succeeded.
5. **Avatar clipping:** large initials inherited a smaller text line box. The
   circular fallback now centers a size-appropriate line box without font-padding
   clipping. Photos use cover sizing; failed images fall back and a replacement
   clears the previous image failure. Decorative initials do not enlarge independently
   of their circular mask when accessibility text size changes.
6. **Signup guidance:** the form displays the verified Dev minimum/character policy
   before submission and measures Auth's UTF-8 byte limits. No character composition
   requirement was invented and login validation remains permissive. See
   [PASSWORD_POLICY.md](PASSWORD_POLICY.md) for read-only evidence and the remaining
   hosted leaked-password setting confirmation.

## Refresh and invalidation policy

Freshness timestamps describe successful reads or explicit invalidation; elapsed
age alone never starts a loaded browsing query. Cache keys include Auth user/session
and applicable target, profile, filters and cursor. Normal JWT refresh can reuse
same-session data; account/session changes and sign-out retire all caches and queued
image work. Generations, AbortSignals and bounded read waits reject late responses.
Concurrent observers share reads. Only relevant resource tags are invalidated.

| Screen/resource                  | Revisit / rerender                                                         | Real refresh triggers                                                                                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Today                            | Reuses same observed calendar-day challenge.                               | Explicit refresh; challenge/submission/learning mutation; next local midnight or changed-day hint; long background. Server alone decides actual date and assignments. |
| Profile identity / progress      | Reuses identity, counts, XP and streak data.                               | Username/avatar, completion/deletion and learning changes; explicit refresh; long background for progress/public identity.                                            |
| Edit Profile / Learning Settings | Keeps local draft and loaded account/own-avatar metadata.                  | Explicit save; targeted pointer invalidation after avatar changes; post-save account read.                                                                            |
| Discover                         | Keeps up to 24 cards and keyset cursor; mounted tab retains scroll.        | Initial/cache-missing visit, explicit refresh, more pages, related mutation/safety change or long background. Receipt updates patch rating summaries.                 |
| Public profile                   | Keeps profile/follow state and bounded public-photo window.                | Changed profile/target, follow/profile/safety mutation, explicit photo refresh/more pages, long background. Same saved-target filter as Discover.                     |
| Post detail                      | Uses source window's photo/item/rating; close leaves that window in place. | Source mutation or eligibility loss; explicit retry. Comments have their own bounded query.                                                                           |
| Vocabulary / concept captures    | Keeps selected 12-item page, filter and cursor.                            | Changed filter/page, explicit refresh, submission mutation, long background or missing pixels.                                                                        |
| Owner photo                      | Completed revisits reuse assignment/pixels.                                | Explicit refresh; mutation; pending/deleting entry/resume still performs authoritative interrupted-operation recovery.                                                |
| Unfinished photos                | Reuses loaded recovery list.                                               | Submission lifecycle, explicit refresh and long background. Opening an unfinished assignment performs recovery.                                                       |
| Username search                  | Reuses exact normalized-prefix page keys.                                  | Changed input after 300-ms debounce; more pages; relevant profile/follow/safety invalidation; long background.                                                        |
| Comments                         | Reuses up to 12 pages of 20 comments.                                      | Explicit refresh/page change, create/delete/report/block/moderation and long background. Creation returns to newest. No comment polling.                              |
| Avatar / photo bytes             | Reuses downloaded JPEG pixels.                                             | Missing/evicted pixels or relevant invalidation requires fresh controlled signing. No expiry timer or periodic download.                                              |
| Notification settings            | Existing authoritative entry/resume read remains.                          | Preference mutation and permission/registration lifecycle recovery; no periodic preferences polling.                                                                  |
| Blocked users / safety           | Entry/resume reads remain for current safety authority.                    | Block/unblock and moderation writes. These are security screens, not a browsing freshness policy.                                                                     |
| Moderator queue / inspection     | Privileged state retains existing revocation behavior.                     | Current access rechecked every 45 active seconds; explicit queue navigation/actions and fixed-expiry inspection access. No cache can confer moderator authority.      |

“Long background” means at least five minutes in actual AppState `background`,
measured monotonically. Elapsed foreground time, tab focus, a native sheet's
`inactive` transition and short background intervals do not qualify. On long return,
relevant data and pixels are discarded; visible observers reread, hidden ones wait
until their next active access. There is no new polling or realtime transport.

## Media limits and security

The server's 60-second signing policy, URL/path validation and bucket privacy are
unchanged. The client captures time before signing and starts an image download
only within 55 monotonic seconds. Downloads use `cache: no-store`; only validated
JPEG data URIs enter a session-only memory cache. The URL is not persisted in cache,
Router, disk or shared text. A full-body 20-second budget, three concurrent downloads,
MIME checks and an independent five-MiB bound prevent stalled/unbounded body reads.
Server-side trusted verification remains the image authority.

The shared image cache is limited to 48 entries / approximately 32 MiB of encoded
string memory after in-flight readers settle. Visible bounded windows retain their
current pixels too; transient decode/base64/native image allocations are additional.
There is no promise of a 32-MiB total process ceiling. Evicted images may need fresh
access when revisited. Downloaded pixels can outlive their signed URL; they grant no
new Storage requests. Known denial/safety mutations discard affected cached state.
Remote changes cannot recall already downloaded pixels and become observable on
an actual eligibility read. Two-device immediate revocation is not claimed.

## Database and hosted rollout

The only migration added by QA2 is:

`supabase/migrations/20260922000000_public_profile_submissions.sql`

It adds a partial public-owner/newest index and authenticated read-only
`get_public_profile_submissions`; no table backfill, raw RLS widening or submission,
XP, rating, notification or cleanup authority changes. The new test is included in
normal SQL discovery and explicit bootstrap replay. Nonempty replay checks preserve
existing records and XP history.

When hosted Dev deployment is separately authorized, apply in timestamp order:

1. `20260921000000_product_social.sql` (earlier product/UX pass).
2. `20260921010000_profile_avatars.sql` (earlier product/UX pass).
3. `20260922000000_public_profile_submissions.sql` (this QA2 pass).

Deploy the prior pass's `avatar-authority` and updated avatar-inclusive cleanup job
if not already installed. QA2 adds no Edge Function and requires no new hosted
secret. Existing `photo-authority` feed signing is reused. Roll forward with a new
migration if a rollback is needed; do not delete migration history or production
objects. No hosted changes were made here.

## Physical iPhone acceptance

- Save an unchanged username from Profile: one predictable return, no GO_BACK
  warning; then change username and repeat. Open `/edit-profile` directly and save.
  Quickly double-tap Save and navigate during a slow response.
- Tap the own avatar and confirm Edit Profile. Check initials/no name/unavailable
  photo and a real/replaced avatar at small/large sizes, large text and VoiceOver.
- View own/another learner's public profile in the shown language. Open a photo,
  return, load more, rate another user's photo and verify Discover synchronization.
  Confirm private/deleted/blocked/removed content and self-rating remain unavailable.
- Browse two Discover pages, open/close detail and switch tabs after 1, 5 and 20
  foreground minutes. Confirm stable photos/cursor/scroll without unsolicited
  loading. Do the same for Vocabulary, Profile and comments. Pull to refresh once
  and confirm one intended reconciliation.
- Background briefly versus at least five minutes. Open a native sheet without
  backgrounding. Verify only the justified long return reconciles browsing data.
  Interrupt an upload/delete and confirm recovery still runs.
- Rate during a slow response, leave and return; confirm authoritative reconciliation
  without a second vote. Switch accounts during loading/upload/signing and confirm
  there are no previous-account photos, ratings, profile drafts or comments.
- Signup shows guidance before submission; check too short, valid plain lowercase,
  Unicode and too-long input. Confirm the Dashboard leaked-password setting and
  existing password/Google sign-in separately on Dev.

Native image decode, iOS typography, scroll continuity, keyboard and the real
Supabase hosted password setting cannot be established by Jest or bundle export.
Automated validation results are recorded with the handoff; device QA remains open.

## Automated verification — 2026-09-21

- `npm run check`: TypeScript, ESLint with zero warnings, Prettier and **474 app
  tests across 53 suites passed**. Coverage includes real protected Router save
  navigation, cached request counts, account switching, rating interruption,
  media cancellation/expiry and password guidance.
- Local `supabase migration up`, `supabase test db`: **828 assertions / 20 files**
  passed, including 28 new public-profile projection assertions.
- Sequential integration scripts passed: `test:auth:integration`,
  `db:test:integration`, `db:test:challenges`, `db:test:submissions`,
  `db:test:photo-audit`, `db:test:progress`, `db:test:vocabulary`, `db:test:discover`,
  `db:test:ratings`, `db:test:safety`, `db:test:social`, `db:test:avatars`,
  `db:test:notifications`, `db:test:notification-sender`, `db:test:bootstrap`.
  These exercise real local Auth/Storage, signing, privacy, concurrency, cleanup,
  password-byte boundaries and nonempty migration replay.
- `supabase db lint --local --level warning --fail-on warning`: no schema errors.
- `npm run functions:check`, `functions:lint`, `functions:test`: pass; **23 Deno
  tests** across photo authority, notification scheduler and avatar authority.
- `npm run doctor`: **21/21**; `npx expo install --check`: dependencies up to date.
  Public Expo config retains Langtify name/scheme and `com.langtify.app` on both
  native platforms. Existing Personal Team/default-push config tests pass.
- `npm run export:check`: iOS, Android and web exports passed after final client
  fixes. `npm run security:scan` passed including **both decoded Hermes bundles**.
- `npm audit --audit-level=high`: exits successfully; **14 known moderate findings**
  remain. No dependency upgrade or force fix was performed for QA2.
- `git diff --check`: passed.

Docker tests used the documented `/private/tmp/langtify-ci-supabase` mirror because
Docker cannot share `/Applications`. Local migrations were applied without resetting
persistent development data. The verification-only Edge Function server was stopped;
existing Supabase containers and the user's Metro server were preserved. A failed
initial app run exposed an outdated vocabulary-service transport fixture; the fixture
now exercises the image download and asserts local pixels rather than a signed URL.
An existing FlatList batching warning in the image recovery test was corrected by
controlling its timer within React `act`, without suppressing console output or
altering production behavior.
The final full run also emitted asynchronous React `act` warnings from the existing
`notification-provider.test.tsx` suite; its assertions passed. Those warnings were
not suppressed and no unrelated notification behavior was changed.
