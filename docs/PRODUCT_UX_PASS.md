# Profile, social interactions and mobile server state

This pass is explicitly authorized by the physical-device QA brief, separately from
unrelated Phase 11 work. **Physical iPhone acceptance is still required.** Local
implementation does not commit, push, apply hosted migrations or deploy functions.

## Product and UI

- Profile separates public identity, private learning preferences and account
  settings. Username edits preserve existing syntax and case-insensitive uniqueness.
  Learning changes use existing supported semantics: saved challenges retain their
  snapshots; new challenges use saved preferences. Timezone changes do not rewrite
  historical completion dates.
- This pass added gallery selection for avatars; the later explicitly authorized
  [current-day library addition](CURRENT_DAY_LIBRARY.md) extends it to today's words.
  Preview the centered square before saving. Client normalization caps dimensions
  at 512 pixels, re-encodes JPEG and strips metadata. Independent server byte
  verification is required. Initials cover absent/unavailable avatars. Replacement
  keeps the previous current image until successful activation.
- Find learners uses a literal, normalized username prefix of at least two
  characters, with 20 results per page. Public profiles expose username, an opaque
  public ID, current avatar and visible follow counts, never email, Auth owner UUID,
  private settings or XP. Search lists use initials, avoiding per-result signing.
- Follow/unfollow is explicit and server-authoritative; self-follow is prohibited.
  Counts include only relationships visible to both viewer and profile owner.
  Edges are retained but hidden while a mutual block or restriction applies;
  unblocking/restoration restores eligible visibility. The subsequent QA2 scope adds paginated connection lists and in-app follow notifications; no suggestions, follow requests or remote social notifications are added.
- Feed: photo → vocabulary/language → author → quick rating. Rate photo expands the
  existing semantic choices inline; content taps open detail. Both share one
  authoritative vote state, without a second endpoint, aggregate or reward rule.
- Detail: photo → vocabulary → author/profile → rating → comments → Share/safety.
  Comments are flat, text-only, newest first and limited to 500 characters after
  trimming. Pages contain at most 20 using timestamp/UUID keysets. Older comments
  replaces the page; Back to newest resets it. Authors delete; others report or
  block; moderators remove. No replies, edits, likes, mentions or notifications.
- Share uses native OS text sharing with vocabulary, username and
  `https://langtify.com`. It does not share signed photo URLs, private identifiers,
  unsupported post deep links or an unauthenticated web-post system.
- Replace uses a refresh icon, accessible label “Replace”, contextual accessibility
  hint and existing loading/disabled behavior. Replacement rules are unchanged.

## Database and privacy

`20260921000000_product_social.sql` adds immutable `profiles.public_id`, a C-collation
prefix index, `user_follows`, `submission_comments` and controlled RPCs. Raw social
tables have RLS and no ordinary read/write grants. Auth-derived actors and ordered
safety revisions serialize writes with blocks/restrictions. Comment writes also
lock the submission against visibility/deletion. The original Discover projection
is unchanged: author lookup resolves eligible submission context only on tap.

Follow pairs are unique with a self-follow CHECK. Comment request UUIDs are unique
per author and tied to immutable text/post identity. Same-request retries acknowledge
the original row; deletion/removal cannot be undone by replay. Deletion retains a
tombstone. Comment reports extend private cases and immutable request-ID audits,
including a private text snapshot, but **never authorize moderator private-photo
signing**. Public projections exclude blocked/restricted/deleted/banned participants.
Counts use set-based indexed joins. Search/comments use indexed keysets; live pages
are not frozen snapshots, so renamed users/new comments can require refresh.

Admission locks Auth users in order before safety revisions and target rows;
moderation holds current membership after account admission. Concurrency tests
reproduce and prevent account-erasure lock inversions for avatars, follows,
comments, legacy blocks and moderation. Server checks reject Unicode-only whitespace
comments, preventing direct REST writes from poisoning a validated comment page.

`20260921010000_profile_avatars.sql` adds private `profile-avatars` Storage and
server-owned reservation/revision/current/retired/cleanup records. Reserve → immutable
owner upload → trusted decode/verify → activate. Uploads are JPEG only, at most 1 MiB
and 512 × 512 decoded pixels. Activation matches actual object ID/version. New
reservations fence old finalizations; retries reuse reservations. Compare-and-remove
cannot delete a newer avatar. Paths contain opaque avatar IDs. Clients cannot choose
arbitrary paths or TTLs. Only current verified images may be signed for the owner or
an eligible public viewer. Raw Storage read/update/delete remains denied. The existing
hourly Storage API cleanup command now also handles abandoned/retired avatars.

## Cache and refresh decisions

A small typed, bounded, memory-only cache fits the existing audited mutation and
expiry state machines without another state dependency. Entries are partitioned by
user + Auth session ID and applicable target/filter/cursor. Normal JWT refresh can
reuse metadata; account/session changes and sign-out retire it. No cache grants
backend authority or persists to disk. Concurrent observers share reads; the final
inactive observer cancels. Late obsolete replies cannot populate another context.

The QA2 correction pass separates freshness timestamps from automatic requests.
Cache age, rerenders and tab focus alone never trigger a loaded resource to refetch.
See [QA2_CORRECTIONS.md](QA2_CORRECTIONS.md) for the complete per-screen policy.

| Resource                           | Navigation / explicit refresh                                                                                        | Mutation / recovery                                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Discover and public-profile photos | Reuse up to 24 cards/cursor and downloaded pixels; refresh returns to newest.                                        | Relevant photo/profile/safety changes invalidate; rating receipts patch matching session windows.      |
| Post detail                        | Shares its source item/photo/rating; opening/closing does not reload the feed.                                       | Source eligibility and account/target changes close unavailable content.                               |
| Vocabulary                         | Reuse the selected 12-item page/filter/cursor regardless of elapsed minutes.                                         | Submission lifecycle and explicit refresh reconcile the current page.                                  |
| Today                              | Reuse the challenge within its observed local calendar day; next local midnight requests authoritative server state. | Replacement, submission and learning changes; date is only a refresh hint, never completion authority. |
| Progress / unfinished photos       | Reuse loaded metadata; explicit refresh where offered.                                                               | Submission lifecycle and learning changes.                                                             |
| Public profiles / follows / search | Reuse bounded session keys; changed search input debounces 300 ms.                                                   | Username/avatar/follow changes and safety invalidation.                                                |
| Comments                           | Reuse up to 12 cached 20-comment pages; explicit refresh, no polling.                                                | Create/delete and safety; creation returns to newest.                                                  |
| Owner photo                        | Completed revisits reuse assignment metadata/pixels; manual refresh available.                                       | Pending/deleting entry/resume still performs recovery; lifecycle invalidates.                          |
| Avatars                            | Reuse immutable-ID downloaded pixels; no renewal timer.                                                              | Replacement/removal/safety; a missing or evicted image requires fresh signing.                         |

Concurrent observers share reads; obsolete results cannot refill retired caches.
Known eligibility denials discard related session state without retry loops.
Confirmed safety writes discard affected caches before secondary reads. Uncertain
writes reconcile through authoritative reads and retain original idempotency keys.

The server still issues fixed 60-second photo URLs. They are used once to download
verified JPEG bytes, with a conservative 55-second monotonic admission deadline
measured before signing. No signed URL is stored in the image cache, Router or disk.
The shared session image cache holds at most 48 entries / approximately 32 MiB of
encoded string storage after downloads settle; visible bounded windows also retain
pixels. Downloads are globally limited to three, with a 20-second body deadline.
Already downloaded pixels may remain visible after the capability expires. Missing
pixels require fresh authorization; expired capabilities are never reused. Account
changes/sign-out clear all caches; inactive screens mask photos.

A real background interval of at least five minutes discards/revalidates relevant
media, public eligibility, challenge, progress and recovery data on return. Merely
remaining foregrounded for five minutes, changing tabs or showing a native sheet
does not. Remote changes appear on explicit refresh, justified resume, a relevant
mutation or fresh access after eviction; this is not realtime revocation.

Auth/native notification reconciliation remains. Notification preferences and safety
lists still read on entry/resume. Moderator authority intentionally rechecks every
45 active seconds for revocation, separately from queue/photo reads. These security
and recovery exceptions do not poll ordinary browsing screens.

## Hosted setup and iPhone acceptance

1. Apply the three migrations in the order documented in QA2_CORRECTIONS.md to intended Dev and deploy `avatar-authority`, preserving
   existing Edge functions/Auth/policies. Run the updated hourly trusted
   `npm run submissions:cleanup`, which includes avatars. No service key enters Expo.
2. Rebuild the native development client for `expo-image-picker`. Personal Team builds
   still use `LANGTIFY_DISABLE_IOS_PUSH=1`; default builds stay push-capable.
3. Test avatar select/cancel/preview/replace/remove, unavailable library, interrupted
   save/retry, username collisions and learning preferences on the physical iPhone.
4. Use two accounts for search, follow counts, author profiles and mutual block/unblock.
   Verify private profile fields never appear.
5. Rate inline, edit in detail, return and confirm the vote and scroll position.
   Verify owner cards cannot self-rate.
6. Test comment keyboard/small-screen scrolling, create/retry/delete/report/block,
   moderator removal and comment-case private-photo denial.
7. Share to another app and cancel. Verify vocabulary text and safe domain only.
   Check VoiceOver, large text, dark mode, native sheets and back navigation.
8. Revisit tabs quickly, background briefly and for at least five minutes, then switch
   accounts during pending work. Verify cached continuity, fresh authorization on cache misses and no
   cross-account photos, votes, comments or drafts.

Exports cannot establish native permission, keyboard, modal or share-sheet behavior.
Hosted operations and physical acceptance remain release requirements.

See [PRODUCT_UX_AUDIT.md](PRODUCT_UX_AUDIT.md) for the final focused security/cache
audit, regression fixes and exact hosted deployment order.

The remaining [QA2 connection lists and in-app inbox](QA2_CONNECTIONS_INBOX.md)
extend this pass under explicit user authorization. Physical acceptance remains open.
