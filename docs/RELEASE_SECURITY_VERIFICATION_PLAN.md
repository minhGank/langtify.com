# Release security verification plan

Prepared 2026-10-19. **Pending; iOS release-security is not cleared.**
The two unsigned-CI exceptions expire at **2026-10-21T00:00:00Z**. They do not
authorize EAS builds, signing, certificate validation, publishing or release jobs.
This plan requires separate approval before any EAS/native build or hosted test.
No build, certificate access or physical-device test was performed for this plan.

## 1. Freeze and inspect the signing toolchain

Release engineer and security reviewer must record the candidate commit, lockfile
SHA-256, exact EAS CLI version (currently pinned 24.11.0), Expo CLI version,
Xcode/macOS versions, selected EAS image and its resolved image identifier. Do not
assume that the root app lockfile describes the remote image or global EAS CLI.

1. Install the pinned EAS CLI into a disposable tooling directory without Apple,
   Expo or Supabase credentials. Save its dependency tree, lockfile and full audit.
   Audit build/prebuild/update/publish tooling separately, without the unsigned-CI
   exceptions. Identify every installed node-forge path and importing package.
2. Trace certificate parsing, CSR verification, certificate-chain verification and
   signature verification separately. In the currently reviewed source,
   `@expo/code-signing-certificates@0.0.6` calls the affected verification APIs;
   EAS CLI's `credentials/ios/utils/p12Certificate.js` parses P12 data and computes
   serials/fingerprints. That limited inspection does not clear the full graph.
3. Establish whether the exact release invokes Expo Updates/manifest signing or
   accepts external certificate material. Current app configuration has no Expo
   Updates code-signing certificate. Native Apple signing and Expo update signing
   are separate trust paths. Document every source of certificate input and every
   verification decision before declaring a vulnerable primitive unreachable.
4. In an isolated test harness, use synthetic disposable keys and certificates,
   never production credentials. Test valid signatures/certificates, tampered
   payloads, wrong-key signatures, malformed padding, and the advisory's low RSA
   exponent regression case against each actual verification entry point. Include
   a normal exponent-65537 control. Run adversarial cases in time-limited child
   processes. Invalid signatures must be rejected, not merely parsed successfully.
   Use an upstream regression fixture where available and record its source/hash.
5. If a reachable verifier accepts invalid material, block release and require a
   supported upstream fix or an independently reviewed mitigation. If the verifier
   is unreachable in this exact workflow, require documented call-path evidence
   and explicit security sign-off; absence from mobile JS alone is insufficient.

The [node-forge advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv)
remains open with no published fix in the reviewed compatible range. Trusted
Apple-issued credentials reduce input risk but do not fix a vulnerable verifier.
Do not print private keys, P12 passwords, certificate contents or provider tokens.

## 2. Verify the runtime URL fallback

`decode-uri-component@0.2.2` is shipped in all three exports. The configured
Router 57.0.28 parser uses `URL.searchParams`; the bundled React Navigation
fallback calls `query-string.parse` and the affected decoder. Five automated
sentinel tests establish this distinction, not exhaustive runtime unreachability.
The [decoder advisory](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr) is fixed
in 0.5.0, outside query-string 7.1.3's `^0.2.2` range. No incompatible override is
approved. A supported parent patch/backport remains the preferred remedy.

1. Inventory every external URL entry: initial native URL, warm Linking event,
   Router navigation, native intent mapping, OAuth/recovery callback, notification
   tap and web history reload. Map each to its parser and sanitation boundary.
2. In a disposable test branch/build, instrument decoder entry with a counter or
   sentinel, without recording URLs, auth codes or query values. Exercise both the
   configured parser and the fallback explicitly. Record whether untrusted input
   can select the fallback and whether decoding occurs before length validation.
3. First run synthetic malformed-percent, incomplete UTF-8 and repeated escape
   cases in isolated processes with a two-second termination limit. Include valid
   Unicode and ordinary links as controls. Test 256 B, 1 KiB, 4 KiB and 16 KiB
   inputs; larger stress cases stay off devices until bounded execution is proven.
   These are verification budgets, not new application input policy.
4. Any reachable pathological decoder path, timeout or unexplained fallback call
   blocks security clearance. Investigate a supported backport or a narrowly scoped
   input/route mitigation with regression tests. Never infer safety from callback
   sanitation alone or catch-and-ignore malformed navigation errors.

## 3. Physical iOS candidate checks, after separate build approval

Use a current supported iPhone/iOS and the oldest supported iOS on an available
physical device. Record model, OS, candidate build number, commit and artifact hash.
Use disposable accounts in an explicitly approved test environment. Do not alter
Production data or hosted Auth settings to run this plan.

| Test                         | Required result                                                                                                                                                                                                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Signed artifact inspection   | Verify Apple signature validity, intended Team ID, bundle ID, distribution profile and entitlements using the actual archive/IPA and Xcode tooling; record results without credentials.                                                                                    |
| Install, cold launch, resume | Approved candidate installs and launches through its intended distribution channel with no signing/entitlement errors.                                                                                                                                                     |
| Ordinary links               | Cold, foreground and background delivery of valid Unicode routes opens the intended screen without stale-account state.                                                                                                                                                    |
| Malformed links              | After isolated tests pass, use bounded synthetic inputs up to 4 KiB. No crash, unintended navigation or UI stall; target under 500 ms handling on the oldest test device and no unresponsive UI over one second. Stop on a freeze and retain timing/counter evidence only. |
| Auth/recovery links          | Valid, expired, replayed and malformed links retain session admission guards, recover safely and never expose callback tokens in logs. Exercise cold and warm app states.                                                                                                  |
| Notification navigation      | Existing daily-word notification opens only the intended current-account screen; no arbitrary URL parsing or cross-account navigation.                                                                                                                                     |
| Native patch regressions     | Camera/library capture, upload/recovery, sign-in/sign-out and push-token registration retain existing behavior. This is not permission to send new remote pushes.                                                                                                          |

Repeat runtime cases on an Android device and browser for cross-platform clearance;
iOS testing alone cannot clear the web/Android decoder. Remove test instrumentation
from the release candidate and verify its final graph/configuration has not changed.
Physical install/launch checks cannot prove that a backend certificate verifier
rejects forged signatures; both the isolated verification and device tracks are
required.

## Evidence and decision

Record each case as pass/fail/not-run with toolchain/artifact hashes, sanitized
timings/counters, input fixture identifier and reviewer. No real callback strings,
personal data, privileged environment values or certificates belong in reports.
Re-run relevant tests on any parser/toolchain change. A green unsigned audit gate
does not satisfy this plan. Release remains blocked on unresolved reachable
verification vulnerabilities or runtime denial-of-service, and on missing evidence
for these paths. There is no automatic extension of the October 21 exceptions.
