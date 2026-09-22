# Langtify product decisions

The authorized [QA3 search and native navigation pass](QA3_SEARCH_NAVIGATION.md)
adds catalog Search/Explore and controlled public examples, a native post route,
compact semantic rating and profile/comment presentation corrections. Existing
privacy, signing, learning and remote-push authority remain unchanged. Physical
acceptance is pending; Phase 11 has not started.

The remaining [QA2 connection lists and in-app Notification Center](QA2_CONNECTIONS_INBOX.md)
add controlled follow projections and private, server-generated inbox events. Remote
push remains limited to DAILY_WORDS and STREAK_AT_RISK. Physical acceptance is pending.

Name: **Langtify**. Domain: `langtify.com`. Package and Expo slug: `langtify`.
Mobile-first Expo / React Native / strict TypeScript; iOS and Android are primary.

## Current scope: Phase 10 plus the authorized product/UX pass

The latest QA brief additionally authorizes profile/avatar editing, user search,
public profiles, follow/unfollow, flat comments, native sharing, inline ratings and
mobile caching. [PRODUCT_UX_PASS.md](PRODUCT_UX_PASS.md) defines this bounded scope
and supersedes historical exclusions below for these features only. Physical iPhone
acceptance remains pending; unrelated Phase 11 work is not authorized.

Supabase email/password authentication, persisted sessions, authoritative profiles,
and onboarding (username, reference language, target language, CEFR level, IANA
timezone). The four tabs remain Today, Discover, Vocabulary, and Profile. Profile shows authenticated account, learning information, progress and sign out. Today
shows real daily challenge cards, replacement and camera/photo completion; Vocabulary shows the personal visual dictionary; Discover shows eligible public vocabulary photos.

English and French are the initial active language catalog. English is available
as a reference language and French as a target language. Reference and target
must differ. V1 allows one learning profile per user. More languages can be added
to the catalog without schema changes.

## Vocabulary and daily challenges — implemented in Phase 3

- Supabase/PostgreSQL is authoritative for product-critical state.
- A daily challenge contains three photographable vocabulary words.
- Vocabulary levels are CEFR A1, A2, B1, B2, C1, C2.
- Slots are review (one level below), target (current level), stretch (one above).
- A1 boundary: A1 / A1 / A2. C2 boundary: C1 / C2 / C2.
- Users may replace assigned words; replacements preserve the slot's CEFR level.

Vocabulary uses shared semantic concepts, with one primary term per concept/language.
A meaning may have different CEFR levels in different languages. Ambiguous meanings
such as financial bank and river bank remain separate concepts. Translations follow
concept linkage; there is no manually duplicated translation table.

The server derives identity, learning configuration and local date from persisted
state and server time. Each learning profile has at most one challenge per local
calendar date, with three active slots. Eligible terms match the exact target
language and slot CEFR, are active, belong to an active photographable concept,
and have an active reference-language equivalent. Insufficient pools return an
error without substitutions at another level or partial challenge creation.

Selection excludes every concept already assigned in that challenge, including
replaced words. It prefers never-assigned concepts, then least recently assigned
concepts, randomizing ties. Repeat history is concept-based across the user's
challenges; no mastery score or spaced repetition is implemented.

Repeated replacements are allowed while eligible concepts remain. The server
chooses a different concept at the original slot level/language, preserving the
retired assignment. Old active IDs cannot be replaced twice. No replacement-count
limit was introduced. Challenges snapshot their configuration and displayed terms;
later settings/catalog changes never rewrite them. Same-profile/same-date calls
reuse the existing snapshot. A timezone change can change which local date is
requested, without editing prior challenges.

## Camera capture and submissions — implemented in Phase 4

A user opens a Today card, takes a camera photo or chooses an existing library photo
for a current-day word, reviews the normalized preview, chooses private/public
(default private), and explicitly submits. Camera remains primary; library selection
is secondary and does not enable historical/old-word uploads. Both sources earn the
same 10 XP per word, 10 XP full-challenge bonus and server-timed streak qualification.
See [current-day library acceptance](CURRENT_DAY_LIBRARY.md). One successful
submission completes the assignment and blocks replacement.
A pending upload must be finished or discarded before replacing its word. Owner-only
photo detail shows the saved vocabulary, translation, challenge date, submission
time and visibility. Owners may change visibility without moving files.

Deletion removes the image and retires the submission before freeing the word for
a new photo or replacement. Interrupted uploads/deletions are recoverable; a scheduled
maintenance job cleans abandoned uploads. Public now grants controlled Discover read eligibility (Phase 7 below); the bucket stays private. Owner photo management remains owner-only.

Unfinished photos on Today also lists owner-only pending/deleting operations from
earlier dates, so restart or midnight does not strand an uploaded photo. This
recovery read is independent of current challenge generation; it is not a gallery
or feed.

## Daily progress, streaks, XP and levels — Phase 5

Each valid completed assignment earns 10 XP. A daily challenge with all three
assignments complete earns an additional 10 XP: 1/3 = 10, 2/3 = 20, 3/3 = 40.
The full bonus belongs to that challenge, even if an interrupted photo finishes
on a later date. Pending uploads earn nothing. Visibility does not affect XP.

At least one valid word completion qualifies its completion's local calendar day.
The database uses server time and the learning profile's persisted IANA timezone
at finalization; the original challenge date and device clock do not select the
streak day. Multiple words on one date count once. Timezone changes never rewrite
saved completion dates. Consecutive distinct dates form a streak, including DST
days shorter or longer than 24 hours. Current streak counts through today, or
through yesterday if today has no completion; a fully missed day resets it to zero.
Longest streak is the longest surviving consecutive run.

Milestone XP per streak occurrence: 3 days = 10, 7 = 25, 14 = 40, 30 = 75,
60 = 125, 100 = 200. No daily multiplier. Candidates are created when a date first
qualifies and the run ending on that date first reaches the exact threshold.
Each candidate retains its original qualifying date window. A later new streak
can earn the thresholds again. Deletion never creates retrospective rewards for
split runs; restoring a previously qualified date cannot create new candidates.
Only one eligible reward of each threshold is credited per continuous run,
including if timezone changes subsequently join two runs.

Deleting a photo reverses its word XP, any lost full-challenge bonus and any
milestone whose original qualifying window breaks. Removing one of several words
on the same completion date retains that date's streak. Credit remains until
physical deletion and submission retirement finish; pending deletion is recoverable.
A resubmission earns credit for its actual new completion day and restores the
assignment's existing XP source, with signed reversals retained in history.
Repeated submit/delete/resubmit cannot increase net/lifetime XP beyond currently
valid sources. Historical deletion may reduce total XP, level, current/longest
streak, completed-word count and fully completed-challenge count.

Level starts at 0. Advancing from level L costs `100 + 50 × L` XP; the cumulative
threshold to enter L is `25 × L × (L + 3)`. Thresholds are 0, 100, 250, 450, 700,
1000, 1350… Therefore 620 XP is Level 3, with 170/250 XP toward Level 4 (700 total).
The exact formula takes precedence over illustrative examples. Total XP and level
come from the server's signed ledger; the client never awards either.

Today displays n/3, full-completion bonus, level, XP and current streak. Photo detail
shows server-confirmed XP feedback. Profile adds progress toward the next level,
longest streak and lifetime counts of currently valid words/full challenges.

## Future scope — not implemented

Likes, friends, DMs, remote social notifications, leaderboards, achievements and
subscriptions are not included. Comments, follows and the limited in-app inbox are
covered by the explicitly authorized product/UX and QA2 passes above. Phase 11 has
not started. Apple, Facebook, magic-link and other login providers remain out of scope.
Apple Sign-In is deferred until Apple Developer membership is available.

## Open questions

Production vocabulary sources/licensing and CEFR/photographability review,
submission retention and further edits, moderation, and release policies remain
undecided. Phase 8 rating labels, eligibility and aggregation are defined below. The modest vocabulary seed is
for development only, not a validated production learning catalog.

## Google authentication — Phase 5.5

Users may continue with Google through Supabase or keep using email/password.
Every method enters the same user/profile and onboarding flow. Google metadata
never replaces username, reference/target languages, CEFR or timezone requirements.
Existing identities linked by Supabase retain the same account data; the app does
not merge accounts or decide identity from an email address. Sign-out clears the
Langtify session and account state, without revoking or deleting the Google account.
No product, XP, challenge, submission or community rules change in this phase.

## Personal vocabulary history — Phase 6

My Vocabulary contains only the owner's successfully finalized photos across all
challenge dates, grouped by semantic concept UUID. Same spelling never merges
separate meanings. Repeated encounters, including different language pairs, share
one concept card; each capture retains its own historical target/reference text,
CEFR, submitted timestamp and current visibility. Cards and detail summaries show
the latest surviving capture, ordered by server submission time then submission UUID.
Catalog edits, deactivation and learning-settings changes never rewrite history.

Search is a case-insensitive literal substring of the latest card's target or
reference term. CEFR filters that same latest capture. Older text remains visible
in unfiltered concept detail. The unique-concept total ignores list search/filter;
it differs from Profile's completed-word count. There is no category filter,
mastery score, new completion flag or social discovery.

Concept detail retains all surviving captures, newest first, and opens existing
photo management for visibility/deletion. Pending, deleting and deleted photos
are absent from the dictionary: deletion intent hides a potentially unavailable
image immediately. Another surviving capture becomes the concept's latest image;
removing the last one removes its concept. This display behavior does not alter
Phase 5: XP credit remains until physical deletion and retirement finish.

Both lists use 12-item pages with Next page and Back to latest. Pull to refresh,
relevant mutations and justified long-background recovery reload backend state; navigation reuses cached pages. Other-device changes appear on the next actual read. Empty, no-match, deleted, failed and expired-image states
have recovery controls. Displayed timestamps use the device's locale for readability,
not for completion/streak authority. Dictionary and photo management remain owner-only; eligible public photos additionally appear in Discover below.

## Public Discover Feed — Phase 7

Authenticated, onboarded learners see completed public submissions in their saved
target language, including their own. The owner must still have an onboarded profile
and username and an Auth account that is neither deleted nor currently banned.
Deleting/deleted/pending submissions and missing or unverified image objects are
excluded. Each capture appears separately, even for a repeated concept. Cards show
the historical target term, reference translation, CEFR, current username and original
submitted timestamp. The reference translation belongs to the capture's original
language pair; it is not retranslated into the viewer's reference language.

Newest submission time comes first, with descending submission UUID breaking ties.
Publishing an older private photo does not change its timestamp. Pull to refresh
returns to newest; Load more advances through bounded pages. No ranking, user
profiles, recommendations or optional public XP/streak display are added.

Public visibility grants read eligibility only, never mutation rights or public
bucket access. Public → private removes future feed/signing eligibility; private →
public enables it. Deletion intent hides a photo immediately without changing the
existing completion/XP reconciliation rules. Read/sign operations concurrent with
visibility changes observe their database eligibility snapshot. Already issued
60-second signed bearer URLs may work until their original expiry; downloaded
images cannot be recalled. No stronger revocation is promised.

Account/sign-out and learning-target changes isolate feed state. Focus loss and backgrounding mask photos while preserving bounded session metadata and downloaded pixels. Explicit refresh, relevant mutations and long-background recovery revalidate eligibility; elapsed cache age alone does not. Remote changes appear on the next successful read. This is not realtime. See [QA2 corrections](QA2_CORRECTIONS.md).

Semantic ratings and Phase 9 blocking/reporting are described below. **Public
production launch requires hosted/device acceptance and operational readiness for
the safety controls.** Local implementation supports controlled development acceptance.

## Semantic photo ratings — Phase 8

“How well does this photo represent ‘[word]’?” measures vocabulary representation,
not photography quality, attractiveness or popularity. The exact scale is:

| Score | Meaning        |
| ----- | -------------- |
| 1     | Not related    |
| 2     | Poor match     |
| 3     | Understandable |
| 4     | Clear match    |
| 5     | Perfect match  |

An authenticated, onboarded learner can rate another user's currently eligible public
Discover photo in their saved target language. The owner cannot self-rate. Pending,
private, deleting/deleted, invalid-owner and missing/unverified-image content cannot
receive new or changed ratings. Device state is never the authority for eligibility.

One current rating exists per submission/viewer. A viewer may change it; same-score
retries do not add a vote or change its timestamps. Concurrent accepted changes
serialize at the database; the last serialized accepted score wins. Counts and
averages are server-derived from current votes. The UI displays averages rounded
to one decimal, the count and the viewer's own selected score. Owners see aggregates
but no rating controls. No rater identities/history or public profile page is added.

Public → private retains votes but hides public summaries and rejects new changes.
Private → public restores retained votes. Deletion intent hides the photo and its
summary; soft retirement keeps rows for the existing submission history. Permanent
submission/owner deletion cascades ratings, as does permanent deletion of a rater.
A new photo submission ID starts unrated. Accepted votes are not retrospectively
invalidated by a rater's later target-language change or ban; new writes revalidate.

The app marks submitting intent promptly, then installs the server result. Repeated
taps are serialized; uncertain responses trigger a read before an explicit retry,
not an automatic replay. Account/target/session/focus changes discard stale UI results.
Ratings do not award XP or change streaks, word completion, ordering or ranking.
Comments, likes, social connections and social notifications remain absent. Phase 9 safety
controls are described below; public launch requires operational and device acceptance.

## Reporting, blocking and moderation — Phase 9

Public cards offer Report photo, Report user and Block user, excluding self actions.
Reports originate from currently eligible public cards; the server derives the
reporter and target account. Categories are inappropriate/unrelated image, sexual
content, violence, harassment/hate, spam, privacy concern and other. Optional details
are limited to 500 characters. One open report per reporter/target returns a safe
acknowledgement on retries without changing the original classification. Reports
start open; moderators resolve or dismiss them. Closed cases remain available to
moderators and do not prevent a later new report. Reporters receive no outcome or
identity disclosure to the reported user. Reports and audits retain case identifiers
and snapshots through account/content deletion; no automatic retention deadline or
new account-deletion policy is introduced.

A directed block hides public content mutually, prevents ratings in both directions
and prevents new public signing. Blocks are private; users see only their own list
of blocked usernames, 20 per page, with explicit unblock confirmation. The other
party cannot read who blocked them. Same-state retries do not duplicate a block.
Unblocking restores normal eligibility; it does not restore moderated or restricted
content. Personal vocabulary and private photo management are unaffected. Existing
ratings remain stored, with no individual blocked-rater interaction surfaces.

Moderator roles are backend-provisioned only. The internal interface presents
bounded open/resolved/dismissed queues, case context, report-scoped verified photo
previews, actions and paginated immutable audit history. Moderator previews may
inspect the reported photo after it becomes private or publicly removed, but cannot
access arbitrary unreported private photos, unavailable images or caller paths.
Every accepted moderation action records actor, target, time and optional reason;
retries of the same request identity never reapply an older action.

Moderators may remove/restore a submission's public eligibility, restrict/restore
an account's public participation, and resolve/dismiss reports. Public removal
is separate from owner visibility, Storage deletion and learning completion. Account
restriction prevents public reads, publishing, reporting, blocking new accounts and
ratings, including with existing sessions. Private learning, owner previews, block
list/unblock and data remain available. Restoration still obeys owner visibility,
blocks and individual removal flags. No XP, streak, level, completion or feed-order
changes follow reporting, blocking or moderation.

Future reads and mutation admission use backend safety state. Existing in-flight
read snapshots and previously issued 60-second photo URLs retain their short lifetime;
downloaded images cannot be recalled. Device acceptance, moderation staffing and
operational response procedures are required before public production launch.
Phase 10 private learning preparation is described below; unrelated social features remain absent.

## Private learning notifications — Phase 10

The user explicitly approved at most one **provider send attempt** per user,
notification type and local date. Rare missed notifications are preferred to duplicate
send attempts. Once consumed, a send is never automatically retried, including after
timeout, HTTP failure, rejection or lost database acknowledgement. Expo/APNs/FCM/device
delivery or display is not guaranteed. This replaces the earlier delivery block;
see decision 029 and [notification operations](NOTIFICATIONS.md).

Preferences default to enabled, daily words ON at 08:00 and streak reminders ON at
19:00, using the persisted IANA learning timezone. Users control the switches and
minute-precision local times. Permission is separate: explicit opt-in, no repeated
nagging after denial, device Settings and foreground reconciliation. Web supports
preferences but does not register push.

Daily content contains the three active authoritative target words when the backend
consumes the attempt, after ensuring today's challenge exists. Replacements do not
edit or repeat the notification; Today remains authoritative for current assignments.
A streak reminder requires a surviving run ending yesterday and no valid word today.
One word maintains the streak and suppresses an unstarted reminder. Private learning
remains allowed for publicly restricted accounts. Banned/deleted/incomplete accounts
and ended Auth sessions are ineligible.

One most recently registered eligible device is selected per user/type/day (UUID
breaks registration-time ties); there is no per-device fan-out or fallback resend.
The sender rechecks account, exact binding/session, preferences, timezone/date and
streak eligibility immediately before the provider call. Changes after that admission
or already queued OS pushes cannot be recalled, including after offline sign-out.

Database time is authoritative. Default wall times survive DST; nonexistent custom
times shift forward, and ambiguous times use standard time. Jobs consider the current
local day only, without historical catch-up. Provider expiration is local midnight.
Legacy blocked records are preserved and never automatically dispatched. They can
suppress an attempt on their original date; the next eligible day starts normally.
Notification taps recognize fixed types and the matching account, then open Today
after Auth/onboarding. No arbitrary payload route is used.

The [Phase 10 audit](PHASE10_AUDIT.md) preserves these rules and corrects early DST
admission and previous-account registration cleanup. Device and hosted acceptance
remain required; automated verification does not claim physical push delivery.

## Past Words capture (authorized QA)

Vocabulary now includes final, unreplaced assignments from earlier server-local
days. A historical camera/library photo earns only the reversible +10 word XP,
never daily completion, streak, milestone or 3/3 credit. Captured photos join normal
Vocabulary/social eligibility. See [PAST_WORDS.md](PAST_WORDS.md) for exact admission,
delete/resubmit semantics and required physical acceptance. Phase 11 stays closed.
