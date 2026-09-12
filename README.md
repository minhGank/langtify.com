# Langtify

Mobile-first language learning for iOS and Android. Domain: `langtify.com`.
Package, Expo slug and URL scheme: `langtify`. The workspace folder is intentionally
`/Applications/langtify.com`.

Phase 3 adds a shared vocabulary catalog, server-generated daily challenges,
concept-level repeat avoidance and word replacement with preserved history. Today
shows three target/reference cards. Phase 2 authentication/onboarding remains in
place; Discover and Vocabulary remain placeholders. Phase 4 has not started.

## Run the app

Use Node 24 LTS (`.nvmrc`) and npm. Expo SDK 57 requires Node 22.13 or newer.

```sh
npm ci
cp .env.example .env.local
# Fill the public Supabase URL and key in .env.local.
npm start
```

Scan the QR code with an Expo Go version compatible with SDK 57, on the same
network as your computer. `npm run ios`, `npm run android`, and `npm run web`
open a configured simulator/emulator or browser. Missing configuration shows an
explicit setup screen. Supplied but invalid configuration stops Expo before bundling.

## Public configuration

| Variable                        | Value                                              |
| ------------------------------- | -------------------------------------------------- |
| `EXPO_PUBLIC_SUPABASE_URL`      | Supabase project API URL                           |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Public `sb_publishable_...` key or legacy anon JWT |

Both values come from the Supabase Connect/API settings. Despite the historical
variable name, `ANON_KEY` accepts a current publishable key. Service-role JWTs
and secret keys are rejected at build time and by the client configuration check. All public
variables are visible in app bundles; never put privileged credentials in them.
`.env.local` and other environment files are ignored except `.env.example`.
Restart Expo after changes; use `npm start -- --clear` if necessary. Re-export
bundles after changing environment values.

Use HTTPS for hosted Supabase. HTTP is accepted only for localhost, loopback or
private IPv4 addresses for local development; URLs cannot contain credentials,
query parameters or fragments. `app.config.js` preserves the metadata in `app.json`
and shares validation with `src/lib/env.ts` through `src/lib/public-config.js`.
The validator checks configuration shape/key role; Supabase verifies credentials.

## Supabase development setup

The CLI is a development dependency. Docker Desktop must be running.

```sh
npm run supabase:start
npm run db:migrate
npm run db:seed
npm run db:test
npm run db:test:integration
npm run db:test:challenges
npm run db:types
npx prettier --write src/types/database.ts
```

`supabase start` creates an isolated local project named `langtify`, applies
migrations, and loads `supabase/seed.sql`. `db:migrate` applies pending migrations
without resetting data. On an existing stack, run `db:seed` after migrations to
insert missing development catalog entries; it preserves existing edits. `supabase db reset --local` is destructive: use it only
when intentionally discarding this project's local development data.

Local API: `http://127.0.0.1:54321`; database port: `54322`; captured confirmation
emails: `http://127.0.0.1:54324`. Use `npx supabase status` to retrieve local public
keys. Its output also contains local privileged credentials: do not copy the
whole output into source files, app configuration, or reports.

For a physical phone, `127.0.0.1` points to the phone, not the computer. Use your
computer's LAN address as the public Supabase URL and allow the API port through
your development firewall, or use a hosted development project. Confirm local
emails in the capture UI on your computer, then sign in on the phone.

Docker Desktop must share the project path for the standard database test runner.
On this workspace, `/Applications/langtify.com` is not shared. A tested fallback:

```sh
mkdir -p /private/tmp/langtify-db-tests
cp supabase/tests/*.sql /private/tmp/langtify-db-tests/
npx supabase test db /private/tmp/langtify-db-tests/
```

Studio is disabled locally to avoid its unshared host mount; enable it in
`supabase/config.toml` after sharing the workspace in Docker Desktop. Realtime,
Storage, Edge Runtime and analytics are disabled for this phase. No buckets exist.
`npm run supabase:stop` stops only the Langtify stack and preserves its local data.

## Hosted development setup

1. Create/select the intended Supabase **development** project. This repository is
   not linked to a hosted project and no hosted migration has been applied.
2. Review and apply all pending files in `supabase/migrations/` in filename order to the
   intended database, then `supabase/seed.sql`. Use Supabase SQL Editor with each
   migration executed transactionally (respect any `BEGIN` / `COMMIT` already in the file), or link
   the CLI to that project and review pending migrations before `supabase db push`.
   Do not replay the original schema migration on an existing schema. The audit
   migration is additive and refuses preexisting completed profiles missing learning
   records; investigate and repair those records before retrying. The seed is a
   separate step with SQL Editor or a migration-only push and preserves existing catalog edits.
3. Enable email/password signup. Configure your password policy, confirmation-email
   behavior and production SMTP before testing with addresses outside your team.
   The client supports both immediate-session and email-confirmation signup.
4. Configure Auth Site URL to an actual page you control (for example on
   `https://langtify.com`) that explains email confirmation. The default Supabase
   confirmation link verifies the address in the browser; return to Langtify and
   sign in with email/password. No session tokens are consumed from deep links,
   and no magic-link login or OAuth callback is implemented.
5. Copy only the API URL and public anon/publishable key to `.env.local` and restart
   Expo. Add languages through privileged administration, not the client.

Supabase owns password rules; the client only checks basic email/required fields
and maps server failures to safe messages. Duplicate signup responses may be
intentionally obfuscated by Supabase; check-email messaging does not assert that
an account was created or reveal whether an address exists.

## Architecture and data

```text
app/
  _layout.tsx                # auth provider, theme and protected navigation
  session.tsx                # restoring/configuration/retry states
  sign-in.tsx
  sign-up.tsx
  onboarding.tsx
  (tabs)/                    # Today, Discover, Vocabulary, Profile
src/
  components/ui/             # text, screen, button, input, choices
  features/auth/             # auth forms, session lifecycle, sign out
  features/onboarding/       # validation and setup form
  features/challenges/       # Today cards, request lifecycle and controlled errors
  features/profile/          # account and learning summary
  hooks/                     # shared system theme
  lib/                       # public config, typed Supabase client, theme
  services/                  # authoritative account reads and onboarding RPC
  types/database.ts          # generated from the local migrated schema
  utils/
supabase/
  config.toml
  migrations/                # identity, audit invariant and Phase 3 challenge engine
  seed.sql                   # 36 development concepts, 72 English/French terms
  tests/                     # transactional pgTAP security/invariant tests
scripts/                     # isolated local database integration/concurrency checks
tests/                      # application behavior tests
docs/                       # product, architecture, model, roadmap, decisions
```

`profiles` references `auth.users`, without copying email. Usernames normalize to
lowercase, allow 3–30 ASCII letters/digits/underscores, start with a letter/digit,
and are unique case-insensitively. `languages` is authoritative.
`user_language_profiles` stores one reference/target pair, CEFR A1–C2 and an IANA
timezone per user. English/French are seeded; selections must differ.

RLS restricts user-owned reads/writes. Column privileges prevent direct completion
or ownership changes. `complete_onboarding` derives the caller from `auth.uid()`,
locks their profile, upserts learning data, and marks completion in one transaction.
A failed write rolls back everything; retries and preexisting partial records can
recover. The client reloads authoritative state before enabling main tabs.
An additional deferred database trigger prevents completed profiles from losing
their learning record through privileged deletes/transfers, while allowing atomic
replacement and Auth-user cascading deletion. Onboarding requests retain the
submitting session's JWT, so a later account switch cannot redirect the write.

Native sessions use Supabase's supported AsyncStorage adapter, persistence,
process locking, and foreground token refresh. Web uses Supabase's browser storage.
AsyncStorage is not encrypted. Profiles are reloaded and the restored token is
validated with Auth before main routes open. Network/read errors show retry and
sign-out options, never an optimistic completed state. Sign out uses local scope
(this device/browser session), without signing out other devices.
Routine refresh retains an existing same-account screen while revalidating it.
Account changes discard pending reads and onboarding drafts. Stored timezones are
validated by PostgreSQL; device timezone data is used only to assist input.

## Vocabulary and daily challenges

`vocabulary_concepts` represents meanings; `vocabulary_terms` supplies one primary
term per concept/language, with independent CEFR. Reference equivalents follow
concept linkage. The development seed provides six French examples per level
A1–C2, with linked English terms. These provisional examples are not a production
curriculum; do not ship the development seed as a validated vocabulary catalog.

The no-argument `get_or_create_today_challenge()` RPC derives identity, local date,
timezone, language pair and levels from backend state. It returns one saved
challenge per learning profile/date. Slots follow A1/A1/A2 at A1, adjacent levels
in the middle and C1/C2/C2 at C2. Exact eligibility is required: active target and
reference terms, active photographable concept, exact target language/CEFR.

`replace_daily_challenge_word(active_assignment_id)` lets the backend choose a
same-slot/same-level replacement. It preserves the retired record and excludes
all concepts used anywhere in that challenge, including replacements. Unseen
concepts come first, followed by least recently assigned concepts, with random
ties. Insufficient pools fail atomically. Concurrent stale-ID replacements return
a controlled error; refresh to see the saved state after an uncertain response.

Challenge configuration and term text are immutable snapshots. Same-profile/date
calls retain the original snapshot after settings changes. A changed timezone can
select a different date; prior records remain unchanged. Ordinary clients only
read their own challenges/history and cannot write the challenge tables directly.
Today refreshes on focus/resume and once per active minute to handle date rollover.

Composite foreign keys preserve the meaning and language of terms referenced by
saved assignments. Correct unused catalog identities freely; for a used identity,
create the correct catalog row instead of repurposing the referenced row. Text,
CEFR and activation edits still preserve historical snapshots. The audit migration
refuses already-inconsistent links for investigation, and must run transactionally.
Individual history rows cannot be deleted from a retained challenge.

## Verification commands

| Command                                        | Purpose                                                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| `npm run typecheck`                            | Strict TypeScript validation                                                            |
| `npm run lint`                                 | ESLint with zero warnings                                                               |
| `npm run format:check`                         | Prettier validation                                                                     |
| `npm run format`                               | Format source and documentation                                                         |
| `npm test`                                     | Validation, auth/session race and protected navigation tests                            |
| `npm run test:watch`                           | Watch application tests                                                                 |
| `npm run check`                                | Typecheck, lint, formatting and application tests                                       |
| `npm run export:check -- --clear`              | Fresh iOS, Android and web production bundles                                           |
| `npx expo install --check`                     | SDK dependency compatibility                                                            |
| `npm run doctor`                               | Expo project diagnostics                                                                |
| `npm run db:seed`                              | Insert missing local development seed records transactionally                           |
| `npm run db:test:bootstrap`                    | Disposable database: migration replay, nonempty backfill and refusal of corrupt history |
| `npm run db:test:challenges`                   | Concurrent authenticated creation and replacements                                      |
| `npm run db:test`                              | pgTAP ownership, constraints and atomicity tests                                        |
| `npm run db:test:integration`                  | Local concurrent writes and actual seed/migration replay checks                         |
| `npx supabase db lint --local --level warning` | Database function checks                                                                |

Tests live outside `app/` and use `jest-expo` with Testing Library. Database tests
run in a transaction and roll back fixture users/data. Generated database types
include database capabilities; column grants and RLS still control which client
operations are permitted. `db:types` requires the local stack to be running.
The integration script uses Docker's `supabase_db_langtify` container directly,
never a linked hosted database. Replay checks roll back; concurrent-write fixtures
use random IDs and are deleted in cleanup.

ESLint 9 remains necessary for this Expo React lint configuration. The known
14 moderate npm audit findings from Phase 1 remain in Expo's transitive dependency
chains. Do not apply forced SDK-breaking downgrades to silence them; reassess on
compatible dependency updates. See [decisions](docs/DECISIONS.md).

## Manual phone acceptance tests

On **both iOS and Android**, using a configured Supabase development project:

1. Fresh launch while signed out: sign-in screen appears; direct `/profile`,
   `/discover` and `/onboarding` navigation cannot expose account/main content.
2. Sign up with a new email/password. With confirmation enabled, read the message,
   open the confirmation email, then return and sign in. Before confirmation,
   sign-in should explain that email confirmation is required. Also check a
   duplicate email, invalid credentials, weak password and disconnected network.
3. Authenticated new user: only onboarding is available, including direct main-tab
   URLs. Choose username, English reference, French target, CEFR and timezone.
   Check required fields, invalid username/timezone and equal-language errors.
4. Submit a username already used by another account (including different case).
   It must fail without completion or partial new learning data. Correct it and retry.
5. Disconnect before saving; verify safe failure. Reconnect and retry. If the request
   committed but its response was lost, relaunch/retry and verify persisted completion
   with exactly one learning record. No duplicate profiles should appear.
6. Complete onboarding; all four tabs work. Profile shows saved username, target,
   reference language, CEFR and timezone. Cold-kill/reopen: a restoring state precedes
   the tabs without requiring another sign-in. Changing device timezone must not
   silently alter the stored profile timezone.
7. Sign out; main tabs and back navigation are unavailable. Relaunch and confirm
   signed-out state. Sign in to a second account and confirm no first-account data
   appears. Test offline sign out and retry if the SDK reports a network failure.
8. Background/resume around token expiry. Check restoration errors/retry offline,
   large text, keyboard scrolling, rotation, light/dark appearance, safe areas,
   VoiceOver/TalkBack labels, and button loading/disabled states.
9. Leave onboarding partially filled while a token refresh occurs: the draft must
   survive. Switch accounts (including another web tab where applicable): previous
   drafts/data must disappear, and late saves must not redirect or populate the new account.

Automated exports are not native builds or physical-device tests. Real email
delivery, phone persistence/refresh and device UX remain manual checks. Icons and
splash assets are still temporary Expo assets; release signing/native identifiers
and app store configuration remain separate work. No Phase 4 functionality exists.

See [Phase 2 verification and changed files](docs/PHASE2_VERIFICATION.md) for the
original delivery record and [Phase 2 audit](docs/PHASE2_AUDIT.md) for that audit.
See [Phase 3 verification](docs/PHASE3_VERIFICATION.md) for current results, changed
files, remaining risks and the additional Today/challenge phone checklist. The
[Phase 3 audit](docs/PHASE3_AUDIT.md) records the latest fixes and closure assessment.

## References

- [Product](docs/PRODUCT.md), [architecture](docs/ARCHITECTURE.md), [data model](docs/DATA_MODEL.md),
  [roadmap](docs/ROADMAP.md), [decisions](docs/DECISIONS.md), [agent guidance](AGENTS.md).
- [Supabase React Native Auth](https://supabase.com/docs/guides/auth/quickstarts/react-native)
  and [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/)
  and [protected routes](https://docs.expo.dev/router/advanced/protected/).
