# Signup password guidance

QA2-06 mirrors the existing Auth policy. It does not strengthen or change hosted
Auth, change sign-in validation, trim passwords, or change session handling.

On 2026-09-26, an authenticated, read-only CLI configuration comparison against
the linked Langtify Dev project returned:

- `minimum_password_length`: **6**.
- `password_requirements`: **null**, meaning no required character groups.

The linked project matches the app's Dev endpoint. The current CLI comparison
reports no difference for the explicitly declared minimum 6, and reports remote
`null` against the local empty character requirement. This rechecks the 2026-09-21
evidence without creating hosted users or changing configuration.

The running local Auth container uses `supabase/gotrue:v2.196.0`, minimum length 6,
and an empty required-character configuration. The previously implicit defaults
are now explicit in `supabase/config.toml`. The linked project's recorded Auth
version is also `v2.196.0`.

That Auth implementation measures password length in **UTF-8 bytes**, with a
maximum of **72 bytes**. ASCII letters, numbers, spaces and punctuation use one
byte each; accented characters and emoji can use more. The client matches those
bounds rather than accidentally rejecting otherwise valid Unicode passwords by
counting JavaScript UTF-16 units or imposing six visible characters. See the
[versioned Auth strength check](https://github.com/supabase/auth/blob/v2.196.0/internal/api/password.go).

The signup form says “Use 6–72 characters. Accents and emoji can count as more than
one.” This describes the ordinary-character range without exposing encoding jargon;
the live length check still uses exact UTF-8 weight, including short valid Unicode
passwords. It shows “Use a longer password,” “Length requirement met,” or a request
to shorten the password. It never claims a password is secure just because its
length passes. Submission errors remain beside the field. It adds no uppercase, lowercase, number or symbol
requirement. Existing sign-in still requires only a nonempty password before
letting Auth validate the credentials. A server-reported breached-password reason
gets explicit, safe field feedback; arbitrary backend error text is never shown.

The CLI's configuration projection does not expose `password_hibp_enabled`.
Hosted leaked-password protection still remains to be confirmed in the Dev Dashboard;
it must not be inferred from the local container or from the subscription tier.
Read-only verification performed here changed no hosted settings, sent no signup
requests to hosted Auth and exposed no credentials. The
[Management API Auth configuration](https://supabase.com/docs/reference/api/v1-get-auth-service-config)
and [password security guide](https://supabase.com/docs/guides/auth/password-security)
describe the separate length, character and leaked-password settings.

Supabase's public client API does not supply these Dashboard policy settings.
`src/features/auth/password-policy.ts` is a reviewed display/validation mirror,
not an authority. Before changing hosted password settings or pointing a build at
a different project, verify its minimum, required character groups and breach
protection, then update signup guidance/tests in the same rollout. Do not ship
management or service-role credentials to fetch Auth settings from the app.

Verification includes signup guidance and field errors, existing short-password
sign-in, plain lowercase passwords, whitespace preservation, Unicode lengths,
72-byte limits, safe backend feedback, and real local authenticated password
changes through the same Auth strength check. No test creates hosted users or
changes hosted Auth configuration.
