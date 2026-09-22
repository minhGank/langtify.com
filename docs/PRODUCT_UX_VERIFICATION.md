# Product/UX pass verification

Verified locally on 2026-09-21. **Ready for physical iPhone acceptance, not declared
complete.** No commit, push or hosted deployment was performed. Existing uncommitted
Personal Team and presentation work was preserved.

## Implementation

- Two migrations: `20260921000000_product_social.sql` and
  `20260921010000_profile_avatars.sql`. Public IDs, indexed username search,
  authoritative profile/learning editing, follows, comments, comment moderation,
  private avatar lifecycle and cleanup. No change to XP, challenge generation,
  photo completion, rating scores, feed order or notification policy.
- Routes: `/edit-profile`, `/learning-settings`, `/people`, `/public-profile`, all
  behind the existing authenticated/onboarded gate. Profile, Discover/feed/detail,
  comment moderation and Today replacement controls are updated. Avatar gallery
  selection is separate from challenge capture.
- Shared client infrastructure: bounded typed session caches, targeted invalidation,
  safe photo expiry, inline rating using existing vote state, native text sharing,
  stable live appearance subscriptions and native comment keyboard handling.
- New native dependency: SDK-compatible `expo-image-picker ~57.0.19`, installed
  with `npx expo install`. No global-state/query library added. CI includes the
  social/avatar integration suites and the third Edge Function.

## Tests and results

| Check                                                   | Result                                                                                                                                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                                         | PASS: strict TypeScript, ESLint, Prettier, **395 application tests / 46 suites**.                                                                                                     |
| Local migrations and `supabase test db` (Docker mirror) | PASS: **786 assertions / 19 files**.                                                                                                                                                  |
| `npm run db:test:bootstrap`                             | PASS: fresh bootstrap, nonempty migration replay, existing invariants, generic query-plan checks.                                                                                     |
| `npm run db:test:social`                                | PASS: real Auth/Storage, concurrent follow/comment retries, deletion tombstones, username races, reports/moderation, blocks/visibility, direct REST denial and account-erasure races. |
| `npm run db:test:avatars`                               | PASS: real JPEG/Storage, ownership, private bucket, bounded signing, 60-second capability, replacement/replay, EXIF denial, cleanup and account-erasure races.                        |
| `npm run test:auth:integration`                         | PASS: existing Auth/session regressions.                                                                                                                                              |
| `db:test:integration`, `db:test:challenges`             | PASS: onboarding, catalog, generation and concurrency.                                                                                                                                |
| `db:test:submissions`, `db:test:photo-audit`            | PASS: existing photo authority, Storage, recovery/cleanup and real URL expiry.                                                                                                        |
| `db:test:progress`, `db:test:vocabulary`                | PASS: XP/streak/history authority and concurrency.                                                                                                                                    |
| `db:test:discover`, `db:test:ratings`, `db:test:safety` | PASS: public eligibility, rating, moderation, signing, real expiry and concurrency.                                                                                                   |
| `db:test:notifications`, `db:test:notification-sender`  | PASS: existing notification contract, scheduler and token lifecycle.                                                                                                                  |
| Local database lint                                     | PASS: no schema errors/warnings.                                                                                                                                                      |
| `functions:check`, `functions:lint`, `functions:test`   | PASS: all three functions; **21 Deno tests**.                                                                                                                                         |
| `npx expo install --check`, `npm run doctor`            | PASS: SDK aligned, **21/21 Doctor checks**.                                                                                                                                           |
| `npm run export:check`                                  | PASS: iOS/Android Hermes and web exports.                                                                                                                                             |
| `npm run security:scan`                                 | PASS: source/config/export scan and both decoded Hermes bundles; no privileged credentials/server implementation in client exports.                                                   |
| `npm audit --audit-level=high`                          | PASS at the high/critical gate; **14 known moderate findings remain**. No forced upgrades.                                                                                            |
| CI setup tests, workflow YAML parse, `git diff --check` | PASS: four setup tests, valid YAML, no whitespace errors.                                                                                                                             |

Shared database suites ran sequentially. Some existing integration scripts emit
Node's module-type advisory; application tests can emit a React Native virtualized
list `act` warning. Neither represents a failed assertion; no checks were suppressed.
Exports are not native binary builds or physical-device acceptance.

## Regression findings fixed during implementation

- Avatar/social writes could deadlock with Auth-account erasure. Ordered Auth-user
  admission precedes state/safety locks, with current moderator membership held at
  write admission. Real competing transactions reproduce and guard the fix.
- Whitespace-only direct REST comments could pass SQL but fail client validation.
  SQL now rejects the full JavaScript-trim Unicode whitespace set.
- Follow-count predicates would perform repeated helper work per relationship.
  Set-based indexed joins replace it; generic plans are checked with 25,000 unrelated
  profiles/edges in an isolated database.
- Cache denials could cause automatic refresh loops or restore denied feed metadata.
  Clear-without-retry semantics and regression tests prevent both.
- A late photo response could invalidate another session's caches. Photo invalidation
  is scoped to its originating Auth session.
- Browser review reproduced partial light/dark updates in nested Profile components.
  A stable Appearance subscription fixes it without changing the palette.

## Measured UI/network evidence

Tests show zero additional page/sign calls on a fresh two-page Discover tab return;
after hidden capability expiry, one signing batch and zero additional page reads.
Vocabulary preserves its exact page/cursor and ignores unrelated invalidations.
Recent avatar profile revisit reuses its valid capability. Inline/detail rating
changes share the same authoritative state and do not fetch another feed page.

Disposable browser fixtures reviewed actual components at 390×844 and 320×568 in
light/dark modes: feed, inline rating, comments, sharing, public/own profiles and
editing. The fixed live-theme result was reviewed separately. Fixtures and browser
screenshots are outside the repository; they do not claim real account/device data.

## Remaining acceptance

Apply the migrations and deploy `avatar-authority` to the intended hosted Dev;
update the existing trusted hourly cleanup command. Rebuild the iPhone development
client for ImagePicker, retaining `LANGTIFY_DISABLE_IOS_PUSH=1` for the free Personal
Team. Normal builds without that flag remain push-capable.

Run the phone checklist in [PRODUCT_UX_PASS.md](PRODUCT_UX_PASS.md#hosted-setup-and-iphone-acceptance).
In particular test gallery/permissions, interrupted uploads, comment keyboard and
native sheets, Share/cancel, VoiceOver/large text, short/long background, tab scroll
continuity, account switches, and two-account blocking/moderation. Already issued
60-second signed URLs cannot be recalled, and live keyset pages are not frozen
snapshots. No production-scale latency/battery claim or device acceptance is made.
