# Product-copy and authentication UX audit

Scope: interface copy and safe signup recovery only, on the existing uncommitted
motion/SDK patch work. No Phase 11, deployment, hosted configuration write, vocabulary
edit, migration, new dependency or account-linking feature is included.

## Signup finding and fix

Supabase can return an obfuscated user and no session when email signup reuses an
existing OAuth email, without sending verification. The previous copy was conditional
but still said a confirmation email was “on its way.” The form also offered no
verification resend path. See the official
[identity-linking FAQ](https://supabase.com/docs/guides/auth/auth-identity-linking).

New signup completion:

- Heading: **Check your inbox**.
- Conditional guidance: **If you can create an account with this email, you’ll receive
  a verification link. Open it, then return to sign in.**
- Spam-folder guidance and a reminder to use the usual sign-in method if already joined.
- **Resend verification**, **Sign in**, **Use another email**, and the existing
  **Continue with Google** entry.

Identical UI is used for no-session success, empty/obfuscated identities and known
account-existence errors. The client never inspects identities or probes an email.
An actual session follows the existing authoritative session/onboarding gate.
Resend calls only Supabase's supported `resend({ type: 'signup', email })`, uses the
submitted email and existing Auth serialization, and requires a manual tap. No
password replay, auto retry or new session-installation path is added. Known no-op
resend outcomes remain neutral; rate limits and transport errors have safe recovery
copy. Inputs/actions cannot overlap while a request is pending; unmounted results
cannot change another screen. A password sign-in needing verification exposes the
same manual resend, retired if the user edits the email.

## Google and password identities

Supabase remains the sole identity-linking authority. Signup is not an add-password
operation, and Google users should continue with Google. No custom email merge or
client profile creation was introduced.

Recommended separate Account/Security work: an authenticated “Set password” flow
using Supabase `updateUser({ password })` on the existing user, with current-session
checks and any server-required reauthentication. It must keep the same user/profile
and must not infer password availability from the mere presence of an email identity.
A forgotten-password flow also needs dedicated secure recovery routing and tests;
there is no working reset route to link to today. These are proposed scope additions,
not silently implemented controls. Supabase documents the supported OAuth-to-password
operation in the same identity-linking FAQ above.

## Hosted Dev configuration evidence — 2026-09-26

The authenticated CLI's explicitly read-only `supabase config diff --output-format
json` succeeded. Its project target matches the app's Dev endpoint. Only safe policy
facts were inspected; no secrets, SMTP credentials or raw Auth responses are in this
report or the repository.

- Minimum password length: **6**, equal to the explicit local setting.
- Required character groups: **none**, remote `password_requirements: null`.
- Recorded Auth version: **v2.196.0**. Exact UTF-8 length validation remains 6–72.
- **Custom SMTP: unconfirmed.** This CLI projection does not establish whether Dev
  uses built-in email, custom SMTP or a Send Email hook.
- **Leaked-password protection: unconfirmed.** The CLI projection omits that flag.

Automatic approval review rejected extracting the existing CLI credential from
Keychain for a direct Management API GET because credential extraction was not
specifically authorized. It was not retried through another credential path. The
user was asked for non-secret Dashboard confirmation of SMTP and breach protection.
No test signup/email was sent to hosted Dev and no provider was configured/purchased.

Arbitrary-tester email delivery cannot be certified yet. If Dev uses Supabase's
built-in sender, it is limited to authorized team addresses and a small email quota;
custom SMTP is a pre-beta requirement for general testers. If a custom sender/hook
already exists, verify its sender domain, limits and real delivery before acceptance.
See [Supabase email configuration](https://supabase.com/docs/guides/auth/auth-smtp).
Check confirmation templates and the hosted confirmation landing URL too. This pass
retains existing redirects and never routes email recovery into the Google callback.

## Password and safe-error UX

Before signup, guidance reads **Use 6–72 characters. Accents and emoji can count as
more than one.** Live feedback shows **Use a longer password**, **Length requirement
met**, or a request to shorten it. This keeps the exact existing UTF-8 acceptance
bounds, including valid two-character Unicode examples, without encoding jargon or
invented uppercase/number/symbol rules. Passwords are never trimmed. Existing sign-in
still accepts any nonempty password for server validation.

Known breach rejection: **This password has appeared in a data breach. Choose a
different password.** This is supported even while the hosted enablement is unknown.
Other field/provider errors map to stable copy; username editing no longer displays
arbitrary errors from its Auth refresh path. The root route now uses a safe error
boundary instead of Expo Router's default message-rendering fallback. It offers
retry without displaying the error, stack, provider details or route parameters,
including when retry fails. See [PASSWORD_POLICY.md](PASSWORD_POLICY.md).

## App-wide review

| Area                          | Change                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| Auth/session                  | Neutral verification, manual resend, concise errors, removed marketing taglines                  |
| Onboarding/learning           | Translation/learning language labels; timezone selection without IANA jargon                     |
| Today/progress                | Specific recovery actions, shorter missing-word errors and clear XP state                        |
| Camera/library/photos         | Value-led permission text, Add photo, honest sharing/deletion consequences                       |
| Vocabulary/Past Words         | Photos instead of capture records; shorter empty/retry guidance                                  |
| Discover/Search/profile posts | Readable loading/unavailable states; reduced sorting/empty-state copy                            |
| Ratings/comments              | Existing five meanings retained; removed tap tutorials/repeated sort caption                     |
| Profile/follows               | Profile photo terminology, safe save errors, concise actions, less empty-state text              |
| Inbox/reminders               | Today’s words are ready; distinction between in-app updates and remote reminders                 |
| Safety/moderation             | Private-report/block consequences; readable reason/status/action labels, including accessibility |
| Sharing/services              | No sensitive URL sharing; reviewed visible typed errors and hid raw profile errors               |

All route/component/shared-service strings were inventoried, including native permission
strings. Internal parsing/validation diagnostics remain internal. Existing server push
copy (“Today's 3 words are ready” and streak reminders) was reviewed and retained;
notification generation and the at-most-one-attempt contract are unchanged.

## Verification

Completed checks:

- `npm run check`: TypeScript, ESLint and Prettier pass; **808 tests pass across
  69 suites**. Includes neutral signup/resend responses, request exclusion, live
  password requirements, safe error boundaries, destructive confirmations and
  existing auth/onboarding/navigation/privacy regressions.
- `npm run test:auth:integration`: real local Auth session refresh/isolation,
  repeated password login with one profile, older-session sign-out isolation and
  exact 6/72 UTF-8 password boundaries pass. No hosted test accounts were created.
- `EXPO_NO_DOTENV=1 npm run doctor`: **21/21** checks pass.
- `EXPO_NO_DOTENV=1 npx expo install --check`: dependencies are up to date.
- `npm run export:check -- --clear`, with dotenv disabled and public local test
  configuration: **iOS, Android and web pass**.
- `npm run security:scan`: **444 source/config/bundle files and two decoded Hermes
  bundles pass**; no privileged credentials or server implementation in exports.
- `git diff --check`: passes.

No schema, database function or Edge Function changed in this copy pass. Existing SDK patch
and motion changes remain in the working tree; this pass added no dependency.
The local Auth runner emits an existing Node module-type warning, and navigation
test fixtures emit an existing missing `past-words` route warning; neither fails
the checks or represents a missing application route.

## iPhone acceptance

Rebuild to pick up changed native camera/photo-library purpose strings (and the
previous motion pass's Haptics dependency); preserve the Personal Team push flag.

```sh
LANGTIFY_DISABLE_IOS_PUSH=1 npx expo prebuild --platform ios
LANGTIFY_DISABLE_IOS_PUSH=1 npm run build:ios:dev
```

1. Existing Google email → email signup: neutral inbox guidance; Google returns to
   the same user/profile. Never show “email sent” or reveal that the address exists.
2. Fresh allowed tester email: verify actual delivery, spam handling, confirmation
   landing and return to password sign-in. Check unconfirmed-account resend.
3. Try resend twice quickly, a provider limit, offline requests, switching auth
   screens and Google cancellation. No overlap, stale message or session replacement.
4. Try short, ordinary, Unicode and overlong passwords. Verify readable live status,
   field errors and VoiceOver; no extra character rules. Test breach errors if enabled.
5. Check light/dark, large text, keyboard layout and truncation across all tabs,
   Search, profiles/lists, comments, notifications and moderation as authorized.
6. Check camera denial/limited library/cancellation, daily vs historical deletion,
   private/public labels, reporting/blocking and unchanged progress/recovery behavior.
7. Inspect sharing text and confirm no signed photo URL or account token is shared.
8. Exercise a controlled screen error in a test build: safe retry guidance only,
   without provider messages, route parameters or stack traces.

SMTP/delivery confirmation, optional security-flow scope and physical acceptance
remain open. No commit, push or deployment has been performed.
