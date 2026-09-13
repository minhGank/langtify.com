# Phase 5.5 Google authentication audit

Audit date: 2026-09-13. Scope: OAuth security, callback handling, session admission,
account isolation, identity behavior and regressions. No Phase 6 work, product-policy
change, new identity store, provider configuration change, dependency addition or
SQL migration is included. The working tree already contained the Phase 5.5
implementation; those changes were preserved.

## Findings and fixes

### 1. High — guarding auth events did not guard SDK persistence or other tabs

The installed auth SDK saves a session and broadcasts `SIGNED_IN` before returning
from `setSession`. The original adapter withheld its local subscribers, but a
cancelled response could still write shared session storage temporarily, and another
browser tab could receive that session before admission/rollback. A stale write
could also overwrite a newer session established outside the local mutation queue.

The shared SDK now uses a storage guard during OAuth admission. It checks the
current attempt and existing Auth session immediately before saving, and refuses
to overwrite/delete a different session. Actual installed-SDK tests delay its Auth
HTTP response, then cancel or insert another session: no obsolete session is saved
or emitted. The existing native storage/refresh and password session semantics remain.

Browser app mutations now share an origin/project Web Lock, a non-secret intent
identifier and a shared interrupted-commit marker. Each tab retains its own PKCE
verifier in sessionStorage. Broadcast handling waits for the originating mutation
and reloads the current SDK session before notifying the app. Tests cover accepted
and rolled-back broadcasts, another tab's sign-out/login intent, serialized
mutations and recovery after the originating tab disappears. Google requires secure
browser storage and Web Locks; the password storage fallback remains available.

### 2. Medium — recovery confused two sessions belonging to the same user

A pending `committing` record identified only the candidate user UUID. If that
record survived and the same user subsequently signed in by password, recovery
could sign out the newer legitimate session. A regression reproduced that behavior.

New records identify the Auth JWT's `session_id`; cleanup and event quarantine
match that session, not just its owner. This claim is used only for coordination:
Auth validation and database RLS still decide identity/access. A local Supabase
integration test verifies that refresh retains a session ID, a second login to the
same UUID gets a different ID, one profile remains, and older-session sign-out
preserves the newer session. Legacy pre-audit committing records lack that identifier
and retain conservative one-time cleanup by owner; start a fresh login after upgrade.

### 3. Medium — callback cleanup ran too late on web and missed malformed native links

ExpoRoot captures the web URL during module initialization. Replacing browser
history in a React effect therefore left the original authorization code in initial
Router state. Native links with a trailing slash or another malformed path bypassed
the exact callback sanitizer and could carry code/token parameters into navigation
or not-found diagnostics. Malformed native-link regressions failed before the fix.

The custom `index.js` entry loads the existing URL polyfill, then a platform-specific
web sanitizer, then Expo Router. Web captures the raw callback into the private return
queue and removes sensitive parameters before Router initializes. Its test models
live `window.location` changing during history replacement so code exchange still
receives the original code. Native exact callbacks retain strict validation; other
credential-bearing links go to a clean callback error route without being exchanged.
The native bootstrap uses a no-op web adapter and never assumes browser globals.

### 4. Medium — cancelled pending records could remain valid after failed deletion

Cancellation invalidated memory and attempted removal, but a failed storage deletion
left a `waiting` record eligible for cold-start exchange. Cancellation now first
persists a `cancelled` state. If that write fails, it still attempts removal. Password
and sign-out mutations await cancellation cleanup before proceeding. Regressions cover
failed deletion and failed tombstone writes; neither successful cleanup path can
resurrect a cancelled flow. If all storage operations fail, the operation fails closed
in the running process; no application can promise durable cancellation before a
successful storage write/removal or after abrupt loss of that write.

### 5. Low — unmounting the root bridge did not invalidate active exchange work

The bridge ignored late initial-URL reads after unmount but an already-running
exchange could continue. Final bridge unmount now invalidates the coordinator;
an immediate Strict Mode remount remains supported. Normal navigation from the
login screen to the callback keeps the root bridge mounted and continues the login.

## Reviewed protections retained

- S256 PKCE uses cryptographic randomness, a per-attempt SDK verifier and explicit
  SDK flow ID. No implicit access/refresh-token callbacks are accepted.
- Authorization URLs must use the configured Supabase origin, exact authorize
  endpoint, Google provider, expected redirect and one S256 challenge. Callback
  scheme/host/path and parameter validation prevent an open redirect or arbitrary
  session injection. Duplicate delivery shares the current attempt's exchange;
  consumed/expired/malformed/provider-error callbacks fail safely.
- Password auth, server-validated account reads, required onboarding fields,
  foreground refresh and JWT-bound challenge/photo/progress requests remain intact.
  Google metadata is not onboarding authority.
- Application code performs no `linkIdentity`, manual merge, email-based account
  matching or Google-specific profile creation. `profiles.id` remains the unique
  Supabase UUID; the Auth insertion trigger creates its profile only on user creation.
  Supabase's supported automatic linking remains provider/backend behavior.
- Existing `.env.local` names/values and hosted/local provider settings were untouched.
  Only public credentials enter the app; the existing config validator rejects
  service-role/secret keys. No callback/token logging was added.
- Scheme remains `langtify`; iOS bundle ID and Android package remain
  `com.langtify.app`. Development-client/browser plugins remain configured.

## Verification

| Command/check                                          | Result                                                                                                |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `npm run check`                                        | Passed; typecheck, lint, format and 227 application tests in 27 suites                                |
| `npx supabase test db /private/tmp/langtify-db-tests/` | Passed; 355 assertions in 8 suites                                                                    |
| `npm run db:test:integration`                          | Passed; 5 checks                                                                                      |
| `npm run db:test:challenges`                           | Passed; 4 checks                                                                                      |
| `npm run db:test:submissions`                          | Passed; 10 real Auth/Storage checks                                                                   |
| `npm run db:test:photo-audit`                          | Passed; 6 checks                                                                                      |
| `npm run db:test:progress`                             | Passed; 7 checks                                                                                      |
| `npm run db:test:bootstrap`                            | Passed; 7 checks                                                                                      |
| `npm run test:auth:integration`                        | Passed; 2 real local Auth session/profile checks                                                      |
| `npx supabase db lint --local --level warning`         | Passed; no schema errors                                                                              |
| `npx expo install --check`                             | Passed online; compatible dependencies                                                                |
| `npm run doctor`                                       | Passed; 21/21                                                                                         |
| `npx expo config --type public --json` + assertions    | Passed; scheme, both IDs, plugins, platforms and entry                                                |
| `npm run export:check -- --clear`                      | Passed; final iOS/Android Hermes and web exports                                                      |
| `npm run security:scan`                                | Passed; 181 source/config/bundle files, including 2 decoded Hermes bundles; no privileged credentials |

The SQL runner uses the documented `/private/tmp` copy because Docker does not
share this workspace path. Regression scripts create and remove local fixtures;
no hosted Auth/Google account was accessed. Tests include the actual installed SDK
with controlled Auth HTTP responses plus real local password sessions; simulated
tab coordination is not a claim of physical Google end-to-end coverage. Existing
Node module-type/color warnings are informational; lint and Doctor report no issues.

## Audit changes

- `index.js`, `package.json`: early sanitized Router entry and local Auth integration command.
- `src/lib/auth-session-storage.ts`, `src/lib/supabase.ts`: guarded SDK persistence, session identity and retained browser password fallback.
- `src/features/auth/oauth/browser-coordination.ts`: cross-tab mutation/intent/commit coordination.
- `src/features/auth/oauth/runtime.ts`, `coordinator.ts`: session-specific recovery, durable cancellation and admission checks.
- `src/features/auth/oauth/callback.ts`, `web-entry.ts`, `web-entry.web.ts`, `oauth-bridge.tsx`, `app/+native-intent.tsx`: early link sanitation and lifecycle invalidation.
- `tests/auth-session-storage.test.ts`, `oauth-browser-coordination.test.ts`, `oauth-web-entry.test.ts`, `oauth-runtime.test.tsx`, `oauth-coordinator.test.ts`, `oauth-linking.test.tsx`, `fixtures.ts`: audit regressions and realistic session claims.
- `scripts/test-auth-sessions-integration.mjs`: local Auth session/profile regression.
- `AGENTS.md`, `README.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md`, `docs/PHASE55_VERIFICATION.md`, this report: updated implementation and acceptance guidance.

## Remaining risks and acceptance

Ready for physical-device acceptance. All final checks above passed. This audit
does not close real-device acceptance or certify hosted Google Cloud configuration.
Use the [Phase 5.5 device checklist](PHASE55_VERIFICATION.md#physical-device-acceptance--run-on-both-ios-and-android).
On both iOS and Android, prioritize cancellation followed by force-restart, warm/cold
return, account A → B switching, session restoration, and verified-email password →
Google linking while checking the authoritative UUID and existing data. Reload all
web tabs after upgrading; for web acceptance also test two tabs, cancellation/sign-out
in the other tab, and the absence of callback secrets from URL and navigation state.

Native compilation, Google consent/account selection and actual hosted automatic
linking were not performed. No manual linking should be enabled to bypass a failed
identity test. Custom schemes can be claimed by another app; PKCE prevents that app
from exchanging an intercepted code without the verifier, but delivery can still be
disrupted. Existing AsyncStorage protection and browser XSS/hosting requirements
remain. Native pending records from before this audit may require one fresh login.
Apple authentication, production signing/store submission and Phase 6 remain excluded.

References: [Expo native intent and web routing](https://docs.expo.dev/router/advanced/native-intent/),
[Expo custom entry setup](https://docs.expo.dev/router/installation/),
[Supabase identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking).
Installed `auth-js` source was inspected for `setSession`, persistence, notifications
and `session_id` behavior; real local Auth verifies the session-ID assumption.
