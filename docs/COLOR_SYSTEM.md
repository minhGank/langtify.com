# Visual identity — physical iPhone review pending

This focused QA pass changes color presentation only. It does not open Phase 11,
change routes, progression, remote notifications, caching, backend authority or
product policy. No logo artwork is redesigned. No packages, migrations, functions
or secrets are introduced; no commit, push or deployment is included.

## Roles and restraint

Indigo identifies primary actions, selection, navigation and interactive emphasis.
Orange highlights streaks and the discovery/search entry. Yellow identifies XP,
level progress, bonuses and milestones. Green indicates confirmed success or
completion; it is never the brand/action color. Red identifies errors/destruction.
Warning retains a readable amber distinct from the bright reward treatment.

Large surfaces and text stay neutral. Most icons, avatar initials, metadata,
public-profile content, comments and list rows remain neutral. The 80/15/5 balance
is a design direction, not a claimed pixel measurement: brand is concentrated in
CTAs and selected controls, and energetic color lives in compact badges/icons.
Daily progress and unread inbox rows no longer fill whole cards with brand tint.
Ratings stay indigo because they are selections, not earned learning rewards.

## Exact tokens

The single runtime source is `src/lib/theme.ts`. Old `primary`, `primarySoft`,
`onPrimary`, `text`, `muted`, `danger` and `dangerSoft` names are replaced throughout
the UI with semantic names. `brandText` reuses the supplied stronger indigo so
small labels remain readable on tinted and muted surfaces. `controlBorder` is
reserved for input/control identification; decorative separators use `border`.
`mediaBackground`/`mediaForeground` keep camera contrast independent of app mode.

| Token               | Light                 | Dark               |
| ------------------- | --------------------- | ------------------ |
| brandPrimary        | #5B5CF6               | #8B8CFF            |
| brandPrimaryPressed | #4748D8               | #A6A7FF            |
| brandText           | #4748D8               | #A6A7FF            |
| brandSoft           | #EEEDFF               | #2D2D4B            |
| textOnPrimary       | #FFFFFF               | #111D21            |
| accentEnergy        | #FF7048               | #FF8D6D            |
| accentReward        | #F4C542               | #FFD966            |
| textOnAccent        | #192D32               | #192D32            |
| success             | #1F805F               | #64D7AD            |
| error               | #C13E3E               | #FF9A9A            |
| errorSoft           | #FCEEEE               | #482B32            |
| warning             | #886013               | #EDC575            |
| background          | #F7F8F4               | #111D21            |
| surface             | #FFFFFF               | #1B2A2F            |
| surfaceMuted        | #EDF0F4               | #25343C            |
| textPrimary         | #192D32               | #EFF5F2            |
| textSecondary       | #5B6D72               | #B0C0C0            |
| border              | #DDE2E7               | #3B4850            |
| controlBorder       | #78868A               | #78868A            |
| overlay             | rgba(9, 24, 28, 0.42) | rgba(0, 0, 0, 0.6) |
| mediaBackground     | #111D21               | #111D21            |
| mediaForeground     | #FFFFFF               | #FFFFFF            |

## Contrast decisions

[WCAG text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
sets 4.5:1 for normal text; meaningful authored controls/graphics use the 3:1
[non-text criterion](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).
Tests evaluate exact sRGB luminance without rounding the pass threshold. This
verifies authored color pairs, not blanket WCAG conformance or native rendering.

- Keep supplied indigo/orange/yellow and all supplied dark semantic colors exact.
  White on light indigo is 4.88:1; dark ink on dark indigo is 5.97:1. Pressed
  primary colors retain readable labels rather than fading the entire button.
- Light green #24966F is 3.48:1 on the off-white page, insufficient for completion
  captions. Adjust `success` to #1F805F: 4.57:1 on the page and 4.87:1 on white.
- Light red #D14343 is 4.28:1 on the page and 4.05:1 on the error tint. Adjust
  `error` to #C13E3E: at least 4.5:1 across the tested neutral/brand/error surfaces.
- Bright orange and yellow are not small text colors on white. The reusable
  `AccentBadge` pairs exact accent fills with #192D32 ink: 5.24:1 on light orange,
  8.83:1 on light yellow, and higher in dark mode. Labels/flame icons identify
  meaning independently of color. Reward bars have an ink outline so a yellow
  fill remains identifiable against the light track; numeric progress remains.
- Brand-colored small text uses `brandText`, especially on muted/selected surfaces.
  This avoids light primary's roughly 4.2:1 on a pale indigo tint and dark primary's low
  small-text contrast on muted surfaces. Brand icons retain at least 3:1.
- Decorative borders stay subtle. Input/control outlines use #78868A and pass 3:1
  against adjacent page/surface/muted backgrounds in both modes.
- Disabled shared controls retain readable neutral labels and existing disabled
  semantics. Busy controls retain spinners. Press feedback changes fill/border
  rather than fading text; checked icons, labels, numeric progress, switch
  positions and accessibility states remain. Google brand styling is unchanged.

## Screen audit and largest changes

- Auth/onboarding: restrained indigo mark, primary CTA and selection; neutral forms,
  stronger input boundaries, green only for successful feedback, red errors.
- Today/challenge cards: neutral progress container; green completion segments and
  labeled completion; yellow XP/bonus badges; orange labeled streak. Main capture
  actions are indigo; completed cards remain neutral with green status.
- Profile: yellow XP and outlined reward progress, compact orange streak values;
  settings and learning metadata stay neutral. Public profiles/follow controls,
  followers/following and comments use shared actions and readable state styling.
- Photo preview/camera: unchanged flow, neutral media framing, white loading icon,
  indigo visibility selection/actions, green confirmed capture and yellow receipts.
- Vocabulary/Past Words: neutral entry/cards, indigo navigation/filter selection,
  green captured indicator and small yellow +10 XP opportunity badges.
- Discover/Search: photos remain dominant. A compact orange search icon adds
  exploration energy; metadata stays secondary/neutral. Search category selection
  uses indigo plus filled icons; rating choices/checkmarks remain indigo.
- Inbox: neutral read/unread cards, with weight, unread dot and accessibility label
  carrying state. Bell/unread badge is indigo; notification icons stay neutral.
- Moderation, empty/loading/error states, tabs and sheets use the same semantic
  palette. Loaders/selected tabs are indigo; errors are red; overlays remain neutral.

## Hardcoded colors and native assets

Removed the fixed #101820 camera backdrop and #FFFFFF camera spinner from the
component; they now use media tokens. Legacy green brand/tint values no longer
occur in runtime UI sources. Native light/dark splash backgrounds now match
#F7F8F4 / #111D21; a test keeps these static Expo values aligned with the theme.
Android's configured fallback background also uses the neutral light color; the
existing background image still takes precedence. Existing PNG/SVG/Icon Composer
artwork is preserved, including the existing app/splash marks and Google artwork.

The only remaining raw component colors are Google's prescribed button values
(#FFFFFF, #1F1F1F, #747775); those and its logo/interaction styling are preserved.
The new theme supports a future #5B5CF6 / #FF7048 / #F4C542 logo without requiring
any logo changes in this task. No native capability/permission/module changed.
A native rebuild is needed to ship updated splash configuration; ordinary Metro
refresh covers runtime theme changes. Personal Team push suppression is preserved.

## Verification and physical acceptance

Final local verification passed:

- `npm run check`: TypeScript, zero-warning ESLint, formatting, **758 application
  tests across 66 suites**. New coverage includes 13 contrast/config checks and
  two light/dark action/reward presentation tests, live theme switching, readable
  disabled actions, reward announcements and existing progression interactions.
- `npm run doctor`: **21/21**. `npx expo install --check`: dependencies up to date.
- `npm run export:check`: **iOS, Android and web passed**, using nonfunctional
  localhost public fixtures with dotenv disabled.
- `npm run security:scan`: **424 source/config/bundle files and both decoded
  Hermes bundles passed**, with no privileged credentials/server implementation.
- `git diff --check`: passed. Dependencies/lockfile, backend, service/cache logic,
  permissions and logo assets have no changes. No DB/function suite was needed
  for this presentation-only diff.

A focused camera-cancellation test initially hit its async timeout; the unchanged
case passed on the isolated rerun and both full application runs. The new disabled
control test fixture needed a native View root rather than a Fragment for React
Native Testing Library event traversal; its original denial assertions remain.
Existing navigation fixtures still warn about their missing Past Words mock route;
the actual route is present and the platform exports passed. Local verification
logs are in `/private/tmp/langtify-colors-*.log`.

Physical iPhone review is required before considering this identity final:

1. Compare light/dark mode live across auth, onboarding, Today, Discover, Vocabulary,
   Past Words, Profile, public profiles, connections, inbox and comments.
2. Confirm neutral areas dominate and orange/yellow remain intentional accents;
   check a dense feed, many unread notices and a fully completed challenge.
3. Check primary/secondary/destructive controls at rest, pressed, disabled and busy;
   native switches, text selection, keyboard focus and error/confirmed-success states.
4. Verify 0/1/2/3 completion, XP receipts, current/longest streak and next-level
   progress remain distinct without relying on color. Check zero and near-zero XP.
5. Use large text, VoiceOver, Increase Contrast and Differentiate Without Color;
   inspect yellow badge wrapping, tap targets and safe areas on a small screen.
6. Check real photos and camera exposure extremes, sheets/overlays, Google Sign-In
   appearance, and native launch in light/dark mode after rebuilding.

No physical review, native rebuild, hosted deployment, commit or push is implied.
