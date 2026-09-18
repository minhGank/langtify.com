# Continuous integration

`.github/workflows/ci.yml` validates the existing Phase 10 repository on every pull
request and push to `main`. This is verification infrastructure; Phase 11 remains
unstarted. There are no deployments, release publishing or dependency-update bots.

## Jobs and tooling

Both jobs use GitHub-hosted `ubuntu-24.04`, Node 24 from `.nvmrc`, npm 11.9.0 matching
`packageManager`, and `npm ci` against `package-lock.json`. `setup-node` caches npm's
download cache using the lockfile; it does not reuse `node_modules`. Checkout and
setup-node are pinned to verified release commit SHAs. Supabase comes from the
lockfile and the existing function scripts pin Deno 2.9.6. Review these pins when
updating tooling; do not introduce an unpinned global Supabase CLI.

| Required check name           | Coverage                                                                                                                                                                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `App and exports`             | `npm run check` (typecheck, lint, formatting, all Jest tests); CI-helper tests; dependency audit; iOS/Android/web exports; source/bundle credential scan; Expo Doctor and SDK compatibility                                                                            |
| `Supabase and Edge Functions` | All existing Edge typechecks/lint/tests; local Supabase startup and photo-handler readiness; migrations, pgTAP/RLS, bootstrap/replay, all existing Auth/database/Storage/XP/vocabulary/Discover/ratings/moderation/notification integration scripts, and database lint |

The jobs run independently. Database suites within their job are sequential because
they share fixtures; no tests are disabled or given `continue-on-error`. Doctor and
SDK compatibility each run after successful dependency installation, even if another
check fails, so both diagnostics remain visible. Job timeouts are 25 and 35 minutes.
Stale runs for the same PR or branch are cancelled using workflow concurrency.

The dependency gate is `npm audit --audit-level=high`: known moderate findings remain
visible, while high/critical advisories and registry failures fail CI. No force fix,
SDK downgrade, dependency override or automatic update is performed.

## Local Supabase and credential handling

The backend job starts only the isolated local `langtify` containers, using the
committed configuration. Fresh startup applies migrations and the development seed.
The job also runs `db:migrate`, the entire SQL suite and the independent disposable
bootstrap database. It serves the real photo Edge Function, then probes for the
handler's explicit authentication denial using a local anonymous key. A generic
API-gateway 401 is insufficient; readiness has a deadline and fails the job.

`scripts/ci-supabase.mjs` captures CLI status in memory and masks local key/secret/token
values in GitHub Actions before the integration suites. It rejects a hosted API URL.
Keys are never placed in `$GITHUB_ENV`, app configuration or artifacts. Startup/function/
shutdown output stays in private runner-temporary logs, which are deliberately never
printed or uploaded because they may contain credentials. Startup failure remains a
failed step; reproduce locally to inspect sensitive diagnostics in a trusted terminal.
Cleanup runs on success/failure/cancellation when the installed CLI is available.
`--no-backup` is appropriate only for the disposable GitHub runner; do not use it to
tear down a developer's persistent stack merely to reproduce CI.

The app job disables dotenv loading and uses a nonfunctional public fixture only for
export. It never receives local service keys, real project configuration, an Expo
token, Google client secret, APNs/FCM credentials or a notification job secret.
Notification sender tests use the existing loopback provider fixture and send no real
push. The scanner now includes YAML so workflow files are covered too.

## GitHub repository setup

No repository secrets, environments, PATs or production credentials are required.
The automatic `GITHUB_TOKEN` has only `contents: read`; checkout does not persist its
credentials. The workflow uses `pull_request`, not `pull_request_target`, so fork PR
code runs without a privileged target-branch context.

Enable GitHub Actions and permit the pinned official `actions/checkout` and
`actions/setup-node` actions. After the first run creates the check names, configure
a ruleset/branch protection for `main` requiring **App and exports** and **Supabase
and Edge Functions**. Keep fork-contributor workflow approval enabled as appropriate
for the repository. Required-check configuration is a repository setting and is not
changed by this checkout. If the default branch changes, update the push filter and
ruleset together. A merge queue would need a future `merge_group` trigger before
requiring these checks in that queue; none is enabled here.

## Local verification and limits

Use Node from `.nvmrc` and the declared npm version, then run `npm ci --no-audit
--no-fund`, `npm run check`, and `node --test scripts/ci-supabase.test.mjs`.
The workflow lists the exact existing npm commands for both jobs. Run shared-database
scripts in that order, with local Supabase and the photo function running. See the
README's Docker Desktop mirror workaround when `/Applications` is not shared;
GitHub-hosted Linux does not need that workaround. Function and database bootstrap
checks use local services only. Keep local CLI status output private.

This implementation was validated locally on Node 24.14.0/npm 11.9.0. Actionlint
1.7.12 (official release binary verified against its release checksum) validated the
workflow syntax, expressions and action inputs. Every referenced `npm run` command
was checked against `package.json`. The four CI-helper tests cover endpoint refusal,
masking/command escaping, gateway-versus-handler readiness, and readiness failure.
Final local results (2026-09-18):

| Check                           | Result                                                                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Lockfile install                | Passed; `npm ci --no-audit --no-fund`, npm 11.9.0                                                                             |
| `npm run check`                 | Passed: typecheck, zero-warning lint, formatting, **325 tests / 38 suites**                                                   |
| CI helper                       | **4 tests passed**; real local status/masking path and photo-handler readiness also passed                                    |
| pgTAP / RLS                     | **661 assertions / 17 files passed** through the documented shared-path mirror                                                |
| Bootstrap / replay              | **17 groups passed**                                                                                                          |
| Existing integration scripts    | All 12 Auth/database integration commands passed, including Storage expiry, concurrency, moderation and notification recovery |
| Database lint                   | Passed with `--level warning --fail-on warning`                                                                               |
| Edge checks/lint/tests          | Passed; **17 Deno tests**                                                                                                     |
| Exports                         | iOS/Android Hermes and web passed, **20 static routes**, with public dummy CI configuration                                   |
| Credential/bundle scan          | Passed, including **2 decoded Hermes bundles** and workflow YAML                                                              |
| Dependency audit                | High/critical gate passed; **14 known moderate findings** remain                                                              |
| Actionlint / command inventory  | Passed; all **22 npm script references** exist and all **17 backend/function scripts** are included                           |
| Git diff / formatting           | Passed                                                                                                                        |
| Expo Doctor / SDK compatibility | Passed after the authorized SDK 57 patch alignment: **21/21** and dependencies up to date                                     |

No tests, dependency checks or compatibility exclusions were weakened to produce
these results. No application code or AGENTS scope was changed. The CI changes cover
the workflow, setup/helper tests, YAML scan coverage, this document and the README
link. The subsequently authorized SDK patch alignment also updates `package.json`
and `package-lock.json`, as detailed below.

A GitHub-hosted run cannot be claimed until the workflow is committed and pushed;
this work does neither. Local startup preserves the existing developer stack; the
bootstrap suite separately tests a fresh database and nonempty migration replays.
Linux runner/cache behavior still needs the first real Actions run.

Native signed builds, camera/permission UX, physical-device deep links, real Google
OAuth, live Expo/APNs/FCM delivery and hosted cron acceptance are outside this
credential-free Linux workflow. The notification HTTP fixture does not prove device
delivery. All three JS exports are validated; they are not native binary builds.

## SDK 57 patch alignment

On 2026-09-18, current Expo recommendations rejected five committed SDK 57 patch
versions. Doctor reported **20/21**, and `expo install --check` failed too:

| Package                | Committed version | Current recommended range |
| ---------------------- | ----------------- | ------------------------- |
| expo                   | 57.0.23           | ~57.0.24                  |
| expo-constants         | 57.0.18           | ~57.0.19                  |
| expo-image-manipulator | 57.0.18           | ~57.0.19                  |
| expo-notifications     | 57.0.19           | ~57.0.20                  |
| expo-router            | 57.0.21           | ~57.0.22                  |

The user authorized resolving these failures before committing CI. All five updates
are patches within SDK 57; published release entries report no user-facing changes.
The `expo@57.0.24` bundled-module map confirms the four companion recommendations.
No SDK generation, React or React Native version changed. Installation used:

```sh
npx expo install expo@~57.0.24 expo-constants@~57.0.19 expo-image-manipulator@~57.0.19 expo-notifications@~57.0.20 expo-router@~57.0.22 --npm
```

The manifest changes only those five ranges. The lockfile also records required
transitive patches: `@expo/cli` 57.0.25 → 57.0.26, `@expo/metro-runtime` 57.0.15 →
57.0.16, `@expo/ui` 57.0.18 → 57.0.19, and `expo-asset` 57.0.17 → 57.0.18.
No unrelated dependencies were upgraded. A clean `npm ci` succeeds; online Doctor
now passes **21/21** and `expo install --check` reports dependencies up to date.
The CI checks remain enforced without exclusions or offline bypasses.

After alignment, typecheck, lint, formatting and all **325 Jest tests / 38 suites**
passed again. All-platform exports also passed again (iOS/Android Hermes and
**20 web routes**), as did the four CI-helper tests and Actionlint. The dependency
audit still reports **14 moderate findings**, with no high or critical findings.
Database and Edge results above are from the preceding CI verification; those
unchanged server components were not rerun for this mobile dependency alignment.

Online compatibility/advisory services can change recommendations even when the
lockfile is unchanged. Rebuild development clients before physical-device acceptance
of native dependency updates; export validation alone does not exercise native code.
