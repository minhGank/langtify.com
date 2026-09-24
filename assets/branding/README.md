# Langtify artwork

`langtify-wordmark.svg` is the user's original artwork. Keep its lettering and marks
unchanged. Generated PNGs avoid adding a native SVG dependency:

- `wordmark-light.png`: transparent, trimmed indigo artwork for auth/onboarding/session and iOS splash.
- `wordmark-dark.png`: same paths in the theme's dark primary `#8B8CFF`.
- `foreground-light.png` / `foreground-dark.png`: centered on transparent 1024px
  canvases, artwork 640px wide to fit Android adaptive/splash masks.
- `icon.png`: opaque white 1024px square, without baked-in rounded corners.
- `monochrome.png`: the same alpha silhouette for Android themed icons.
- `favicon.png`: 64px web icon.

The complete wordmark is preserved even in the launcher icon. Its lettering is
necessarily small at home-screen/favicon sizes; review on device before choosing
any future compact mark. No new symbol or typeface has been substituted.

To regenerate, install the conversion tool outside the app, then run from the
repository root (no application dependencies or lockfile changes):

```sh
npm install --prefix /private/tmp/langtify-brand-tools --no-audit --no-fund --package-lock=false sharp@0.34.5
node scripts/generate-brand-assets.mjs /private/tmp/langtify-brand-tools/node_modules/sharp
```

The native configuration now points to these assets, including the explicit iOS
icon override. The unused Expo template assets are no longer configured.
Runtime logo updates appear after Metro reload; native splash/launcher changes
require regenerating and rebuilding the native project. For the Personal Team:

```sh
LANGTIFY_DISABLE_IOS_PUSH=1 npx expo prebuild --platform ios
LANGTIFY_DISABLE_IOS_PUSH=1 npm run build:ios:dev
```

Review sign-in, sign-up, onboarding and session restore in light/dark mode, then
cold launch and the home-screen icon. Native build and device acceptance are
separate from bundle export; no deployment is implied.
