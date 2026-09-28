# QA #25 — Auth design and signup email codes

## Six-digit Dev standardization

The user has specified **`EXPO_PUBLIC_SIGNUP_CODE_LENGTH=6`** for hosted Langtify Dev.
Local and example app configuration now use that value. This is the app's single
length source: digit-only state normalization, truncation, native maximum length,
visual slot count, accessibility hint and Verify eligibility all derive from it.
One native input retains autofill/paste and accessible editing; its slots are
presentation-only and hidden from screen readers. Exactly six digits enables Verify
immediately; fewer digits disables it. Wrong/expired errors, resend, explicit submit
and guarded session admission are unchanged. No hosted Auth setting was changed.
Restart Metro after changing the public setting; no native rebuild is needed.
Physical paste/autofill and hosted six-digit email acceptance remain pending.
The original rollout instructions below remain applicable to template/delivery checks.

Regression coverage verifies native `maxLength`, configured slot count, a single
accessible input, incremental typing, overlength digit input, leading zeroes,
non-digit paste sanitization, immediate Verify enablement and disablement after
backspace. Configurations of 6, 8 and 10 digits ensure components derive their
limits rather than hardcoding six. Existing wrong/expired/rate-limit/retry and
single-flight verification tests still pass. `npm run check` passed TypeScript,
lint, formatting and **967 tests / 79 suites**; local Auth integration also passed
real signup/wrong/replayed/expired-code, resend and session regressions. Doctor
passed 21/21 and SDK compatibility passed. Fresh iOS/Android/web exports with
code length 6 passed, followed by the credential/bundle scan (495 files and both
decoded Hermes bundles) and `git diff --check`. No hosted configuration was accessed.

App implementation only; no Phase 11, dependency/native configuration, schema,
Edge Function, hosted Auth change, commit, push or deployment. Existing QA work
is preserved. Hosted email delivery and physical acceptance remain pending.

## Design

Sign in and Create account use a restrained 136-point wordmark, distinct headings,
quiet supporting copy, a focused email/password form and one indigo primary action.
Google sits below a small divider; account-mode navigation is at the bottom. Content
has a 440-point maximum width and flexible vertical spacing, with scrolling on
small screens, existing keyboard avoidance and safe areas. Neutral surfaces and
existing semantic tokens support light/dark mode without new colors or animations.

Email Next focuses Password. Password Go submits; the accessible 48-point visibility
toggle does not change the value or autofill semantics. Signup retains the audited
6–72 UTF-8-byte policy, human-readable guidance and live length feedback. No new
password requirement, password-reset or account-linking UI is introduced.

Auth-mode links replace routes instead of stacking duplicate forms. Verification
is transient state on the current auth route: no email/code/token is in Router
parameters or storage. Change email returns to the form with its password cleared.
Android Back returns from verification to the form when idle; pending verification
cannot navigate into an ambiguous session. Successful verification emits through
the existing session provider and authoritative onboarding gate, not a manual route.
Google stays mounted across form/confirmation transitions; PKCE and callback rules
remain unchanged.

## Supported contract and rollout guard

The installed Supabase JS SDK supports `signUp({ email, password })`,
`resend({ type: 'signup', email })` and `verifyOtp({ email, token, type: 'signup' })`.
The [email-template guide](https://supabase.com/docs/guides/auth/auth-email-templates)
provides `{{ .Token }}` for code verification. This is email/password confirmation,
not `signInWithOtp` passwordless signup or SMS. No custom code generation/storage.

We intentionally use the narrower `signup` verification type supported by installed
Auth v2.196.0, which checks confirmation tokens only. The general `email` type also
accepts recovery/magic-link codes in that version; those flows are outside this task.
See the [versioned verification implementation](https://github.com/supabase/auth/blob/v2.196.0/internal/api/verify.go)
and [JS verification reference](https://supabase.com/docs/reference/javascript/auth-verifyotp).

Read-only inspection of the running **local** Auth container on 2026-09-26 confirmed
email confirmation enabled, **6 digits**, **3,600 seconds** expiry and a **1-second**
local email-request interval. The UI uses a conservative 60-second manual resend
cooldown; server rate limits remain authoritative. These are local facts, not a
claim about current hosted settings. Supabase supports
[6–10 digits](https://supabase.com/docs/guides/local-development/cli/config#auth.email.otp_length).
Hosted Dev code length, template contents and actual delivery require Dashboard
and fresh-email acceptance. No hosted configuration or credentials were retrieved.

`EXPO_PUBLIC_SIGNUP_CODE_LENGTH` is an explicit, non-secret rollout setting:

- Unset/invalid: keep the redesigned **link** confirmation screen. No fake code input.
- Set to the verified hosted digit count (6–10): enable **code** confirmation.
- It does not configure Supabase or change server code length/expiry/security.
  Changing it requires a Metro restart or a newly exported app JavaScript bundle.

## Exact manual Supabase Dev steps — not performed

1. In **Langtify Dev → Authentication → Email → Templates → Confirm signup**,
   save the current template as the rollback copy. Set the subject to
   **Verify your Langtify email**. Paste [confirm-signup.html](email/confirm-signup.html)
   as the body. Its `{{ .Token }}` displays the code. The secondary
   `{{ .ConfirmationURL }}` link retains compatibility with earlier link-only app
   builds; the new flow uses the code. Do not change Magic Link, recovery or Google
   templates/callbacks. Do not enable passwordless sign-in in the app.
2. Under the **Email provider** configuration, keep **Confirm email enabled**.
   Read the configured **Email OTP length**, **Email OTP expiration** and email
   rate limits. Record them for the acceptance build; do not infer six digits from
   a documentation example or lower security settings to match the UI.
3. Preserve the user-confirmed Resend custom SMTP configuration: sender
   **Langtify <no-reply@langtify.com>**, `smtp.resend.com:465`, username `resend`.
   SMTP password stays only in Supabase settings; never copy it to app configuration.
   The template contains no credentials. Do not enable email click tracking for Auth
   links. Existing redirect URLs and `langtify://auth/callback` remain unchanged.
4. After the template is saved, set `EXPO_PUBLIC_SIGNUP_CODE_LENGTH` in the local
   acceptance build to the exact verified value, for example `6` only if Dev uses
   six digits. Restart Metro with `npx expo start --dev-client --clear`. This is
   public presentation configuration, not a provider secret. Leave normal builds
   unset until the matching template is in place. Do not send a link-only template
   to a code-enabled build.
5. With a fresh tester email, create an account, inspect the actual received code,
   paste it into Langtify and verify onboarding. Confirm sender, spam placement,
   resend and expiry. Dashboard preview and SMTP configuration alone are not proof
   of delivery. Roll back the app setting to unset before reverting to a link-only
   template if needed; no database rollback is involved.

## Verification UX and security

The heading is **Verify your email**. Conditional copy says: “If you can create an
account with this email, you’ll receive a verification code. Enter it below.”
New, obfuscated and known existing-account signup responses all reach identical UI.
We never inspect identities to choose copy or claim an email was sent. Google and
Sign in remain available as alternate methods. Resend uses only the submitted
email, not the original password; success/no-op responses have neutral messaging.

One native code input supports paste, one-time-code autofill and numeric keyboards.
Non-ASCII-digit characters are removed and input is truncated to the configured
length; the full configured numeric length
is required before an explicit Verify tap. There is no auto-submit. Wrong, expired
and nonexistent-user code failures share the same recovery message. Transport and
rate-limit failures get safe retry guidance. Raw provider messages are never rendered.
Resend starts a 60-second cooldown for success, uncertainty and obscured no-ops;
it never sends automatically. Server expiry is not inferred from device time.

Code verification uses an isolated nonpersistent client with bounded network waits.
A returned candidate session is admitted through the existing serialized,
write-guarded session installation/recovery boundary. Auth intents, account events,
new Google attempts, cross-tab intents and screen focus lifetimes fence stale results.
Only non-secret session identity is durable during commit. Failed/interrupted commits
are quarantined and cleaned using exact Auth session identity, preserving newer
sessions. A lost acknowledgement may consume a code; Sign in remains the recovery
path after server confirmation. No automatic verification retry or fabricated session.

Supabase remains the identity-linking authority. Signup cannot attach a password to
an existing Google user. Existing Google OAuth, private data, onboarding and public
RLS are unchanged. No profile is inserted by the client. Account/Security “Set
password” and forgotten-password flows remain separately scoped future work.

## Automated verification

Passed:

- `npm run check`: strict TypeScript, ESLint, formatting and **915 application tests
  across 77 suites**. Covers link/code rollout, six/eight/ten-digit inputs,
  paste/autofill properties, single-flight verification, resend cooldowns,
  enumeration-safe signup/resend/error variants, password visibility, native auth
  navigation, authoritative onboarding and stale session/account/browser intents.
  Existing Google/PKCE and application regressions remain passing.
- `npm run test:auth:integration`: real local Auth session persistence/refresh,
  password policy boundaries, signup confirmation, wrong/expired/replayed codes,
  resend, post-verification password login, exactly one incomplete profile, and a
  Google-origin fixture that cannot acquire a caller-supplied password or identity.
  All fixture Auth users are deleted afterward. No hosted project is touched.
- `EXPO_NO_DOTENV=1 npm run doctor`: **21/21** online checks.
- `EXPO_NO_DOTENV=1 npx expo install --check`: dependencies up to date.
- `npm run export:check -- --clear`: **iOS, Android and web** pass twice, with dotenv
  disabled and local public fixtures, first with code length 6 and then with the
  default blank/link setting.
- `npm run security:scan`: both export variants pass; **480 source/config/bundle
  files and two decoded native Hermes bundles** contain no privileged credentials
  or server implementation.
- `git diff --check`: passes.

The first local integration run reached the Google fixture and returned the supported
`user_already_exists` variant instead of the expected obfuscated success. The fixture
now checks both documented response forms; app tests require identical neutral UI
for both. Password/identity/profile invariants remain asserted. No Auth settings,
security assertions or tests were weakened. UI verification also fixed an unstable
new test gateway fixture and changed obsolete navigation headline assertions to
check the actual Sign in action and route. Existing missing-`past-words` navigation
fixture and Node module-type warnings remain unrelated.

The local integration uses real Auth-generated fixture codes held only in memory,
not a privileged app path. It does not claim delivery of a code email through
hosted Resend. No schema/Storage/Edge Function changed, so the previous SQL/RLS and
photo integration results remain historical rather than claimed reruns here.

## Physical iPhone acceptance

No new native dependency/configuration requires a rebuild of the existing SDK 57
development client. Restart Metro after setting the public rollout value. A standalone
binary needs its normal JavaScript update distribution or a new binary. Google still
requires the already configured native development build and hosted Dev.

1. Sign in/Create account on a small iPhone: light/dark, large text, VoiceOver,
   keyboard avoidance, safe areas, scroll, Email Next, Password Go, password manager,
   Show/Hide, touch targets and Reduce Motion. No repeated auth back-stack entries.
2. Fresh email after template setup: truthful conditional guidance, real sender/code,
   paste/autofill, exact digit count, Verify → onboarding; complete onboarding and
   verify normal authenticated routing.
3. Existing Google email: same confirmation UI with no account-existence disclosure;
   use Continue with Google to reach the existing account, not another profile.
4. Wrong/expired/replayed code, offline verification, rapid repeated taps and provider
   rate limits: safe errors, no duplicate verification, no indefinite loading.
5. Resend: initial/manual cooldown, no automatic email, latest code, spam handling;
   Change email clears code/password; native Back returns predictably to the form.
6. Background to Mail and return; leave while a request is pending; start another
   sign-in or switch browser tabs/accounts. No late session replaces another account.
7. Verify the default unset setting still supports earlier confirmation links;
   existing password sign-in, Google cancel/return and onboarding remain intact.
