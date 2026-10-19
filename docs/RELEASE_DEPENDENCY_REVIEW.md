# Release dependency security review

Dependency review: 2026-10-14. Exception activation review: 2026-10-19.
The user approved only the two high-advisory exceptions below through
**2026-10-21T00:00:00Z**, restricted to the reviewed unsigned CI job.
No severity threshold changed and no moderate finding is hidden.
**iOS release-security remains uncleared.** See the separate
[verification plan](RELEASE_SECURITY_VERIFICATION_PLAN.md).

## Compatible updates

The earlier seven recommendations became ten when Expo published more patches.
These are the current `expo install --check` recommendations, installed with
`expo install`; `jest-expo` remains a development dependency.

| Package            | Before  | After   |
| ------------------ | ------- | ------- |
| expo               | 57.0.27 | 57.0.29 |
| expo-auth-session  | 57.0.14 | 57.0.16 |
| expo-constants     | 57.0.21 | 57.0.22 |
| expo-crypto        | 57.0.3  | 57.0.4  |
| expo-dev-client    | 57.0.19 | 57.0.20 |
| expo-linking       | 57.0.12 | 57.0.13 |
| expo-notifications | 57.0.22 | 57.0.23 |
| expo-router        | 57.0.25 | 57.0.27 |
| expo-splash-screen | 57.0.9  | 57.0.10 |
| jest-expo          | 57.0.5  | 57.0.6  |

The lockfile includes the installer's compatible transitive resolutions, including
Expo modules/CLI, Babel/Metro support and Radix dependencies beneath Router/Vaul.
No direct package major, Expo SDK major/minor, React Native version or Jest major
changed. No override or forced audit fix was used. A clean `npm ci` succeeded.
Installed changelogs describe a native BufferSource fix in expo-crypto and an
Android Expo Go import fix in expo-notifications; the other available module
changelogs describe maintenance releases without user-facing changes.

`npm audit fix --dry-run --json` did not eliminate any of the five advisories.
Its remaining work included an unrelated Worklets patch and dependency relocation;
that additional mutation was not applied. The safe Expo patches are not claimed
as fixes for the audit findings.

## All advisory causes

Before and after: **0 critical, 49 high, 16 moderate** package findings. These are
five distinct advisories propagated through dependent packages, not 65 distinct
vulnerabilities. All five affected packages are transitive dependencies.

| Advisory and installed package                                                                                 | Exposure and consequence                                                                                                                                                                                       | Practical supported fix                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), braces 3.0.3, high                   | Metro/micromatch and Jest build/test glob processing; nested untrusted patterns can terminate the Node process. Absent from all three app exports.                                                             | None published. Current micromatch 4.0.8 requires `^3.0.3`. A Jest major upgrade does not prove removal from Metro.                                |
| [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv), node-forge 1.4.0, high               | Expo certificate/signature tooling; malformed RSA verification input can permit signature forgery with low-exponent keys. Absent from all app exports.                                                         | None published. Expo CLI and code-signing-certificates require `^1.3.3`; all published compatible versions remain affected.                        |
| [GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr), decode-uri-component 0.2.2, moderate | Shipped JavaScript URL decoding code; malicious malformed input can consume CPU. See the call-path qualification below.                                                                                        | Fixed in 0.5.0, outside query-string 7.1.3's `^0.2.2` range. Router 57.0.27 still requires query-string `^7.1.3`; no compatible 7.x fix published. |
| [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c), sprintf-js 1.0.3, moderate           | Istanbul/Jest configuration tooling through argparse 1.0.10; attacker-controlled precision specifiers can throw RangeError. Absent from app exports.                                                           | No published fix, including latest 1.1.3. The parent requires `~1.0.2`. No exemption requested.                                                    |
| [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq), uuid 7.0.3, moderate                 | Xcode project generation, not app UUID generation. The inspected xcode call uses `uuid.v4()` without a destination buffer; the reported v3/v5/v6 buffer issue is not exercised there. Absent from app exports. | Fixed starting at 11.1.1, outside current xcode 3.0.1's `^7.0.3` range. No supported parent update found. No exemption requested.                  |

The audit's suggested Expo 44 / splash-screen 55 downgrades, Router 58 and Jest 30
changes are not compatible fixes for this SDK 57 release. No dependency range was
violated to force a newer decoder or UUID implementation.

## Shipped code and URL parsing

Fresh production-mode iOS, Android and web source maps each include
`decode-uri-component`; none includes braces, node-forge, sprintf-js or uuid.
These exports use CI's nonfunctional public backend fixtures and do not contact
hosted Supabase. Bundle inspection does not audit native binaries or EAS tooling.

The previous blanket claim that the default Router query path invokes the vulnerable
decoder is too broad. In Router 57.0.27, `getLinkingConfig` installs the Router fork
of `getStateFromPath`. Its `parseQueryParams` uses `URL.searchParams`. The bundled
React Navigation core fallback still invokes `query-string.parse`, which calls the
affected decoder. Router serialization uses query-string's stringify operation.

`tests/release-url-parser.test.ts` makes the decoder throw a sentinel error. Valid
and malformed input passes through the configured parser without invoking it;
the core fallback reaches the sentinel. This protects the reviewed distinction
against dependency changes. It is not an exhaustive end-to-end proof for every
navigation path, nor a patched decoder. Native/web device deep-link verification
and a supported upstream backport remain release-security work. Do not mark the
moderate finding fixed or exclude it from the audit. Existing OAuth callback
sanitation alone is not a general URL denial-of-service mitigation.

## Apple signing and release workflows

Expo's `@expo/code-signing-certificates` 0.0.6 calls `certificate.verify`,
`certificate.publicKey.verify` and CSR verification. These are concrete uses of
the affected verification primitive. Default generated RSA keys use exponent
65537, while the advisory describes low-exponent keys; that reduces relevance
for those generated keys but is not a guarantee for externally supplied material.
This is Expo manifest/update certificate machinery, not proof that Apple's native
`codesign` verifier is vulnerable. Langtify does not configure an Expo Updates
code-signing certificate in app.json/app.config.js.

The separately pinned EAS CLI 24.11.0 also directly requires node-forge 1.4.0.
Read-only inspection of its published package found use in
`build/credentials/ios/utils/p12Certificate.js` for P12 parsing, serial numbers
and fingerprints, not a direct call to the affected RSA signature verifier.
This does not establish exploitation in that Apple credential path, and does not
clear its entire dependency graph or the remote build image. No certificate,
private key, Apple account or EAS build was accessed in this review.

Signing approval must remain separate: review the exact EAS CLI/build-image graph,
use trusted Apple-issued credential material, and do not extend unsigned-CI
exceptions to certificate validation, publishing or EAS builds. Physical-device
checks must cover login/recovery links, ordinary deep links, capture and push-token
registration after these native dependency patches. Exports are not signed builds.

## Approved temporary exceptions — 2026-10-19

The active file is [`../scripts/audit-exceptions.json`](../scripts/audit-exceptions.json).
[`npm-audit-exceptions.proposed.json`](npm-audit-exceptions.proposed.json) preserves
the original October 14 proposal as historical review data; CI never loads it.
Only the two reviewed entries were activated, with their proposed exact graph
and **2026-10-21T00:00:00Z** expiry. No automatic renewal is allowed.

Before activation, the frozen CI app job was checked: read-only GitHub permissions,
no persisted checkout credentials, only tests/unsigned exports and public dummy
backend values, no EAS build, signing, publishing or certificate-validation step.
Policy regressions reject signing/publishing/release scopes and other GitHub jobs.
The scope guard now also rejects EAS worker ID, project ID, runner and platform
markers, in addition to build/profile flags. This covers custom EAS VM jobs that
may lack the standard build flag, per the official
[EAS workflow environment documentation](https://docs.expo.dev/eas/workflows/environment/)
and [EAS built-in variables](https://docs.expo.dev/eas/environment-variables/usage/).
Changing the fingerprinted workflow/configuration or lock graph fails closed.
Local invocation is authorized only to reproduce the unsigned job; this policy
is not a sandbox against an operator deliberately removing environment markers
or running signing commands separately. A pass never grants release authority.

The active policy fixes exact advisory/package/version/install-path and immediate parent
paths/ranges. A full lockfile fingerprint also fixes ancestor and peer relationships;
configuration fingerprints fix the reviewed workflow and release configuration.

- braces 3.0.3: `node_modules/braces`; parent `node_modules/micromatch` 4.0.8,
  dependency `^3.0.3`. Residual risk is build/test process denial of service from
  malicious glob input. CI has no deployment/signing credentials, read-only GitHub
  permissions and a job timeout; those contain impact but do not fix the parser.
- node-forge 1.4.0: `node_modules/node-forge`; parents
  `node_modules/expo/node_modules/@expo/cli` 57.0.30 and
  `node_modules/@expo/code-signing-certificates` 0.0.6, both dependency `^1.3.3`.
  Residual signature-verification risk is unacceptable for a blanket release
  exception. Eligibility is only the reviewed unsigned tests/exports, which do
  not invoke certificate validation or signing. Future workflow changes need review.

Approval permits only findings whose high-severity causes are entirely these
exact entries. Critical and unknown high findings, changed dependency paths,
expired/stale exceptions, missing bundle evidence, EAS contexts, and audit/network/
parsing errors still fail. Moderate findings remain fully reported. New scope must
never be inferred from a green unsigned check. Neither exception fixes
the runtime decoder or establishes App Store release readiness.

## Historical verification — 2026-10-14

No hosted settings, migration deployment, EAS build, commit or push is part of
this task. Local results:

| Check                                                      | Result                                                                                                                                                                 |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean `npm ci --no-audit --no-fund`; `npm ls --all --json` | Pass; lockfile installs and dependency ranges resolve.                                                                                                                 |
| `npm run check`                                            | Pass: TypeScript, ESLint, Prettier; 1,045 tests / 91 suites. Includes five new parser-call-path regressions.                                                           |
| CI setup and audit-policy tests                            | 23 passed.                                                                                                                                                             |
| Edge Function typecheck, lint and tests                    | Pass; 33 tests.                                                                                                                                                        |
| All-platform production-mode export with source maps       | Pass: iOS, Android, web.                                                                                                                                               |
| Credential/source/Hermes scan                              | Pass: 588 files and two decoded Hermes bundles.                                                                                                                        |
| Expo Doctor; SDK compatibility                             | 21/21; dependencies up to date.                                                                                                                                        |
| SQL/RLS tests                                              | 1,784 assertions / 31 files passed.                                                                                                                                    |
| Sequential Auth/DB/Storage integrations and database lint  | Pass: all 18 `db:test:*` integration/bootstrap commands, Auth integration, rollback-only guidance import/replay, and database lint.                                    |
| `npm audit --audit-level=high`                             | Fails: 49 high, 16 moderate, zero critical; five advisory causes unchanged.                                                                                            |
| Unchanged real CI audit policy                             | Fails closed: package.json scope fingerprint changed; old lock fingerprint and expired exceptions also remain invalid. Full audit is printed before policy validation. |
| Inactive proposal simulation                               | All 65 findings reported; reviewed unsigned case passes, expiry boundary and EAS contexts fail. This is not active CI approval.                                        |

Migrations are exercised through disposable bootstrap/replay and rollback-only
guidance fixtures. The persistent local migration-history table was not repaired
or advanced; the existing local schema was used for integration tests. These are
local CI-equivalent checks, not a new GitHub Actions run or a clean hosted-stack
provisioning claim. Signed native builds and physical-device acceptance remain
unverified. CI and iOS release-security approval are **not ready** merely because
Expo Doctor and application tests pass.

## Activation verification — 2026-10-19

The real audit policy passes with fresh three-platform source maps and the
locally reproduced GitHub app-job context: all 65 findings are printed, including 49 high
findings covered only by the two explicit advisory causes and 16 visible moderates.
Critical findings remain unconditionally blocking. Unknown high findings, graph or
configuration drift, expired exceptions, missing bundle evidence and audit errors
still fail. The raw `npm audit --audit-level=high` status remains nonzero; these are
accepted temporary unsigned-tooling risks, not vulnerability fixes.

The active full graph was separately checked at 2026-10-20T23:59:59.999Z (pass)
and 2026-10-21T00:00:00Z (reject). EAS worker IDs/build flags and release/signing/
publishing scopes reject. Neither braces nor node-forge appears in fresh platform
source maps. The vulnerable decoder appears in every platform; decoder, Router
and query-string retain explicit runtime-warning rows.

| Check                                      | October 19 result                                                                                         |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Clean locked install                       | Pass; Node 24.14.0, npm 11.9.0.                                                                           |
| CI setup and audit-policy regression tests | 24 passed, including exact expiry, EAS custom workers and signing/publishing scope rejection.             |
| Application check                          | Pass: TypeScript, ESLint, formatting; 1,045 tests / 91 suites.                                            |
| Edge Function checks/lint/tests            | Pass; 33 tests.                                                                                           |
| iOS/Android/web exports with source maps   | Pass; unsigned public-fixture exports.                                                                    |
| Credential scan                            | Pass; 589 files and two decoded Hermes bundles.                                                           |
| SQL/RLS                                    | Pass; 1,784 assertions across 31 files.                                                                   |
| Sequential local integrations/replay/lint  | Pass: Auth, all 18 integration/bootstrap commands, guidance rollback-only replay and local database lint. |
| Real audit policy                          | Pass; 0 critical, 49 high, 16 moderate, all 65 reported.                                                  |
| Expo Doctor / SDK check                    | Fail; 20/21 and two newly recommended patches.                                                            |

Expo Doctor currently reports 20/21: newly recommended patches are expo 57.0.30
and expo-router 57.0.28. SDK compatibility also fails for these two versions.
They were not installed during this exception activation: that would change the
reviewed graph and require fresh dependency/path/scope review. No exclusion was added.
The next CI fix is to review and install only those supported patches, then repeat
exports, tests and the advisory/path review. Any corresponding fingerprint change
needs explicit review; it must not extend the October 21 expiry or add exceptions.
These are local equivalents of the CI commands, not a new GitHub Actions run.
Persistent local migration history was not changed; the full schema was exercised
through disposable bootstrap and rollback-only replay, with integrations against
the existing local stack. No hosted project, signed build or physical device was used.
Overall CI is not green until Doctor and SDK compatibility pass. The separate
release-security verification plan remains pending regardless of CI status.

## Final Expo patch verification — 2026-10-19

The subsequent user request authorizes the two remaining compatible patches and
normal commit/push only after CI-equivalent verification succeeds. Installed with
`EXPO_NO_DOTENV=1 npx expo install 'expo@~57.0.30' 'expo-router@~57.0.28' --npm`,
following the [Expo install workflow](https://docs.expo.dev/more/expo-cli/#install).
This section supersedes the earlier Doctor/SDK failure above.

Direct changes in this pass are expo 57.0.29 → 57.0.30 and Router 57.0.27 → 57.0.28.
The installer also updated Expo CLI 57.0.30 → 57.0.31, its Router server
57.0.12 → 57.0.13, Expo UI 57.0.24 → 57.0.25, Babel preset 57.0.15 → 57.0.16,
osascript 2.7.1 → 2.8.1, package-manager 1.13.1 → 1.14.2 and PostCSS
8.5.30 → 8.5.31; package-manager gained its compatible json-file 11.2.1 copy.
All satisfy declared dependency ranges. No forced update, override, SDK upgrade,
Jest major upgrade or unrelated direct dependency change was introduced.
A clean `npm ci` and full `npm ls --all --json` passed.

The published previous CLI tarball was compared with the installed patch:
`utils/codesigning.js`, `run/ios/codeSigning/Security.js`, `export/exportApp.js`
and `export/index.js` are byte-identical. Changed CLI JavaScript files only raise the
Atlas prerequisite from ^0.4.0 to ^0.5.0 and update CLI version labels in telemetry
and events. This bounds the unsigned-export
review; it does not clear the broader signing toolchain.

The existing two exceptions retain the same advisory/package/version/install-path,
parent ranges, unsigned-only restrictions and **2026-10-21T00:00:00Z** expiry.
Only the package.json/lockfile fingerprints and the exact Expo CLI parent version
(57.0.31 at the same path) changed after review. Other configuration fingerprints
are unchanged. No extra exception or longer grace period was added.
The historical proposal is not active and intentionally retains its old graph.

Current results: Doctor **21/21**, SDK compatibility **pass**, clean install/tree
**pass**; `npm run check` passes TypeScript, lint, formatting and **1,045 tests /
91 suites**. The five URL-parser regressions also pass on Router 57.0.28.
All **24** CI setup/policy tests and **33** Edge Function tests pass. Fresh
unsigned iOS/Android/web exports pass, and the credential scan passes **589 files
and two decoded Hermes bundles**. The real audit policy passes with **0 critical,
49 high and 16 moderate**, retaining every finding and runtime warning.
SQL/RLS passed **1,784 assertions / 31 files**. All **18** sequential database/
Storage integration and bootstrap commands, Auth integration, rollback-only guidance
replay and database lint passed. Local CI-equivalent verification is **green**.
This is not a claim about a subsequent GitHub Actions run; migration replay used
local disposable fixtures and no hosted state changed.
iOS release-security remains **uncleared**;
[the separate verification plan](RELEASE_SECURITY_VERIFICATION_PLAN.md) still applies.

## Complete reported package inventory

Severity is npm’s propagated package severity. Exposure follows the advisory causes
above; a runtime package such as React Native can inherit a high finding solely
through its build/test dependencies. This table does not classify every module in
such a package as vulnerable. Every row remains visible in the real audit output.

| Package                            | Severity | Advisory causes          |
| ---------------------------------- | -------- | ------------------------ |
| @expo/cli                          | high     | braces, node-forge, uuid |
| @expo/code-signing-certificates    | high     | node-forge               |
| @expo/config                       | moderate | uuid                     |
| @expo/config-plugins               | moderate | uuid                     |
| @expo/inline-modules               | moderate | uuid                     |
| @expo/local-build-cache-provider   | moderate | uuid                     |
| @expo/metro                        | high     | braces                   |
| @expo/metro-config                 | high     | braces, uuid             |
| @expo/prebuild-config              | moderate | uuid                     |
| @istanbuljs/load-nyc-config        | moderate | sprintf-js               |
| @jest/console                      | high     | braces                   |
| @jest/core                         | high     | braces, sprintf-js       |
| @jest/environment                  | high     | braces                   |
| @jest/expect                       | high     | braces, sprintf-js       |
| @jest/fake-timers                  | high     | braces                   |
| @jest/globals                      | high     | braces, sprintf-js       |
| @jest/reporters                    | high     | braces, sprintf-js       |
| @jest/test-result                  | high     | braces                   |
| @jest/test-sequencer               | high     | braces                   |
| @jest/transform                    | high     | braces, sprintf-js       |
| @react-native/community-cli-plugin | high     | braces                   |
| @react-native/jest-preset          | high     | braces, sprintf-js       |
| @react-native/metro-config         | high     | braces                   |
| @react-native/virtualized-lists    | high     | braces, sprintf-js       |
| @types/jest                        | high     | braces                   |
| argparse                           | moderate | sprintf-js               |
| babel-jest                         | high     | braces, sprintf-js       |
| babel-plugin-istanbul              | moderate | sprintf-js               |
| braces                             | high     | braces                   |
| create-jest                        | high     | braces, sprintf-js       |
| decode-uri-component               | moderate | decode-uri-component     |
| expect                             | high     | braces                   |
| expo                               | high     | braces, node-forge, uuid |
| expo-router                        | moderate | decode-uri-component     |
| expo-splash-screen                 | moderate | uuid                     |
| jest                               | high     | braces, sprintf-js       |
| jest-circus                        | high     | braces, sprintf-js       |
| jest-cli                           | high     | braces, sprintf-js       |
| jest-config                        | high     | braces, sprintf-js       |
| jest-environment-jsdom             | high     | braces                   |
| jest-environment-node              | high     | braces                   |
| jest-expo                          | high     | braces, sprintf-js       |
| jest-haste-map                     | high     | braces                   |
| jest-message-util                  | high     | braces                   |
| jest-resolve                       | high     | braces                   |
| jest-resolve-dependencies          | high     | braces, sprintf-js       |
| jest-runner                        | high     | braces, sprintf-js       |
| jest-runtime                       | high     | braces, sprintf-js       |
| jest-snapshot                      | high     | braces, sprintf-js       |
| jest-watch-typeahead               | high     | braces, sprintf-js       |
| jest-watcher                       | high     | braces                   |
| js-yaml                            | moderate | sprintf-js               |
| metro                              | high     | braces                   |
| metro-config                       | high     | braces                   |
| metro-file-map                     | high     | braces                   |
| metro-transform-worker             | high     | braces                   |
| micromatch                         | high     | braces                   |
| node-forge                         | high     | node-forge               |
| query-string                       | moderate | decode-uri-component     |
| react-native                       | high     | braces, sprintf-js       |
| react-native-reanimated            | high     | braces                   |
| react-native-worklets              | high     | braces                   |
| sprintf-js                         | moderate | sprintf-js               |
| uuid                               | moderate | uuid                     |
| xcode                              | moderate | uuid                     |
