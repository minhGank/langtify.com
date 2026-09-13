# Phase 5.5 — Google authentication verification

Google OAuth is implemented. See [the subsequent audit](PHASE55_AUDIT.md) for hardening changes and current verification results. Phase 6 has not started. Hosted Google consent,
automatic identity linking and physical-device acceptance remain manual; automated
SDK/transport tests are not Google end-to-end tests.

## Changes

Modified files:

- `package.json`, `package-lock.json`: compatible OAuth/development-build dependencies and native build scripts.
- `app.json`: development client/browser plugins and `com.langtify.app` native identifiers; existing `langtify` scheme retained.
- `app/_layout.tsx`: public callback recovery route, with the existing protected groups and startup destination preserved.
- `src/features/auth/auth-provider.tsx`: session subscription/restoration adapter and root callback bridge; existing state machine and foreground refresh retained.
- `src/features/auth/auth-screen.tsx`: Google button alongside password auth; mutually disabled requests.
- `src/features/auth/sign-out-button.tsx`: existing local sign-out through the shared mutation queue.
- `scripts/scan-credentials.mjs`: recognize Google OAuth client-secret patterns as well as existing privileged-key/JWT checks.
- `tests/navigation.test.tsx`: callback navigation, onboarding and protected-route regressions.
- `README.md`, `AGENTS.md`, `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md`: Phase 5.5 scope, setup and identity/security decisions.

New files:

- `app/+native-intent.tsx`: normalize native callback paths without putting codes into Router parameters.
- `app/auth/callback.tsx`: callback progress/error/retry navigation.
- `src/features/auth/oauth/callback.ts`: exact callback and Google/S256 authorization validation.
- `src/features/auth/oauth/coordinator.ts`: one pending login, expiry, replay/cancellation and generation guards.
- `src/features/auth/oauth/runtime.ts`: persistent attempt storage, guarded session admission, serialized auth mutations and interrupted-commit recovery.
- `src/features/auth/oauth/pkce-attempt.ts`: Supabase SDK staging exchange; discard staged session persistence and dispose SDK listeners.
- `src/features/auth/oauth/oauth-bridge.tsx`: warm/cold linking and web URL cleanup.
- `src/features/auth/oauth/return-queue.ts`: handoff from native intent to the mounted bridge.
- `src/features/auth/oauth/google-button.tsx`: accessible Google button, cancellation and safe errors.
- `src/lib/oauth-crypto.ts`: required secure native random/SHA-256 primitives for S256 PKCE.
- `assets/images/google-g.png`: official Google G, unchanged colors/proportions.
- `tests/oauth-coordinator.test.ts`, `tests/oauth-linking.test.tsx`, `tests/oauth-pkce.test.ts`, `tests/oauth-runtime.test.tsx`: behavior and SDK integration tests.
- `docs/PHASE55_VERIFICATION.md`: this handoff.

No migrations, RLS, identity tables, server functions, product rules, public env names
or `.env.local` changes. No Google secret, manual linking or custom merging.

## Dependencies and development builds

Installed using:

```sh
npx expo install expo-dev-client expo-web-browser expo-auth-session expo-crypto
```

| Direct addition     | Version range | Purpose                                           |
| ------------------- | ------------- | ------------------------------------------------- |
| `expo-dev-client`   | `~57.0.19`    | Native development build with the custom scheme   |
| `expo-web-browser`  | `~57.0.3`     | System browser OAuth session on native            |
| `expo-auth-session` | `~57.0.12`    | Expo-supported redirect generation                |
| `expo-crypto`       | `~57.0.3`     | Secure randomness and native SHA-256 PKCE support |

The install completed dependency changes but could not auto-edit dynamic Expo
configuration; the browser plugin was added explicitly to `app.json`, then the
resolved configuration, dependency compatibility and Doctor checks passed.

From `/Applications/langtify.com`:

```sh
npm ci
# Retain existing .env.local; use hosted Langtify Dev public URL and key.
# macOS with Xcode; connect/unlock/provision the iPhone and enable Developer Mode.
npm run build:ios:dev
# Android SDK/Studio; connect/unlock phone, enable USB debugging and approve host.
npm run build:android:dev
# After the native app is installed, subsequent JavaScript development:
npm run start:dev
```

Build scripts are exactly `expo run:ios --device` and `expo run:android --device`.
Select the connected phone when prompted. Expo prebuilds absent native projects;
`ios/` and `android/` stay ignored. For simulators use `npx expo run:ios` or
`npx expo run:android` with a running emulator. Native dependency, scheme or plugin
changes require rebuilding the development client. If generated projects already
exist, regenerate them with `npx expo prebuild --clean` before rebuilding only if
you have no native edits to preserve; this command replaces generated projects.
EAS setup is not required for these local commands. Provisioning, native toolchains
and phone connectivity are developer prerequisites. Expo Go explicitly disables
Google login and explains the development-build requirement.

See [Expo local development builds](https://docs.expo.dev/develop/development-builds/create-a-build/).
Apple Sign-In remains deferred until Apple Developer membership is available;
this does not add Apple authentication or attempt App Store submission.

## Flow and identity

1. The button starts one Supabase `signInWithOAuth({ provider: 'google' })` request.
   Expo generates the native `langtify://auth/callback` return. The URL must be a
   Google S256 authorization on the configured Supabase project.
2. A random attempt ID, SDK flow ID and verifier are kept locally. The system auth
   browser asks Google to select an account. Google returns to Supabase's provider
   callback; Supabase returns a single-use code to Langtify.
3. A matching, unexpired pending attempt claims the code once. The staging client
   exchanges with its explicit PKCE flow ID; its session never enters app storage.
   Wrong redirects, implicit token URLs, provider errors, missing/malformed codes,
   old attempts and duplicate delivery cannot admit a session.
4. Serialized admission checks the current account/generation, installs only the
   candidate session and then emits into the existing session provider. Cancellation
   during installation suppresses its events and rolls it back. A durable marker
   recovers interrupted/failed rollback before session restoration/refresh admission.
5. The existing server-validated profile loader chooses onboarding or main tabs.
   Google names/avatars do not satisfy onboarding. Required username, language pair,
   CEFR and timezone remain unchanged.

Confirmed password users with a safely compatible verified Google email may be
linked by Supabase to their existing UUID. Repeated Google login uses that same
UUID and existing data. The app never performs email matching or profile creation
on login. Actual Google linking behavior belongs to Supabase and must be verified
with real hosted identities; see [Supabase identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking).

Password methods, validation and errors are preserved. Both password and Google
sessions use the original native/browser persistence, token refresh and account
state machine. Local Supabase sign-out clears Langtify state, without revoking the
Google account. Challenge/photo/progress requests retain their existing JWT binding
and stale-response guards.

Web uses a full-page redirect, secure browser storage and Web Locks for cross-tab
coordination, with PKCE material scoped to sessionStorage in the
originating tab. The callback is that origin's `/auth/callback`; query data is
removed before Router initialization. Reloading or returning in a different tab without the pending
verifier fails safely and requires a new login.

## Automated verification

Run date: 2026-09-13. Local database tests use disposable fixtures and do not log
privileged keys. Actual hosted Google login was not performed.

| Check                                                        | Result                                                                            |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `npm run check` (typecheck, lint, format, application tests) | Passed; 207 tests in 24 suites                                                    |
| `npx supabase test db /private/tmp/langtify-db-tests/`       | Passed; 355 assertions in 8 suites                                                |
| `npm run db:test:integration`                                | Passed; 5 onboarding/username/migration checks                                    |
| `npm run db:test:challenges`                                 | Passed; 4 concurrency/catalog checks                                              |
| `npm run db:test:submissions`                                | Passed; 10 real Auth/Storage/recovery checks                                      |
| `npm run db:test:photo-audit`                                | Passed; 6 image/signing/expiry/concurrency checks                                 |
| `npm run db:test:progress`                                   | Passed; 7 checks                                                                  |
| `npm run db:test:bootstrap`                                  | Passed; 7 checks                                                                  |
| `npx supabase db lint --local --level warning`               | Passed; no schema errors                                                          |
| `npx expo install --check` (online)                          | Passed; dependencies up to date                                                   |
| `npm run doctor`                                             | Passed; 21/21                                                                     |
| `npx expo config --type public --json` + assertions          | Passed; `langtify`, `com.langtify.app` on both native platforms, iOS/Android/web  |
| `npm run export:check -- --clear`                            | Passed; iOS/Android Hermes and web, including `/auth/callback`                    |
| `npm run security:scan`                                      | Passed; source/config/web and 2 decoded Hermes bundles, no privileged credentials |

The documented SQL runner fallback copies `supabase/tests/*.sql` into
`/private/tmp/langtify-db-tests/` because Docker does not share this workspace path.
No new migration is required. The bootstrap suite still replays migrations in a
disposable database. Existing Node module-type/color warnings are unrelated to
Google authentication; lint and Doctor themselves report no issues.

New tests cover repeated taps, safe errors, cancellation/retry/unmount, exact
callbacks, warm/cold return, replay, expiry, stale exchange/installation, cancellation followed by a new callback while the old exchange is pending, password
switching, interrupted commit and foreground refresh races, unchanged authoritative
onboarding/profile reads, same-user repeated login and local sign-out. The actual
installed Supabase SDK is tested against a stub Auth HTTP response to verify S256,
flow-specific verifier exchange, consumed-flow rejection and absent staged session
persistence. It does not simulate Google consent to claim end-to-end coverage.

## External steps still required

1. Keep the current `.env.local` public variables:
   `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`. Use the hosted
   **Langtify Dev** values for Google; no new app-side OAuth variable is required.
2. The user reports Google is enabled, its Web Client ID/secret are in Supabase,
   the Google Cloud callback is configured, and `langtify://auth/callback` is
   allowlisted. These were not changed or independently accessed. If login is
   blocked, verify those exact settings in the hosted development project. The
   Google Cloud provider callback must remain the Supabase `/auth/v1/callback`,
   distinct from the app's native return URL.
3. If Google Cloud's consent app is in testing mode, ensure the chosen Google
   accounts are permitted test users. Do not enable manual identity linking.
4. Build/install both native development clients using the commands above, then
   run the checklist below. Local database/Auth/Storage regressions still use local
   Supabase; local Google provider settings were not rewritten.
5. For web OAuth only, add the exact development browser callback to Supabase's
   redirect allowlist (for example `http://localhost:8081/auth/callback`; use the
   actual port). A future deployed web origin needs its HTTPS `/auth/callback`,
   served from the export. No hosted web configuration was changed in this phase.

## Physical-device acceptance — run on both iOS and Android

- [ ] Start a freshly installed Langtify development build. Verify the Google G,
      Continue with Google, email/password form and correct dark/light presentation.
- [ ] Sign in and sign up through email/password; verify confirmation handling,
      existing onboarding and sign-out still work.
- [ ] Tap Google repeatedly: exactly one browser opens; password controls and extra
      Google taps are disabled. Cancel in the browser, then retry successfully.
- [ ] With a new Google account, complete consent. Verify existing onboarding asks
      for username, reference/target languages, CEFR and timezone. Google profile
      metadata must not bypass any field. Complete onboarding and reach Today.
- [ ] Relaunch/foreground the app; verify session restoration and token refresh,
      with unchanged account data and no onboarding flash.
- [ ] With an existing confirmed password account whose verified email matches
      Google, record the authoritative Supabase user UUID and existing profile,
      challenge/photo and XP totals before login. Sign out, then use Google. Check
      Supabase's linked identity retains that UUID and all existing data, with one
      profile. If linking differs, investigate provider verification/settings; do
      not manually merge, link or change application identity policy.
- [ ] Sign out and repeat Google login to that same account. Verify the same UUID,
      profile and XP/challenge history; no duplicate rows or awards.
- [ ] Sign out of account A, select Google account B. Verify only B's profile,
      challenges, photos and progress appear. Repeat while old account reads are
      slow/offline; no stale A results should appear.
- [ ] Verify warm return with Langtify already running. For cold return, open Google,
      terminate Langtify without pressing its Cancel button, then finish browser
      login so the callback launches the development build and restores PKCE state.
- [ ] Cancel/back out during login or during a slow exchange; then finish an older
      browser flow. It must not sign in or replace a newer session. Sign in again
      successfully. Sign-out must return to auth and clear account-scoped content.
- [ ] Decline consent, interrupt connectivity, and return an invalid/expired link.
      Verify a safe error and retry, with no protected content or raw SDK details.
      Do not paste real callbacks/codes/tokens into logs, issues or screenshots.
- [ ] Re-deliver a used callback locally without recording its contents: no second
      exchange/account change. Allow a pending flow to exceed ten minutes and verify
      a fresh sign-in is required. Test a callback in Expo Go: no false success.
- [ ] Background/resume during the browser and after admission, then force-restart.
      Confirm no orphaned spinner, false authenticated screen or account mix-up.

## Remaining risks and closure

Automated checks cannot certify Google Cloud consent policy, hosted identity
linking, iOS browser return, Android intent delivery, provisioning or real network
interruptions. Native binary compilation and physical Google login were not run
here. Complete both-platform acceptance before closing Phase 5.5 for device use.

Custom schemes are not verified universal/app links; PKCE limits intercepted
codes, but another installed app claiming the scheme can disrupt delivery. Native
session/PKCE storage retains the existing AsyncStorage protection level; browser
storage retains the normal XSS/secure-origin requirements. A lost/expired/consumed
pending login requires starting again. Persistent storage or network failure during
rollback fails closed and may require retry/restart. No production signing, store
release, Apple login or Phase 6 work is included.
