# Phase 2 security and correctness audit

Audited locally on 2026-09-12. Scope: Supabase, authentication and onboarding.
No Phase 3 features, dependencies, product-policy changes or architecture replacement.
No hosted Supabase project was linked or changed. All database mutations and
integration fixtures were confined to the isolated local `langtify` Docker stack.

## Findings and fixes

| Finding                                                                           | Impact before the fix                                                                                                                                                                                                              | Resolution                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High, conditional on misconfiguration: privileged public env could enter a bundle | Runtime key rejection occurred after Expo had already embedded public environment values; a mistakenly supplied privileged credential could still be extracted from the bundle. No actual leaked credential was found.             | Shared configuration validation now runs in `app.config.js` before bundling and again at runtime. Secret/service-role keys and unsafe URLs fail without printing their values. Hosted URLs require HTTPS; local/private HTTP remains available for development. |
| Medium: onboarding request could use a later shared-client session                | Supabase resolves its access token asynchronously at dispatch. A pending request from account A could pick up account B's session on the same client.                                                                              | Each save explicitly retains the submitting session's Authorization JWT. The database still verifies the JWT and obtains ownership exclusively from `auth.uid()`. User-keyed form instances discard old drafts and ignore late responses.                       |
| Medium: restoration errors could become apparent sign-outs                        | Supabase can emit `INITIAL_SESSION(null)` when restoration fails. Discarding the event type caused the app to treat this as a sign-out and suppress the explicit restore error.                                                    | Explicit restoration controls startup; actual subsequent auth events take precedence. Errors retain a retry state. Generation capture also protects against a synchronous event during subscription.                                                            |
| Medium: token refresh reset an unfinished onboarding form                         | Every same-user auth event temporarily selected the loading route, unmounting the form and losing entered data.                                                                                                                    | Same-user refresh preserves the verified screen/account while revalidating. Different users and sign-out clear account state; failures still close protected routes.                                                                                            |
| Medium: completion was not protected from reciprocal record loss                  | A privileged maintenance delete/ownership transfer could remove a completed user's learning record without clearing completion. Reproduced in a rollback fixture. Ordinary client delete/ownership operations were already denied. | An additive deferred constraint trigger verifies final transaction state under a profile lock. Invalid deletes/transfers fail; atomic replacement and Auth-user cascade deletion succeed.                                                                       |
| Medium: device timezone data overruled persisted completion                       | A timezone accepted by PostgreSQL could fail a device's older `Intl` catalog, incorrectly sending a completed user back to setup.                                                                                                  | Completion uses persisted, database-validated timezone data. Device timezone APIs assist input and detection only.                                                                                                                                              |
| Low: replaying seed overwrote catalog administration                              | The upsert renamed existing entries and reactivated disabled languages.                                                                                                                                                            | The seed inserts missing codes without overwriting existing rows. Replaying the actual seed is tested.                                                                                                                                                          |

## Security and invariant review

- **Cross-user access:** no read/write RLS bypass found in the reviewed schema.
  Both user-owned tables filter on `auth.uid()`; mutation policies check ownership
  before and after writes. Anonymous reads/RPC calls, cross-user insert/update,
  ownership changes, client deletes and catalog mutations are tested and denied.
- **Languages:** the authenticated read-all policy intentionally exposes the shared
  catalog, including inactive entries needed to describe existing selections. It
  exposes no user data. The client selects active entries; backend triggers validate
  chosen languages. Administrative deactivation does not erase historical selections.
- **Backend authority:** no trusted client completion flag. Startup verifies the
  restored identity with Auth and loads persisted profile/learning rows; protected
  routes check their ownership and completion. RPC success triggers a backend reload.
  Failed reads are errors, not evidence of completion or a new blank account.
- **Atomicity and races:** the RPC accepts no user ID, locks the caller's profile,
  and writes learning data, username and completion in one transaction. A unique
  lowercase username index resolves concurrent claims. A failed later username
  write rolls back earlier learning writes. Repeated same-user saves serialize;
  retries preserve one learning record and the original completion timestamp.
- **Constraints:** Auth/profile/learning foreign keys, unique learning owner,
  normalized username format/uniqueness, required completed username, distinct
  languages, non-null CEFR A1–C2 and PostgreSQL IANA timezone validation are enforced
  independently of the client. The new trigger preserves reciprocal completion.
- **Privileges:** column grants reserve IDs, creation/update timestamps and completion
  metadata for the backend. Private functions are not callable by client roles.
  Security-definer functions use an empty search path and qualified object names.
  RLS bypass by an authorized database owner/service role remains inherent to those
  privileged roles; they must stay outside the client.
- **Persistence and stale state:** native AsyncStorage, SDK process locking,
  persistence and foreground refresh remain the existing implementation. Generation
  checks suppress stale reads after sign-out/account switches. Account identity
  resets form state; same-account token refresh does not. Late form responses cannot
  reload another account's routes.
- **Credentials:** source literal scans found no real JWT, secret key or private-key
  material. `.env.local` is absent; ignore rules protect local env/runtime metadata.
  Test secret strings are synthetic fixtures. Public key shape/role checks are not
  signature verification; Supabase still verifies credentials. Arbitrary secrets
  must never be placed in any `EXPO_PUBLIC_*` variable.

## Migration and operational safety

The original `20260912000000_phase2_identity.sql` is unchanged. The new
`20260912010000_phase2_audit_invariants.sql` locks the affected tables during
installation, rejects inconsistent preexisting completion data and installs the
reciprocal constraint. It neither resets data nor fabricates missing preferences.
The public schema shape is unchanged; regenerated types match the checked-in types.

Use the versioned migration runner, which applies each pending migration once.
The original schema file is not intended to be run repeatedly against existing
tables. The additive audit file can be replayed transactionally and was tested
twice in one rolled-back transaction. Its preflight rejection was also tested
against deliberately inconsistent temporary data, with no retained changes.
In SQL Editor, wrap each migration in `BEGIN` / `COMMIT`. Review any existing
inconsistent records before attempting repair; the migration intentionally refuses
to choose a repair policy. Installation briefly blocks writes to the two tables.

## Commands and results

| Check                                                         | Result                                                                                                                                                                                                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                                               | Typecheck passed; ESLint passed with zero warnings; formatting passed; 85 application tests passed in 9 suites.                                                                                                                 |
| `npx supabase migration up --local`                           | Audit migration applied locally; repeat invocation applied no pending migrations.                                                                                                                                               |
| `npx supabase test db /private/tmp/langtify-audit-sql/tests/` | Both repository pgTAP suites passed: 59 tests. Exact SQL files were copied to Docker's shared temporary directory.                                                                                                              |
| `npm run db:test:integration`                                 | Actual seed replay, additive migration replay, concurrent case-insensitive username claims, concurrent same-user onboarding and migration preflight rejection passed. Fixtures cleaned up; replay/preflight probes rolled back. |
| `npx supabase db lint --local --level warning`                | No schema errors.                                                                                                                                                                                                               |
| `npx supabase gen types typescript --local --schema public`   | Temporary generated types, formatted with the repository Prettier config, matched `src/types/database.ts`. The CLI emitted a non-failing listener-count warning.                                                                |
| `node /private/tmp/langtify-phase2-smoke.cjs`                 | Real local Auth/REST signup-confirmation handling, invalid credentials, password sign-in, onboarding, fresh-SDK persisted-session restoration, identity verification and sign-out passed. Fixture deleted.                      |
| `npx expo config --type public --json`                        | Configuration resolved with Langtify metadata.                                                                                                                                                                                  |
| Expo CLI config with synthetic invalid env                    | Secret key, service-role JWT and public HTTP configuration rejected before bundling without echoing credentials.                                                                                                                |
| `npx expo install --check`                                    | Dependencies compatible/up to date.                                                                                                                                                                                             |
| `npm run doctor`                                              | 21/21 checks passed.                                                                                                                                                                                                            |
| `CI=1 npm run export:check -- --clear`                        | Fresh iOS, Android and web production exports passed.                                                                                                                                                                           |
| Credential/old-brand scans; `git diff --check`                | No real credential literals or old-brand references found; no whitespace errors.                                                                                                                                                |

Docker Desktop does not share `/Applications/langtify.com`, so the standard
`npm run db:test` requires the documented temporary-directory fallback here. This
changes only the host mount path, not test SQL, grants or RLS. The HTTP smoke test
uses SDK storage in Node; it does not exercise the native AsyncStorage bridge or
deliver a real confirmation email. See README for reproducible local commands.

## Remaining risks and closure assessment

The reviewed implementation has no known unresolved blocking code defect after
these fixes. It is ready for Phase 2 acceptance, **conditional on the remaining
device and target-environment checks**, rather than a production-release approval:

1. Apply the reviewed pending migration(s) and seed to the intended development
   project. No hosted deployment was performed during this audit.
2. Complete the README acceptance checklist on both iOS and Android: cold restart,
   refresh/backgrounding, offline restore/retry, confirmation email flow, username
   collision/retry, interrupted save and switching accounts. Verify draft retention
   during same-user refresh and draft removal across accounts.
3. Configure actual hosted confirmation URLs, password/confirmation settings and
   email delivery. Native binaries, signing and physical-device UX remain untested.

Existing limitations remain explicit: AsyncStorage is not encrypted; browser
storage needs XSS protection. Already-issued access JWTs may remain usable until
expiry after sign-out; a previously submitted request can still finish for its
original account. No new revocation policy was introduced. The original delivery
record's 14 moderate transitive Expo dependency advisories remain tracked; this
audit did not change dependency versions or rerun a dependency vulnerability audit.
Automated tests establish the covered behavior, not a guarantee against every flaw.

Phase 3 has not started.

## Exact files changed by this audit

Compared with the working-tree snapshot at audit start, preserving prior Phase 1,
branding and Phase 2 work. Generated exports and local runtime files are excluded.

- `AGENTS.md`
- `README.md`
- `app.config.js` (new)
- `docs/ARCHITECTURE.md`
- `docs/DATA_MODEL.md`
- `docs/DECISIONS.md`
- `docs/PHASE2_VERIFICATION.md`
- `docs/PHASE2_AUDIT.md` (new; this report)
- `package.json` (test script only; dependency versions and lockfile unchanged)
- `scripts/test-db-integration.mjs` (new)
- `src/features/auth/auth-provider.tsx`
- `src/features/auth/session-state.ts`
- `src/features/auth/use-session-state.ts`
- `src/features/onboarding/onboarding-screen.tsx`
- `src/lib/env.ts`
- `src/lib/public-config.js` (new)
- `src/services/account.ts`
- `supabase/migrations/20260912010000_phase2_audit_invariants.sql` (new)
- `supabase/seed.sql`
- `supabase/tests/audit.test.sql` (new)
- `tests/account-service.test.ts` (new)
- `tests/app-config.test.ts` (new)
- `tests/env.test.ts`
- `tests/onboarding-save.test.tsx`
- `tests/onboarding-validation.test.ts`
- `tests/session-state.test.tsx`

## References

- [Supabase React Native Auth](https://supabase.com/docs/guides/auth/quickstarts/react-native)
  and [Auth state events](https://supabase.com/docs/reference/javascript/auth-onauthstatechange).
- [Supabase API keys](https://supabase.com/docs/guides/api/api-keys)
  and [row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security).
- [PostgreSQL constraint triggers](https://www.postgresql.org/docs/current/sql-createtrigger.html).
- [Expo public environment variables](https://docs.expo.dev/guides/environment-variables/).
