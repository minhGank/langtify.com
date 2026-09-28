# QA #19 and #22 — Profile summary and owner photo visibility

Level-rule update: [QA #32](QA32_LEVEL_PROGRESSION.md) supersedes the original
Level 0 curve recorded below. Current acceptance starts at Level 1 (0/40 XP).

Only the requested Profile hierarchy and existing owner-browsing filter change.
No Phase 11, unrelated profile feature, progression/write-policy change, new
native dependency, commit, push or deployment. Prior uncommitted QA work is preserved.
Physical iPhone acceptance is pending.

## Profile hierarchy

1. Avatar with the existing edit affordance, username and learning language/CEFR.
2. A single summary row: **Level · Followers · Following**. Counts retain their
   existing list navigation. Level is informational and comes from the existing
   server-authoritative progress response, including Level 0.
3. **My photos** opens the existing My Vocabulary tab. Profile no longer mounts a
   public-feed grid or issues public-photo page/signing requests for that section.
4. **Learning progress** expands the existing XP bar, streaks, word and full-challenge
   counts. It shares the summary's one progress read and does not repeat Level.
5. Existing learning preferences, notifications, safety and account actions. The
   large learning-setup card is replaced with one entry to the existing settings
   screen; its editable fields and authority are unchanged.

Unavailable summary values show a dash instead of invented zeros. Failed reads
have retry actions; expanded progress has a loading state. Profile cache and
progress are keyed to the current account/session. Confirmed follow changes update
the existing shared count cache. Today still has no level or total XP.

## Owner visibility browsing

A compact neutral **All / Public / Private** segmented control sits in the existing
Vocabulary browser and concept history. The selected state uses a subtle surface,
border, indigo label and accessible checked state; all touch targets are at least
44 points. Native back/tab behavior, dark mode and scalable text remain intact.
No new animation is introduced.

All preserves the existing grouped vocabulary library. Public and Private select
matching owned captures **before** choosing each concept's latest image and count.
An older private photo therefore remains discoverable behind a newer public one.
Concept detail inherits the selected visibility, with the same control to switch
back to All. Search and CEFR apply to the latest matching capture. Displayed
concept totals respect visibility but remain independent of search/CEFR.

The browser keeps one page and cursor per account/session/concept/search/CEFR/
visibility key in the existing bounded memory cache. Changing filters masks the
previous query's text/pixels immediately, cancels obsolete requests and either
restores that filter's cached page or loads its first page. Revisits do not poll
because time elapsed. Existing photo visibility/deletion invalidation covers all
filter variants; explicit refresh is available. Signed media keeps its original
expiry and only downloaded pixels may be reused in the session cache.

## Database and privacy

Migration: **`20260926010000_owner_history_visibility.sql`**.

It extends only `get_my_vocabulary` with a final optional
`requested_visibility text` argument: null means All; other valid values are
`public` and `private`. Six-argument and argument-free callers retain All behavior.
The old signature is replaced transactionally, avoiding ambiguous PostgREST
overloads. Replay preserves existing photos, progress, XP and returned history.

The RPC stays **security invoker**, with an empty search path, explicit
`auth.uid()` ownership and existing source RLS. It accepts no owner/profile ID.
It uses completed captures and immutable snapshots, filters before grouping and
pagination, and returns at most 24 rows (12 in the app). The existing owner-history
index continues to bound reads; exact grouping/counts still process the owner's
matching history. No new table, index, RLS policy, Storage grant or Edge Function.

The owner can browse public and private photos, including private learning retained
under social restrictions. Another user's public profile still uses its unchanged
eligible-public projection and public signing rules. Blocking/moderation, search,
private bucket access and the existing 60-second owner signing path remain intact.
A client visibility selection grants no additional read capability.

## Verification

Passed:

- `npx supabase migration up --local`: new migration applied locally only.
- `npm run check`: TypeScript, ESLint, formatting, **862 app tests / 75 suites**.
  New coverage includes summary hierarchy, Level 0/errors, one progress read,
  disclosure, follow-count synchronization, existing settings routes, filtered
  empty states, per-filter pagination/cache, stale responses/account changes,
  concept-route visibility and service response validation. Existing public-profile,
  privacy, native navigation, Today and progression tests still pass.
- SQL/RLS via `npx supabase test db <mirror>/supabase/tests/`:
  **1,093 assertions / 23 files**. These include oldest/newest mixed-visibility
  grouping, capture counts, detail summaries, input rejection, source RLS,
  cross-user/anonymous denial and deleting-last-match behavior.
- `npm run db:test:vocabulary`: real Auth/Storage, both visibility filters and All,
  exact keysets, owner-only counts/history, unchanged public profiles, block and
  restriction behavior, deletion, signed-photo ownership and real expiry.
- `npm run db:test:bootstrap`: replay over nonempty photos/XP, one unambiguous
  signature, old caller compatibility and an authenticated generic query plan
  using the owner-history index among 25,000 unrelated captures. Disposable-schema
  lint passes.
- `npm run functions:check`, `functions:lint`, `functions:test`: shared database
  types compile across all three functions; **23 function tests** pass.
- `EXPO_NO_DOTENV=1 npm run doctor`: **21/21**.
- `EXPO_NO_DOTENV=1 npx expo install --check`: dependencies up to date.
- `npm run export:check -- --clear` with dotenv disabled and public local fixtures:
  iOS, Android and web pass.
- `npm run security:scan`: source/config/web and both decoded Hermes bundles pass.
- `git diff --check`: passes.

The first planner fixture lacked Supabase's normal `auth` schema usage permission;
that permission was added only inside the rollback-only disposable fixture.
A proposed visibility index was then removed after the actual plan selected the
existing owner-history index. The final migration adds no redundant index. App
verification also corrected test matcher/argument expectations and replaced a
render-time ref read with render state for the query-visibility guard. A same-word
route-parameter regression test caught an unchanged initial filter; keying the
content by validated route visibility fixes it without discarding cached pages. No security
assertion or existing test was skipped. Existing navigation-fixture and Node
module-type warnings remain unrelated.

All **18** local integration commands passed sequentially:

- `db:test:integration`, `db:test:challenges`, `db:test:submissions`,
  `db:test:photo-audit`, `db:test:progress`, `db:test:vocabulary`;
- `db:test:discover`, `db:test:ratings`, `db:test:safety`, `db:test:social`,
  `db:test:avatars`, `db:test:inbox`, `db:test:explore`, `db:test:past-words`;
- `db:test:notifications`, `db:test:notification-sender`, `db:test:bootstrap`,
  `test:auth:integration`.

`npx supabase db lint --local --level warning --fail-on warning` passed with no
schema warnings/errors. The temporary Docker-shareable function/test mirror used
normal JWT verification. It was removed after verification; the persistent local
Supabase database/Auth/Storage stack remains running. No hosted project was touched.

## Dev rollout — not performed

Apply `20260926010000_owner_history_visibility.sql` after existing migrations, then
load the updated app JavaScript. The preceding QA #20 avatar migration/function
requirements remain documented separately in `QA20_DISCOVER_AVATARS.md` if that
batch has not yet been deployed. This batch requires no new hosted secret or Edge
Function deployment and no additional native development-client rebuild.

## Physical iPhone checklist

1. Profile: avatar edit, username and a balanced Level/Followers/Following row in
   light/dark, large text and VoiceOver. Verify Level 0 and higher levels against
   the server. Counts open their original lists with normal Back behavior.
2. Confirm the Public Photos section is gone. My photos opens the existing
   Vocabulary tab; learning preferences and account entries still work.
3. Expand/collapse Learning progress: existing XP/bar/streak/completion values,
   no duplicate Level and no reward animation on revisits. Today remains focused.
4. Browse All/Public/Private, including a word with both visibilities and an older
   matching capture. Check search/CEFR, counts, empty states, pagination, concept
   detail, back navigation and restored filter pages.
5. Change a photo's visibility or delete it, then return to each cached filter.
   Verify membership/latest image/count updates and no ghost concept after the
   last matching capture is deleted.
6. Open another user's profile: only eligible public photos, no owner visibility
   control. Exercise blocks/restrictions without losing private owner history.
7. Switch accounts or background during loading; rapidly switch filters and return
   from a post. No old-account photos, level/counts or stale-filter results should
   appear. Test offline retry without automatic polling.

Automated checks support rollout review; physical acceptance is not yet claimed.
Nothing has been committed, pushed or deployed.
