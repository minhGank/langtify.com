# QA3 — search, ratings and native post navigation

This is the explicitly authorized physical-device QA correction/search pass, not
Phase 11. No commit, push or hosted deployment is performed. **Physical iPhone
acceptance is pending; the pass is not complete.**

## Design and behavior

Discover keeps the photo-led feed and now has one conventional Search entry below
its heading. Search has Words and People segments; it does not mix unrelated
result types into one long universal feed. Words show the current catalog term,
reference translation and CEFR. A word opens its concept and newest eligible public
photo examples. People show avatar, username and current Following/You state;
tapping opens the existing public profile with authoritative follow controls.
The old `/people` route remains a compatible People-segment entry.

Quick rating is a compact “Rate match” chip or the current semantic match label,
next to the existing aggregate. A tap opens a transient palette and choosing a
match dismisses it. Five accessible choices retain the exact 1–5 meanings. The
palette wraps for small screens/large text rather than compressing touch targets.
The chip has at least a 48-point target. No permanent five-button bar, inline card
expansion, new reaction model or optimistic persisted score is added. Saving is
visible; an uncertain result reconciles through existing authority without replay.
Tapping the existing score does not send a redundant write. Owners see their
aggregate without a rating control. Feed, profile/example windows and native post
share confirmed rating receipts.

Username Save is disabled when the normalized draft equals the saved username,
including casing/whitespace-only changes and edits reverted to the original.
The handler also guards this case without a server request or navigation. Changed
values retain existing validation, server uniqueness and account refresh behavior.
The avatar/pen remains the editor entry. Redundant Edit Profile/View Public Profile
buttons are removed and the owner's public photos appear inline on Profile.
Own and other empty public profiles have distinct concise empty states. Normal
public-photo refresh and comment refresh controls are removed; explicit error Retry
remains. Profile pull-to-refresh targets its own metadata/progress/post window.
Confirmed comment deletion removes its row locally; reconciliation preserves
already loaded comments without timers or polling.

`displayTerm` in `src/utils/display-term.ts` trims outer whitespace and capitalizes
only the first Unicode code point. The remainder is never lowercased or rewritten;
accents, combining marks, internal capitalization and uncased scripts survive.
Multi-character uppercase expansions such as ß→SS are left alone. An optional
locale supports language-specific casing. Today, Discover, post/photo detail,
vocabulary, public profiles, Explore and inbox word labels use the helper. Stored
terms, immutable snapshots, search input and paging cursors are unchanged.

## Navigation and safe areas

The old post detail was a full-screen React Native Modal with a hand-built header.
It was outside the native stack, so there was no stack edge-pop gesture, and its
separate presentation boundary made header insets fragile on iPhones. `/post` now
uses Expo Router's native card stack, native header/back item and enabled iOS back
gesture. Content applies only left/right/bottom safe areas; the native header owns
the top inset. Search and word detail follow the same pattern. There are no
screen-coordinate offsets or guessed notch heights.

Taps and gestures pop the same route. Direct entry has a fixed Discover fallback.
Only a validated submission UUID enters Router state—never item metadata, owner
identity, arbitrary routes, tokens or signed photo URLs. Direct post reads use
current saved-target/public eligibility. Author and moderation actions keep their
existing private/controlled authority.

The mounted Discover FlatList remains underneath the pushed route, preserving its
page and scroll position. Loaded, fresh source metadata seeds the bounded post
window and existing downloaded pixels are reused. An invalidated source cannot be
made fresh by navigation; the detail must reconcile. This edge case has a real
Router regression. Backgrounding clears inactive photo presentation without
silently popping the native route. Short resume restores eligible cached pixels;
existing long-background recovery reconciles state.

References: [Expo Stack](https://docs.expo.dev/router/advanced/stack/),
[Expo safe areas](https://docs.expo.dev/develop/user-interface/safe-areas/),
[installed SDK 57 reference](https://docs.expo.dev/versions/v57.0.0/).
Native gesture mechanics and actual notch/large-text rendering require device QA;
JavaScript Router tests are not a substitute for physical acceptance.

## Search authority and database changes

New additive migration: `20260922020000_explore_search.sql`.

- `search_vocabulary_terms`: database-derived saved target/reference, current active
  photographable concepts, target-term token-prefix search and reference translation.
  “chien” matches “le chien”. Inputs are 2–64 characters with at most eight parsed
  lexemes; query operators and wildcard characters cannot broaden the search.
  Multiple tokens are ANDed. Accents are preserved; no fuzzy/translation search is
  silently introduced. Stable alphabetical term/concept keysets return at most 24
  rows (client 20).
- `get_explore_concept`: current eligible catalog context for a concept.
- `get_concept_submissions`: newest public examples for that concept/saved target,
  timestamp/UUID keysets and existing bounded aggregate ratings.
- `get_discover_submission`: one current eligible public post for direct native entry.
- `search_public_profiles`: existing indexed username-prefix projection with additive
  `is_self`/`is_following` booleans; no per-row relationship fetch.

An active-term GIN text-search index and public/completed
`(vocabulary_term_id, submitted_at DESC, id DESC)` index bound the new reads. Generic
plans over 25,000 unrelated records verify their use. A correlated eligibility
boundary preserves the concept/cursor seek before expensive photo eligibility.
Raw profile/submission/Storage grants and write/RLS policies remain unchanged.
RPCs derive the viewer from Auth and use an empty search path. Blocks, account
restrictions, bans/deletion, moderation, visibility, object verification and saved
target checks reuse the existing Discover projection. Historical photo terms stay
immutable even when catalog labels change. No duplicate vocabulary model exists.

## Cache and network policy

Search waits 350 ms after normalized input settles. New input unmounts/cancels obsolete
results immediately; late responses cannot install across query/account/language
boundaries. Words retain at most 40 rows per window and eight recent query entries;
People use the existing bounded search cache. Metadata uses session+language+query
keys and exact unformatted cursor terms. Search navigation reuses loaded results.

There is no elapsed-time-only or tab-focus fetch. Initial misses, actual search
input, explicit refresh and existing justified long-background recovery are valid
read triggers. Loaded rows remain visible during explicit refresh. Follow receipts
patch only affected People results. Public eligibility failures clear related scoped
cache; logout/session replacement retires it. Native post cache seeding preserves
source invalidation obligations.

Avatar signing and public photo signing are batched through existing authorities.
Examples reuse `useDiscover`; there are no per-tile metadata/rating/signing reads.
Signed URLs retain 60-second server expiry/55-second download admission and are
never extended by metadata freshness. Only bounded session-memory downloaded pixels
are retained. No remote push type, sender, token lifecycle, XP or streak rule changes.

## Verification

New tests cover the display helper, disabled/no-op Save, compact rating selection
and edit/error states, own/other profile states, comment controls, debounced search,
word/People pagination, account/language changes, real Router post/back/direct
entry, shared rating state and invalidated-source admission. The new integration
script is `npm run db:test:explore`, included in CI's sequential local backend checks.

After explicit local-only approval, `20260922020000_explore_search.sql` applied
successfully to persistent local Supabase. All 962 SQL/RLS assertions in 22 files
passed, including the 65 new Explore assertions. All 16 local integration suites
and the separate bootstrap suite passed sequentially, without a failure, retry or
workaround. Bootstrap verified two nonempty Explore replays and indexed generic
plans; actual Supabase database lint passed on both the disposable full schema and
persistent local schema with `--level warning --fail-on warning`.

The integration run covered Auth sessions, onboarding/database concurrency,
challenges, submissions, photo security/recovery, progress, vocabulary history,
Discover, ratings, safety/moderation, social profiles/comments/follows, the inbox,
Explore, avatars, notification preparation and the notification sender. Actual
local Auth/Storage and locally served photo/avatar authorities were exercised.
Provider-send tests used the existing instrumented transport, not a live push
provider. No hosted project was accessed or changed.

Final local results on 2026-09-22:

| Check                                                                      | Result                                                                                                                                                                     |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                                                            | TypeScript, zero-warning lint, formatting and **584 application tests in 61 suites passed**.                                                                               |
| `npm run db:test:bootstrap`                                                | Full bootstrap, two new-migration replays, **65 new SQL/RLS assertions**, 25,000-record generic-plan checks and full-schema Supabase lint passed in a disposable database. |
| Persistent local migration / complete DB/RLS and Auth/Storage integrations | Migration applied; **962 assertions in 22 files** and **all 16 integration suites passed**, including `db:test:explore`.                                                   |
| Persistent local database lint                                             | Pass; no warnings/errors with `--level warning --fail-on warning`.                                                                                                         |
| `functions:check`, `functions:lint`, `functions:test`                      | Pass; **23 Deno tests** across existing photo, notification and avatar authority.                                                                                          |
| `npm run doctor`, `npx expo install --check`                               | **21/21 Doctor checks** and compatible SDK dependencies.                                                                                                                   |
| `npm run export:check`                                                     | iOS, Android and web pass using nonfunctional public CI fixtures.                                                                                                          |
| `npm run security:scan`                                                    | Source/config/bundles and both decoded Hermes exports pass.                                                                                                                |
| CI setup / `git diff --check`                                              | **4 CI setup tests passed**; diff check clean.                                                                                                                             |

No dependency or native configuration changes were introduced in this scope. Prior
uncommitted work is preserved. Automated local verification now clears QA3 for a
separately authorized Langtify Dev deployment; nothing has been deployed, committed
or pushed. Physical acceptance remains pending, so the QA pass is not closed.
Final review also corrected stale source admission when opening a post and explicit
search pagination refresh retaining an old scroll offset.

## Dev rollout — only after separate deployment authorization

1. Ensure prior Product/UX and QA2 migrations are present, in order:
   `20260921000000_product_social.sql`, `20260921010000_profile_avatars.sql`,
   `20260922000000_public_profile_submissions.sql`,
   `20260922010000_follow_lists_inbox.sql`.
2. Apply `20260922020000_explore_search.sql`; verify catalog/People projections and
   private/blocked/removed example exclusion using Dev test accounts.
3. Roll out the matching JavaScript client after the RPCs. New People parsing expects
   the two follow-state fields. No new Edge Function, secret, cron job, dependency
   or native capability is required. Existing photo/avatar authorities remain deployed.
4. Use the current development binary if it already includes prior dependencies.
   Keep `LANGTIFY_DISABLE_IOS_PUSH=1` for Personal Team builds. This pass does not
   require a new push capability or expand remote notification types.
5. Perform and record physical acceptance below. Roll back schema changes only with
   a corrective additive migration; do not reset hosted data or delete migration history.

## Physical iPhone and Android acceptance — pending

- On Discover, tap Rate match, choose/edit all five values and verify chip/aggregate
  updates; no owner rating. Check failed/slow network, disabled pending actions,
  VoiceOver, large text, dark mode and palette touch targets.
- Open the same post from feed/profile/word examples. Verify photo→word→rating
  hierarchy, safe native header at notch/Dynamic Island, tap Back, iOS left-edge
  swipe Back (including cancelled swipe), and Android hardware Back. Feed scroll
  and page must remain. Test landscape/rotation and different safe-area sizes.
- Direct-open valid/private/deleted/malformed post IDs; unavailable content must not
  leak and Back must reach Discover. Background/resume and switch accounts during
  rating/signing requests; no stale vote/photo from the previous account.
- Search “chien”, prefixes, accented terms and multiple words. Confirm correct saved
  target/reference/CEFR, public examples and normal empty results. Test word/People
  paging, fast typing, clearing, segment switching, profile/word→Back caching, and
  changed learning language. Verify block/moderation/privacy filtering and batched reads.
- Save is visibly disabled for unchanged username, case/whitespace-only edits and
  reverting a draft. Changed/invalid/taken usernames retain correct behavior.
- Profile uses the avatar pen for editing, shows own public photos naturally and
  retains followers/following access. Check distinct own/other empty states and
  pull-to-refresh. There must be no redundant Edit/View/Refresh CTAs.
- Post/delete a comment; confirmed state updates without a refresh icon or polling.
  Existing report/moderation actions and error recovery remain usable.
- Confirm capitalization across Today/feed/post/history/search without modifying
  stored terms or internal casing. Test accented text, emoji/uncased scripts and
  long phrases. The QA pass remains open until this device checklist passes.
