# Password recovery

Implemented for the installed Expo native app. No hosted Auth/OAuth/SMTP setting,
password policy, migration, Edge Function or dependency is changed. Production is
`lfdgjewypbhukjrtwsef`; neither hosted project is accessed by the automated tests.

## Flow and authority

Sign in → Forgot password? → Reset password sends
`resetPasswordForEmail(email, { redirectTo: 'langtify://auth/callback' })` through a
separate PKCE Supabase client. Confirmation is neutral about account existence.
The existing six-to-72 UTF-8-byte password policy also applies to the new password.

The existing native intent and web-entry sanitation keep callback credentials out
of Router parameters/history. The callback bridge first checks for a pending
recovery attempt; otherwise it retains the existing Google coordinator. A recovery
attempt stores only its random identity, creation time, one-time exchange phase
and SDK PKCE verifier material, scoped to the Supabase project and installation.
It does not persist the email, password or recovery session tokens.

A strict callback code is exchanged with that attempt's client. The exchange must
report the SDK's recovery redirect type, derived from the locally retained PKCE
recovery verifier, not a caller-provided URL type. Recovery session data stays in
memory in this isolated client, never enters the main signed-in session or unlocks
onboarding/private app data. Only the admitted recovery state enables Set new
password. `updateUser({ password })` runs on this same client. Success clears the
recovery material and offers Sign in; the normal login flow remains unchanged.

Main Auth intents, account events and Google starts invalidate recovery work.
The existing mutation serialization and browser intent coordination fence late
results; an isolated recovery client cannot update a newer main account's password.
Duplicate callbacks and repeated submissions do not replay writes. Unknown update
outcomes offer sign-in/new-link recovery rather than automatic mutation retries.
Provider error bodies and callback credentials are never displayed or logged.

PKCE requires opening the email link on the installation that requested it. A
cold restart before opening the email retains the verifier. Restarting after the
one-time exchange loses the in-memory recovery session: request a fresh link.
Older/replayed/expired/malformed links fail safely. An existing signed-in account
is not replaced by a recovery link; sign out and request a fresh link first.

The configured redirect is native-only. Web retains its existing login/signup
behavior and directs reset requests to the installed app. Full browser recovery
would require an independently configured, allowlisted web callback; none is added
here. See [Supabase PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow).

## Automated verification

- `npm run check`: controller, isolated-client, recovery-form and navigation tests,
  plus existing login/signup OTP/Google/session regressions.
- `npm run test:auth:integration`: existing Auth integration followed sequentially
  by the new `scripts/test-password-recovery-integration.mjs` fixture. It creates
  only a local test user, requests a real email into local Mailpit, follows its
  confirmation URL, exchanges the PKCE code, observes PASSWORD_RECOVERY, checks
  policy rejection, updates the password, verifies old/new password login and
  rejects code replay. The user and captured fixture message are removed.
- `npm run export:check`, `npm run security:scan`, Expo compatibility/Doctor and
  `git diff --check` are recorded in the task handoff. Exports are not device tests.

Local Auth's existing allowlist may redirect its confirmation to localhost rather
than the native scheme. The integration checks the returned code and actual Auth
exchange, while navigation tests exercise the native callback route. The manual
check below is still required for the real Production email → OS → app handoff.

## Manual Production acceptance (not performed)

1. Use a native Langtify build containing this change, configured with Production
   URL `https://lfdgjewypbhukjrtwsef.supabase.co` and its public publishable key.
   Confirm the project reference before testing. Use an existing dedicated test
   account with a known password; do not use another person's account. No service
   credential belongs in this build. Expo Go is not the custom-scheme acceptance
   environment.
2. Sign out. Open Sign in → Forgot password? Enter an invalid email: verify an
   inline validation error and no send. Enter the test account's email and send:
   verify loading, disabled duplicate submission and neutral confirmation.
3. Open the newest Production reset email on the same device/installation. Tap
   its reset link. Verify Langtify opens Set new password, with no account tabs or
   onboarding displayed. Do not paste or log the email URL/code.
4. Try a password below six UTF-8 bytes, then mismatched confirmation. Both must
   be rejected locally. Enter matching valid new passwords and submit once.
   Verify Password updated → Sign in. Check old-password rejection and successful
   new-password login to the same account/profile.
5. Repeat with a fresh request, force-close the app before opening the email,
   then open the email: verify cold-start routing and successful reset.
6. Reopen a consumed link, use an expired link, and open a link on an installation
   that did not request it. Verify safe failure and a path back to request a new
   link. Force-close after reaching Set new password: a new link is required.
7. Request a reset, then sign in normally (also test Google) before opening its
   email. Verify the current account is preserved and the old recovery cannot
   update it. Repeat with network loss during send/exchange/update; there must be
   no automatic password-update replay or raw provider error.
8. Request for an unused email and compare confirmation wording. Verify rate-limit
   errors remain safe. Recheck ordinary password login, signup OTP, Google PKCE,
   keyboard behavior, VoiceOver, dark mode and small-screen layout on iOS/Android.

Production delivery, deep linking and physical-device acceptance remain manual;
no claim of a successful hosted password reset is made by local tests.

## Results (2026-10-06)

- `npm run check`: TypeScript, ESLint, formatting and 989 tests / 82 suites pass.
- `npm run test:auth:integration`: existing session/signup OTP tests and new real
  local recovery fixture pass. No hosted Auth test was performed.
- Fresh iOS, Android and web exports pass. Credential scan passes for 529
  source/config/export files and both decoded Hermes bundles.
- `git diff --check` passes.
- Expo Doctor: 20/21. SDK compatibility reports eight existing recommended patch
  updates (expo, expo-auth-session, expo-camera, expo-constants,
  expo-image-manipulator, expo-linking, expo-notifications, expo-router).
  Dependencies were not changed. Physical Production acceptance remains pending.

## Files in this patch

- `app/forgot-password.tsx`
- `app/set-new-password.tsx`
- `app/_layout.tsx`
- `app/auth/callback.tsx`
- `src/features/auth/auth-screen.tsx`
- `src/features/auth/oauth/runtime.ts`
- `src/features/auth/oauth/oauth-bridge.tsx`
- `src/features/auth/recovery/client.ts`
- `src/features/auth/recovery/controller.ts`
- `src/features/auth/recovery/screens.tsx`
- `tests/password-recovery.test.ts`
- `tests/password-recovery-client.test.ts`
- `tests/password-recovery-screen.test.tsx`
- `tests/navigation.test.tsx`
- `tests/oauth-linking.test.tsx`
- `scripts/test-password-recovery-integration.mjs`
- `scripts/test-auth-sessions-integration.mjs`
- `scripts/lib/local-api.mjs`
- `docs/PASSWORD_RECOVERY.md`

Other pre-existing workspace changes are unrelated to this password-recovery pass.
