# Langtify

Mobile-first language learning for iOS and Android. Domain: `langtify.com`.
Package, Expo slug and URL scheme: `langtify`. The workspace folder is intentionally
`/Applications/langtify.com`.

Phase 4 adds camera capture, normalized photo previews, secure private Storage,
authoritative submissions, owner visibility controls and recoverable deletion.
Today shows Take Photo/Replace before completion and Completed/View Photo afterward.
Discover shows eligible public vocabulary photos. Phase 5 adds progress, streaks, reversible XP and levels;
Phase 5.5 adds Google OAuth; Phase 6 adds My Vocabulary with personal concept history.
Phase 8 adds authoritative semantic ratings to Phase 7's public Discover feed.
Phase 9 adds private reports, mutual blocking and protected moderation.
Phase 10 adds notification preferences, secure registration, a server sender with
receipt handling and beta recovery hardening. The approved contract is **at most
one provider send attempt per user/type/local date**, with no guaranteed device delivery. Start with
[the beta checklist](docs/BETA_CHECKLIST.md) and
[hosted Dev deployment](docs/HOSTED_DEV_DEPLOYMENT.md).

## Run the app

Use Node 24 LTS (`.nvmrc`) and npm. Expo SDK 57 requires Node 22.13 or newer.

```sh
npm ci
# Only on a new checkout without .env.local:
cp -n .env.example .env.local
# Fill the public Supabase URL and key in .env.local.
npm run start:dev
```

Use an installed Langtify development build for Google login, with the phone on
this computer's network. Expo Go cannot register the required `langtify` callback
and is explicitly unsupported for Google. Create the native build once (and
rebuild after native dependency/config changes):

```sh
# macOS + Xcode, connected and provisioned iPhone
npm run build:ios:dev
# Android Studio/SDK, connected phone with USB debugging
npm run build:android:dev
# Subsequent JS development; scan with the installed Langtify development client
npm run start:dev
# Browser compatibility
npm run web
```

The build scripts run `expo run:ios --device` and `expo run:android --device`.
Expo generates ignored native projects as needed; native identifiers are
`com.langtify.app`. Xcode signing/device provisioning and Android SDK setup remain
local prerequisites. These local builds do not require EAS configuration.
Missing Supabase configuration shows a setup screen; invalid configuration stops bundling.
See [Google setup and device acceptance](docs/PHASE55_VERIFICATION.md).

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

## Continuous integration

GitHub Actions runs the existing application, export, security and local Supabase
regression checks on pull requests and pushes to `main`. See [CI setup and check
results](docs/CI.md) for required-check names, credential handling, local reproduction
and the Expo compatibility verification results. No repository secrets or deployments
are configured by this workflow.

## Supabase development setup

The CLI is a development dependency. Docker Desktop must be running.

```sh
npm run supabase:start
npm run db:migrate
npm run db:seed
npm run db:test
npm run db:test:integration
npm run db:test:challenges
npm run db:test:submissions
npm run db:test:photo-audit
npm run db:test:progress
npm run db:test:bootstrap
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
`supabase/config.toml` after sharing the workspace in Docker Desktop. Storage and Edge Runtime are enabled for private photos and trusted image verification.
Realtime and analytics remain disabled. Run `npx supabase functions serve` in another
terminal before the photo integration tests. Docker Desktop must share this workspace
for function serving; SQL-test copying alone does not share function source.
For a temporary function test mirror (restart after copying code changes):

```sh
mkdir -p /private/tmp/langtify-functions/supabase
cp supabase/config.toml /private/tmp/langtify-functions/supabase/config.toml
cp -R supabase/functions /private/tmp/langtify-functions/supabase/
cp -R src /private/tmp/langtify-functions/
npx supabase functions serve --workdir /private/tmp/langtify-functions
```

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
   and no magic-link login is implemented. Google uses the separate guarded PKCE callback
   described in [Google setup](#phase-55-google-authentication).
5. Copy only the API URL and public anon/publishable key to `.env.local` and restart
   Expo. Add languages through privileged administration, not the client.

Supabase owns password rules; the client only checks basic email/required fields
and maps server failures to safe messages. Duplicate signup responses may be
intentionally obfuscated by Supabase; check-email messaging does not assert that
an account was created or reveal whether an address exists.

## Trusted photo function deployment

Deploy `photo-authority` to the same Supabase project as the database:
`npx supabase functions deploy photo-authority --project-ref <reviewed-project-ref>`.
This is a deployment instruction, not a command executed by this audit. Keep JWT
verification enabled. The function also verifies the token with Auth, reads the
submission through owner RLS, decodes/validates bytes before attesting them, and
signs preview paths with a fixed 60-second lifetime. Its standard Supabase server
URL/anon/service-role environment stays on the server. Never copy the service-role
key into Expo. No additional mobile dependency or product feature is needed.

Apply migrations in order with uploads paused during rollout; existing signed
capabilities can outlive a policy change, so the new object trigger rechecks each
commit. The audit migration deliberately refuses **preexisting completed photos**:
they were never verified from bytes. If that preflight fails, stop and prepare a
reviewed, version-bound verification/backfill for those photos before enabling this
migration; do not delete data or bypass the preflight. The local audit database had
no preexisting submissions. All earlier migration files are preserved.

Function checks use Deno 2.9.6 through npm exec (downloaded into the tooling cache).
The function's pinned npm imports and `deno.lock` are separate from the Expo bundle.
Run `npm run functions:check`, `npm run functions:lint`, and `npm run functions:test`.

## Architecture and data

```text
app/
  _layout.tsx                # auth provider, theme and protected navigation
  session.tsx                # restoring/configuration/retry states
  sign-in.tsx
  sign-up.tsx
  onboarding.tsx
  photo.tsx                  # protected camera / owner photo detail
  (tabs)/                    # Today, Discover, Vocabulary, Profile
src/
  components/ui/             # text, screen, button, input, choices
  features/auth/             # auth forms, session lifecycle, sign out
  features/onboarding/       # validation and setup form
  features/challenges/       # Today cards, request lifecycle and controlled errors
  features/photos/           # camera, normalized preview, upload/recovery and deletion
  features/profile/          # account and learning summary
  hooks/                     # shared system theme
  lib/                       # public config, typed Supabase client, theme
  services/                  # account, challenge and submission RPC/Storage gateways
  types/database.ts          # generated from the local migrated schema
  utils/
supabase/
  config.toml
  migrations/                # identity, challenge engine, audit constraints, submissions
  seed.sql                   # 36 development concepts, 72 English/French terms
  functions/photo-authority/  # trusted JPEG verification and 60-second preview signing
  tests/                     # transactional pgTAP security/invariant tests
scripts/                     # local integration checks and server-only photo cleanup
ops/                         # cleanup cron installation example
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

## Camera and photo submissions

Use Take Photo on a Today card. Camera permission is requested explicitly; there is
no gallery picker. Capture is orientation-normalized, resized to at most 1600 pixels
on the longest side, re-encoded as JPEG at quality 0.8 and stripped of all JPEG
APP/comment metadata, including EXIF/GPS/XMP. The app requests no location or audio
permission. It rejects malformed or greater-than-5-MiB images. A loaded preview and
explicit Submit are required before upload; sharing defaults OFF/private.

The private `challenge-submissions` bucket accepts JPEGs up to 5 MiB. Records store
server-derived `<user-id>/<submission-id>.jpg` paths, never public URLs. RLS permits
only the exact reserved owner upload, owner reads and deletion after server intent;
custom object metadata and overwrites are denied. Public visibility remains owner-only in Phase 4 and
now grants controlled Phase 7 feed eligibility. Photo detail uses in-memory 60-second signed
URLs issued by the authenticated Supabase function; direct signing is denied; changing visibility does not move images or grant public bucket access.

Reserve -> upload -> finalize is idempotent. SQL derives assignment/owner/vocabulary
identity; a Supabase function decodes and validates the actual JPEG before SQL allows
completion. A private attestation binds verification to the immutable object version. An uploaded but unfinalized
photo can be recovered after restart and reviewed before retrying. Native prepared
drafts use an account/assignment-scoped cache; expired/malformed files are removed
when loading. Cache eviction requires retaking; unuploaded web drafts are memory-only.
Photo/camera state remounts per account/assignment, and network requests retain the
submitting account's JWT. Pending uploads must be finished or discarded before
replacement. Completed assignments cannot be replaced or submitted twice.

Deletion is intent -> Storage API removal -> database retirement. If interrupted,
use Resume photo / Finish deletion, or let scheduled cleanup repair it. The word
becomes available for a new photo only after retirement. Soft-deleted rows preserve
retry/history metadata. Existing challenge/account cascades retain object-cleanup
work in a private queue. A capture started before midnight can finish against its
original active assignment and saved challenge date; device time cannot rewrite it.

Unfinished photos on Today also lists owner-only pending/deleting operations from
earlier dates, so restart or midnight does not strand an uploaded photo. This
recovery read is independent of current challenge generation; it is not a gallery
or feed.

### Required maintenance scheduling

Run `scripts/cleanup-submissions.mjs` hourly on a trusted server/CI runner with Node
and installed npm dependencies. It expires pending reservations after 24 hours,
retries deletions, and sweeps orphan/late files. Files are removed through Storage
API before retirement; failures remain queued. Each run handles up to 100 queued
paths and reports counts only. Monitor failures and backlog; increase run frequency
if needed. This job is necessary even if a user never opens the app again.

Provide **server-only** `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (a service-role
JWT or Supabase secret key) through the runner's secret manager. Never use an
`EXPO_PUBLIC_*` name, commit these values, or put them in Expo config. For a protected
local env file, run:

```sh
node --env-file=/path/to/maintenance.env scripts/cleanup-submissions.mjs
# With secrets already supplied in the process environment:
npm run submissions:cleanup
```

[The cron example](ops/submissions-cleanup.cron.example) documents installation.
Cleanup is implemented and tested locally; a persistent production schedule has
not been installed on an external host by this task. Install and monitor it before
enabling deployed uploads. Never delete `storage.objects` rows through SQL: doing
so leaves physical files behind.

## Verification commands

| Command                                                         | Purpose                                                                                 |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `npm run typecheck`                                             | Strict TypeScript validation                                                            |
| `npm run lint`                                                  | ESLint with zero warnings                                                               |
| `npm run format:check`                                          | Prettier validation                                                                     |
| `npm run format`                                                | Format source and documentation                                                         |
| `npm test`                                                      | Validation, auth/session race and protected navigation tests                            |
| `npm run test:watch`                                            | Watch application tests                                                                 |
| `npm run check`                                                 | Typecheck, lint, formatting and application tests                                       |
| `npm run export:check -- --clear`                               | Fresh iOS, Android and web production bundles                                           |
| `npx expo install --check`                                      | SDK dependency compatibility                                                            |
| `npm run doctor`                                                | Expo project diagnostics                                                                |
| `npm run db:seed`                                               | Insert missing local development seed records transactionally                           |
| `npm run db:test:bootstrap`                                     | Disposable database: migration replay, nonempty backfill and refusal of corrupt history |
| `npm run db:test:submissions`                                   | Real local Auth/Storage ownership, upload/retry, deletion and cleanup tests             |
| `npm run db:test:photo-audit`                                   | Malformed uploads, signing limits, expiry and concurrent cleanup/write protection       |
| `npm run functions:check` / `functions:test` / `functions:lint` | Pinned Deno server typecheck, bounded JPEG decoder tests and lint                       |
| `npm run submissions:cleanup`                                   | Server-only cleanup; requires privileged runner environment                             |
| `npm run db:test:challenges`                                    | Concurrent authenticated creation and replacements                                      |
| `npm run db:test`                                               | pgTAP ownership, constraints and atomicity tests                                        |
| `npm run db:test:integration`                                   | Local concurrent writes and actual seed/migration replay checks                         |
| `npx supabase db lint --local --level warning`                  | Database function checks                                                                |

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

The [Phase 4 audit](docs/PHASE4_AUDIT.md) records the photo security fixes and
verification results. The [original verification report](docs/PHASE4_VERIFICATION.md)
contains the full camera/upload/deletion phone checklist.

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
and app store configuration remain separate work. Phase 5 adds daily progress, streaks, reversible XP and derived levels; Phase 5.5 adds Google OAuth through Supabase; Phase 6 personal vocabulary history is described below.

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

## Phase 5 progress

Today shows server-owned daily completion, streak, level and XP; Profile adds the
next-level bar, longest streak and valid word/full-challenge counts. Photo detail
shows earned word/bonus XP. See [exact rules](docs/PRODUCT.md) and
[progress schema](docs/DATA_MODEL.md). No social or leaderboard features are included.

Apply `npm run db:migrate` to local development; deploy the reviewed migration via
your normal Supabase release workflow. Back up existing data and allow a write-lock
window for chronological backfill. Legacy timezone provenance is documented in the
data model. The existing photo-authority function and hourly cleanup remain required.
There are no new env variables, mobile dependencies or deployment services.
Run `npm run db:test:progress` with the local function served for real Auth/Storage
XP concurrency and recovery coverage. SQL tests include all milestones and DST.

The [Phase 5 audit](docs/PHASE5_AUDIT.md) records durable XP identity and exact-level
fixes, regression results and remaining deployment checks. Apply the additive audit
migration with Phase 5. It refuses ambiguous existing milestone keys or inconsistent
ledger projections without changing history. Phase 5.5 Google OAuth is described below; Phase 6 personal vocabulary history is described below.

## Phase 5.5 Google authentication

Continue with Google uses Supabase Google OAuth and S256 PKCE. The native redirect
is `langtify://auth/callback`; the existing hosted **Langtify Dev** project already
has the provider, secret, Google callback and native allowlist configured. Keep
`.env.local` pointed at that development project's public URL/key. This phase does
not change environment variable names, database migrations, or local provider configuration.
Never place a Google client secret in the app.

New Google users follow existing onboarding; provider names/avatars cannot satisfy
Langtify fields. Existing linked identities keep the authoritative Supabase UUID,
profile, challenges, photos and XP. Supabase alone decides compatible verified-email
linking; there is no client email matching, custom merge or manual linking.
Password login and local Supabase sign-out remain available. Google cookies can
survive app sign-out; the next login asks Google to select an account.

Web uses a full-page PKCE redirect to the current web origin's `/auth/callback`.
Before browser OAuth testing, allow that exact URL (for example
`http://localhost:8081/auth/callback`) in Supabase; the native allowlist alone does
not enable web. Deployments must serve the exported callback route over HTTPS.
Local Supabase still supports password, RLS and database regression tests; actual
Google consent/identity linking requires the hosted development provider.

See [Phase 5.5 verification and physical-device checklist](docs/PHASE55_VERIFICATION.md).
Apple Sign-In remains deferred until Apple Developer membership is available.
No Phase 6 functionality is included.

The [Phase 5.5 audit](docs/PHASE55_AUDIT.md) adds guarded session persistence,
session-specific recovery, durable cancellation, early callback sanitation and
cross-tab coordination. Run `npm run test:auth:integration` against local Supabase
for session-ID/refresh/profile/sign-out checks. Web Google login needs secure browser
storage and Web Locks; reload all web tabs after updating the app. The same
physical-device acceptance checklist remains required before closing Phase 5.5.

## Phase 6 — personal visual dictionary

Vocabulary groups successfully photographed concepts across dates, with latest
snapshot/photo cards, target/reference search, CEFR filters and 12-item pages.
Concept detail retains earlier captures and opens existing photo management.
The personal dictionary remains owner-only. Phase 7 adds a separate controlled public feed.

Apply `npm run db:migrate` locally and deploy the updated `photo-authority` function
alongside the Phase 6 migration in the intended hosted environment. The new
`previews` action is needed for batch dictionary images. Follow the reviewed-project
function deployment instructions above; no hosted changes were made automatically.
Existing Google credentials, redirects, auth behavior and hourly cleanup are unchanged.

Run `npm run db:test:vocabulary` against local Supabase with the updated function
served; it uses isolated Auth accounts and real JPEG upload/finalize/delete flows.
See [Phase 6 verification](docs/PHASE6_VERIFICATION.md) for results and phone checks.

Phase 6 has also been audited: see [Phase 6 audit](docs/PHASE6_AUDIT.md).
The history integration command checks actual signed-URL expiration and renewal,
so it deliberately waits about one minute while keeping a valid image in Storage.

## Phase 7 — Public Discover Feed

Discover shows finalized public photos in the viewer's saved target language,
including their own, newest first. Each card keeps historical vocabulary/translation
and CEFR alongside the current username and submitted date. Private/pending/deleting/
deleted photos, invalid accounts and missing verified objects are excluded.

Feed reads and one batch signing request use controlled endpoints; the bucket,
raw profile/submission RLS and owner mutation rights stay private. Signed photo URLs
last 60 seconds. Visibility changes affect future eligibility; existing URLs retain
their short expiry. Pull to refresh, Load more, image retry and active renewal are
included with bounded memory and account/target isolation.

Apply `20260915000000_phase7_discover.sql` before deploying the updated
`photo-authority` function and app to an intended hosted development environment.
No hosted deployment is performed by local verification. Run `npm run db:test:discover`
for real local Auth/Storage privacy, pagination and signing/expiry checks; this test
creates and removes only its own fixtures and takes over a minute.
See [Phase 7 verification](docs/PHASE7_VERIFICATION.md) for checks and phone acceptance.

**Public launch requires deployment, device acceptance and operational readiness
of the Phase 9 safety controls.** Phase 8 ratings are described below.

Phase 7 has been audited; see [Phase 7 audit](docs/PHASE7_AUDIT.md). Deploy the
additive `20260915010000_phase7_audit_pagination.sql` migration and the matching
`photo-authority` function (including `feed-photos.ts`) for the audit corrections.
Public production launch remains gated on moderation/safety and device acceptance.

## Phase 8 — Semantic Photo Ratings

Discover now asks how well each public photo represents its assigned vocabulary:
1 Not related, 2 Poor match, 3 Understandable, 4 Clear match, 5 Perfect match.
Onboarded nonowners may submit/change one score. Server-only writes enforce current
eligibility, and bounded queries provide average/count/current-viewer selection.
Owners see aggregates only. No ratings change XP, streaks, completion or feed order.

Apply `20260916000000_phase8_ratings.sql` before deploying the updated photo-authority
function and app. Regenerate database types when changing schema. Run
`npm run db:test:ratings` for real local Auth/Storage/concurrency checks, alongside
existing regressions. See [Phase 8 verification](docs/PHASE8_VERIFICATION.md) for
results, exact lifecycle semantics, remaining deployment work and phone acceptance.
No hosted deployment was performed. Public launch still requires moderation/safety,
including operational acceptance of the Phase 9 controls described below. Phase 10 learning notifications are described below.

Phase 8 has been audited; see [Phase 8 audit](docs/PHASE8_AUDIT.md). Rating requests
now have bounded recovery when a transport stalls. No additional migration or
server deployment is required for the audit fix. Run shared-database integration
and pgTAP suites sequentially to avoid overlapping their fixtures.

## Phase 9 — Reporting, Blocking & Moderation

Discover offers explicit report-photo, report-user and block flows. Profile adds
Blocked users. Backend-provisioned moderators get an internal queue, case review,
report-scoped photo preview, public removal/account restriction, resolution and
immutable audit history. Ordinary metadata cannot grant access; source RLS and
private Storage remain intact. Reporting/moderation do not change learning XP.

Apply `20260917000000_phase9_safety.sql` locally or to the intended deployment, then
deploy the matching `photo-authority` function before the app. No hosted deployment
or real moderator provisioning was performed here. Follow [moderator operations](docs/MODERATION.md)
for trusted provisioning, revocation and acceptance. Run `npm run db:test:safety`
for real Auth/Storage/concurrency coverage (including actual 60-second expiry).
Shared-database suites must run sequentially. See [Phase 9 verification](docs/PHASE9_VERIFICATION.md)
for results and the phone/admin checklist. Public launch needs operational staffing,
policy and device acceptance. Phase 10 learning notifications are described below.

Phase 9 has been audited; see [Phase 9 audit](docs/PHASE9_AUDIT.md). The audit fixes
moderator queue/cursor recovery and delayed preview callbacks, and extends real
revocation, deletion and concurrency coverage. No additional migration or server
deployment is required for these audit fixes; hosted/device/admin acceptance remains pending.

## Phase 10 — push notifications and beta hardening

Profile → Notifications exposes preferences and device permission/registration.
Defaults are daily words at 08:00 and streak reminder at 19:00 in the saved IANA zone.
The backend ensures today's challenge exists and snapshots all three assigned words.
Streak reminders require yesterday's surviving streak and no completion today.

The approved contract permits **one provider send attempt per user/type/local date**.
The server commits the attempt before network I/O, rechecks current eligibility,
and selects one most recently registered eligible device. It never automatically
resends after network uncertainty, throttling, rejection or lost acknowledgement.
Receipts are checked separately; definite unregistered-token results invalidate only
the attempted binding. Expo/provider acceptance is never described as device delivery.
Historical blocked preparation records remain terminal and are not sent as a backlog.

Read [notification architecture/operations](docs/NOTIFICATIONS.md),
[the ordered Langtify Dev deployment guide](docs/HOSTED_DEV_DEPLOYMENT.md),
[beta acceptance](docs/BETA_CHECKLIST.md) and
[Phase 10 verification](docs/PHASE10_VERIFICATION.md).

The [Phase 10 audit](docs/PHASE10_AUDIT.md) fixes previous-account revocation during
native API failure, DST admission, provider response cleanup and scheduler lock order.
Apply both additive audit migrations before hosted acceptance.

Run `npm run db:test:notifications` and `npm run db:test:notification-sender` for
real local Auth/DB/Storage admission and instrumented HTTP send/receipt recovery tests.
The latter uses a loopback provider fixture; it does not send real Expo notifications.
Existing shared-database suites remain sequential. Function checks cover both Edge
Functions. Server setup requires a dedicated job secret and Expo access token with
Expo enhanced push security; neither belongs in the app.

Set the public EAS UUID only for a real development project. The optional
`LANGTIFY_GOOGLE_SERVICES_FILE` points to Android's Firebase client config, never an
FCM service-account key. Rebuild native clients after plugin changes. Hosted Dev,
provider credentials, cron and physical-device acceptance are still operator steps;
no hosted deployment or actual device delivery was performed here.

App requests and Auth startup have bounded waits with safe recovery; inactive/obsolete
Today, recovery and progress callbacks cannot start stale reads. Existing session,
Storage, XP/streak, vocabulary, Discover, rating and moderation authority is preserved.
No Phase 11 functionality is included.
