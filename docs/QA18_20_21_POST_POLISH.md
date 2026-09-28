# QA #18, #20 and #21 — post, authors and accent restraint

Presentation only. No Phase 11, product/backend rule, schema, dependency or native
configuration change. Preserve all prior uncommitted QA #14–17 work. No commit,
push or deployment. Physical iPhone acceptance remains pending.

## Design

- Full-width photo, prominent vocabulary and translation, quiet language/CEFR and
  privacy context, avatar/username/date, compact rating, then conversation.
- Detail reuses Discover's `QuickRating` and five-option accessible palette. “Rate
  photo” opens “How well does it match?” and the unchanged semantic choices. The
  selected label/aggregate update only from the existing authoritative receipt;
  errors, disabled states and edit behavior keep the audited mutation ordering.
  Owners see aggregate plus a small “Your photo” note, with accessible explanation
  and no disabled rating form. Private/ineligible owner photos have no public controls.
- `PostAuthor` replaces sentence-like attribution with an initial avatar and username;
  the post additionally shows the existing date. There is no public display-name
  field and none is introduced. Existing username-only feed responses do not expose
  avatar IDs in the initial presentation pass. The subsequently approved
  [QA #20 avatar follow-up](QA20_DISCOVER_AVATARS.md) adds actual photos through a
  bounded read extension, without per-row profile/signing reads or raw profile access.
- Conversation remains in the scroll view. A compact multiline input and 44-point
  send icon sit in a separate bottom dock. Empty/busy input disables Send; retry
  retains the draft and the same request ID. The character counter appears only
  near the existing 500-character limit. Input height is bounded with internal
  scrolling. The send icon has explicit accessible Send/Sending/Retry labels.
- One keyboard-avoidance container uses the measured native header offset; native
  scroll-inset adjustment is not also enabled. The home-indicator inset disappears
  above a visible keyboard. Interactive keyboard dismissal and native Back remain.
- Share appears inside owner photo options or the existing safety menu alongside
  report/block. Privacy/delete/report/block confirmations and shared text remain
  unchanged; no signed URL enters sharing. Share failures appear in the menu.
- The one-use submission notice lives outside the eligibility-dependent conversation
  layout, preserving immediate feedback when initial public activity loads. Recovery
  and revisits remain silent. Existing Reduce Motion preferences govern feedback
  and rating/safety sheets; no additional animation system is added.

## Light/dark accents

Search uses neutral secondary icons on neutral surfaces; selected controls retain
indigo. Streak and XP use distinct soft orange/yellow surfaces, neutral text and
small contrasting icons. The approved base colors remain unchanged. Profile XP
keeps the yellow progress fill with a contrasting outline; numeric progress and
labels remain available independently of color. See [COLOR_SYSTEM.md](COLOR_SYSTEM.md)
for the four derived roles and automated contrast checks.

## Verification

Passed:

- `npm run check`: strict TypeScript, ESLint, formatting and **840 application
  tests across 73 suites**. New tests cover compact rating disclosure, conversation
  versus composer layout, empty/busy/retry send state, keyboard inset handling,
  overflow sharing/safety, private owner exclusion, author identity and light/dark
  treatments. Existing comment idempotency/deletion/account isolation, rating
  synchronization, native navigation and one-shot submission feedback still pass.
- `EXPO_NO_DOTENV=1 npm run doctor`: **21/21** checks.
- `EXPO_NO_DOTENV=1 npx expo install --check`: dependencies up to date.
- `npm run export:check -- --clear`, dotenv disabled with local public fixture
  configuration: iOS, Android and web exports pass.
- `npm run security:scan`: **460** source/config/bundle files and both decoded
  Hermes bundles pass; no privileged credentials/server implementation in exports.
- `git diff --check`: passes.
- `npx supabase test db <mirror>/supabase/tests/`: **1,068 assertions across 23
  SQL/RLS files** pass using unchanged repository tests.

The first focused UI run caught a remount of the one-shot submission notice when
public activity became available. Moving that notice outside the conditional
conversation layout fixed it; the existing immediate +10 XP/revisit/recovery tests
pass without weakening their assertions. The existing unrelated navigation fixture
warning and Node module-type notices remain; no tests were skipped.

All **11** affected integration commands passed sequentially:

- `npm run db:test:submissions`
- `npm run db:test:photo-audit`
- `npm run db:test:progress`
- `npm run db:test:discover`
- `npm run db:test:ratings`
- `npm run db:test:safety`
- `npm run db:test:social`
- `npm run db:test:avatars`
- `npm run db:test:inbox`
- `npm run db:test:explore`
- `npm run db:test:past-words`

`npx supabase db lint --local --level warning --fail-on warning` passed with no
schema warnings/errors. These cover real local Auth/Storage, signed-photo expiry,
source validation, concurrent finalization/deletion, progression, social safety and
avatar cleanup. Existing backend authority is unchanged; regressions used only
the documented temporary Docker mirror, with normal JWT verification. No migrations
were needed. Bootstrap, Auth and notification regressions passed in the preceding
QA #14–17 verification; those unchanged suites were not rerun in this pass.

The temporary function server/mirror is removed after testing; the original local
database, Auth and Storage services remain running. No hosted project was touched.
The results above describe the frontend-only batch. The separately approved
[QA #20 avatar follow-up](QA20_DISCOVER_AVATARS.md) records uploaded author photos,
its additive migration and additional verification. Physical acceptance remains pending.

## Physical iPhone acceptance

1. Open another user's post and an own public/private post from Discover, Today and
   a direct route. Verify photo/word prominence, translation, author navigation,
   privacy, native edge-back and return to the preserved feed scroll position.
2. Rate an unrated photo, edit the score, return to Discover and reopen it. Confirm
   one synchronized rating, pending/error states and no owner rating control.
3. Read empty/long conversations; page older/newest comments. Open the keyboard,
   type multiple lines and send. Confirm the composer stays above the keyboard,
   the conversation scrolls, no duplicate send is possible and dismissal feels native.
4. Interrupt a comment request, retry, delete an own comment, report/block another
   commenter. Confirm preserved drafts, idempotent retry, correct confirmations and
   immediate removal/invalidation. Switch accounts mid-request and check isolation.
5. Open overflow, share and cancel sharing, report/block a post, edit owner privacy
   and delete a photo. Private/ineligible posts must never gain public interactions.
6. Submit a photo and wait for public activity to load: one brief acknowledgement,
   no summary page/reward replay. Revisit and recover uploads without replay.
7. Review Search, current/longest streak, XP badges/bar in light/dark mode. Check
   large text, small screens, VoiceOver, Reduce Motion and keyboard safe areas.

This batch requires no additional native rebuild when using the existing compatible
development client. Automated layout checks do not replace a physical keyboard,
gesture or visual review.
