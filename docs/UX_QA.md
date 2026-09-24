# Mobile UX polish — physical QA follow-up

This pass refines the existing Phase 10 application. It does not start Phase 11,
add social features, or change product policy, backend contracts, data models,
notification delivery, rating semantics or photo authority.

## Presentation and interaction changes

- Shared neutral surfaces (color roles superseded by [COLOR_SYSTEM.md](COLOR_SYSTEM.md)), separate danger/success states,
  heading/body/caption typography, primary/secondary/tertiary buttons, and 44-point
  minimum icon targets. Inputs distinguish required values, errors and helper copy.
- Discover uses large photos, prominent vocabulary/translation, a visible target
  language and secondary author context. A compact average/count and editable
  viewer-rating state lead to one clear Rate photo / Edit rating action.
- Photo detail is a focused, dismissible native modal over the existing feed, with
  a persistent back control. Hierarchy is photo, vocabulary/author, then labeled
  vocabulary-match choices. Numeric 1–5 meanings remain exactly Not related,
  Poor match, Understandable, Clear match, Perfect match; no stars, likes or rewards.
- Safety actions live behind the detail overflow control in a sheet. Existing
  reporting review, block confirmation, moderator authority and audit data remain.
- Feed refresh is pull-to-refresh; scrolling loads further pages, with an accessible
  Load more fallback. Its existing two-page/24-item retention and newest-first
  timestamp/UUID keysets remain unchanged. Detail reads the live authorized window,
  never a copied photo/metadata cache or new signing request. Detail closes when its
  item disappears or the account/target/background lifecycle clears the window.
- Sign-in/sign-up use clearer field errors and quieter alternate actions. Onboarding
  selects valid IANA zones through a searchable sheet, retaining saved/device/UTC
  options. Server timezone validation and authority remain unchanged.
- Today emphasizes progress and vocabulary cards. The explicit Take photo action
  opens capture directly after the existing authoritative assignment/draft read.
  An existing draft or submission always wins over that capture intent.
- Capture prompts for native camera permission after the user's capture action,
  exposes a prominent shutter, and keeps permission/error recovery available.
  Preview, retake, submission, visibility and deletion remain the existing flows;
  secondary completed-photo controls move into a sheet.
- Vocabulary uses a photo grid, searchable terms, a level filter sheet and clearer
  empty states. Profile groups learning progress and settings. Notifications use
  minute-precision time selection and permission-aware presentation. Recovery-only
  refresh controls remain where an uncertain result requires an authoritative read.
- Blocked users and moderation have clear back controls and less prominent secondary
  actions; no report, blocking, moderation or private-photo authority is broadened.

No dependency, database migration, backend service, Auth/OAuth state machine,
notification provider or signing TTL changes are part of this pass. The existing
local Personal Team push-disable option is preserved.

## Verification and limits

The pass is checked with application tests, TypeScript, ESLint, Prettier, online
Expo Doctor/SDK compatibility, all-platform JS exports and the credential scanner.
Existing local SQL/RLS and photo/Storage/Discover/rating/safety integration tests
are run independently of UI fixture rendering. Exact results are reported with the
handoff; successful exports do not establish successful native binary/device UX.

Local verification on 2026-09-21 passed:

- `npm run check`: TypeScript, zero-warning ESLint, formatting, **355 tests / 40 suites**.
- Expo Doctor **21/21**, SDK compatibility, and iOS/Android/web exports (**20 web routes**).
- Local SQL/RLS suite: **661 assertions / 17 files**, through the documented Docker
  shared-path mirror.
- Existing `db:test:submissions`, `db:test:photo-audit`, `db:test:discover`,
  `db:test:ratings`, `db:test:safety` and `test:auth:integration` all passed.
  Database suites ran sequentially and exercised real Storage expiry/concurrency.
- Browser fixture inspection at 390×844 and 320×568 covered Discover, detail,
  rating/edit state, overflow, auth errors and timezone selection in light/dark.

The full run caught outdated onboarding heading assertions and an asynchronous
photo-recovery test that observed state before its read settled. Assertions now
follow the new presentation and explicitly prove one authoritative recovery read
with no repeated visibility mutation; no tests were skipped or disabled.

A disposable browser harness outside the repository renders the real components
with fixture-only accounts, vocabulary and a public stock photo. It is used for
light/dark, narrow viewport and layout inspection; no demo business logic is added
to the application. Browser inspection cannot validate native camera, iOS sheets,
VoiceOver, keyboard behavior or physical notification/auth behavior.

## Required iPhone review

Use the existing development client, including `LANGTIFY_DISABLE_IOS_PUSH=1` for
both native generation and Metro when using a free Personal Team (see README).
This build does not validate remote push delivery.

- Browse Discover at ordinary and larger Dynamic Type sizes: photo/word/language
  should read immediately; author, aggregate and your current rating should remain
  legible. Open detail, rate, edit, go back, scroll multiple pages and pull to refresh.
- Confirm all five semantic labels are clear, owner posts have no rating controls,
  pending votes cannot be tapped twice, and failed votes can be reconciled/retried.
- Open/cancel report and block sheets, including iOS swipe dismissal and Android
  back. Confirm destructive actions still require confirmation. Verify moderator
  access/revocation, preview expiry, restore/remove and audit workflows.
- Background/resume an open post, switch accounts/target languages, and make a post
  private/delete it on another device. Check that renewed content and rating state
  never cross accounts and unavailable content closes. Existing issued signed URLs
  retain their server-enforced short lifetime; this pass adds no instant revocation.
- Exercise auth field clearing, validation and keyboard return keys; select timezone
  by city/region, search with spaces and underscores, cancel and reopen the selector.
- Take/deny/allow a photo, return from Settings, capture/retake, interrupt/resume an
  upload and delete a completed photo. Check small-screen shutter reachability and
  that errors remain visible inside any open options sheet.
- Check Today progress, replacement recovery, Vocabulary search/level/pagination,
  profile progress, blocked-list pagination and notification time/permission states.
- Review light/dark contrast, VoiceOver labels/focus, sheet keyboard avoidance, safe
  areas and tabs on the actual device. Repeat on Android before calling mobile QA done.

The UX is ready for another physical review, not declared finished by automated tests.
