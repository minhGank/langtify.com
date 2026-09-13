# Phase 4 security and recovery audit

Audited locally on 2026-09-12/13. No Phase 5 feature or product-policy change was
made. The existing working tree already contained the Phase 4 implementation;
this report covers only changes made during its audit. Earlier migration files,
mobile dependencies and `.env.local` were preserved.

## Findings and fixes

| Severity         | Finding and reproduction                                                                                                                                                                                                  | Fix                                                                                                                                                                                                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High             | A normal authenticated caller uploaded `not an image` with `image/jpeg`, then successfully finalized it. MIME metadata was treated as proof of an image.                                                                  | `photo-authority` verifies Auth and owner RLS, downloads and fully decodes the JPEG, rejects embedded/trailing metadata, and enforces 5 MiB/1600-pixel/decoder memory limits. A private SHA-256/dimensions receipt binds verification to the exact immutable Storage object ID/version. SQL finalization requires that receipt. |
| High             | A signed upload capability obtained while pending recreated its object after deletion. Storage checks permission before receiving bytes, with an elevated commit afterward; the old RLS lock did not cover that interval. | Standard-upload-only RLS plus a bucket-scoped commit trigger rechecks owner, reservation status and expiry. The trigger also prevents content/version mutation and deletion of live pending/completed images, including elevated Storage operations.                                                                            |
| Medium           | The app requested 60 seconds, but a normal owner could mint a one-year signed read URL directly.                                                                                                                          | Ordinary single/batch/transform signing is denied. The Auth-verified function accepts an owned submission ID, fixes the lifetime at 60 seconds and returns a relative path; it never forwards a caller's path, TTL or transformation options.                                                                                   |
| Medium           | A repeatedly failing oldest cleanup job monopolized a batch of one; the next valid deletion was never attempted.                                                                                                          | Queue attempts rotate behind unattempted work. Discovery excludes already-queued items, so existing failures cannot monopolize discovery either. Durable retry, concurrent-worker safety and live-object protection remain intact.                                                                                              |
| Medium           | Late preprocessing could prune a newer draft after screen remount; an old draft read could restore a photo after Retake. A late camera result could also start preprocessing after camera unmount.                        | Capture generations cancel obsolete work before cache writes/pruning; late cleanup is limited to its exact URI. Retake/new capture invalidate pending reads. An unmounted camera discards its raw result.                                                                                                                       |
| Deployment guard | Existing completed rows were never verified from bytes. Automatically creating verification receipts for them would preserve the original bypass.                                                                         | The additive audit migration refuses such rows transactionally, without changing/deleting data. A regression checks both refusal and absence of partial schema changes. The local database had no preexisting submissions.                                                                                                      |

No cross-user photo-read, submission-write or image-delete path succeeded in the
local probes. Public visibility still leaves both bucket and owner access private.
No ordinary client can attest bytes or invoke cleanup. Reserved paths, one live
submission per assignment, replacement blocking, immutable vocabulary snapshots,
and deletion-before-release remain enforced by PostgreSQL.

Completion is still reserve -> upload -> finalize, with one small Supabase function
added for technical enforcement. No external custom backend, gallery, AI validation,
feed, streak or other Phase 5 feature was introduced. The decoder is server-only;
no new mobile dependency was added. The function's npm imports and Deno tool version
are pinned separately from Expo.

## Verification

| Command/check                                                   | Result                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                                                 | Typecheck, zero-warning application lint, formatting; **147 tests in 19 suites passed**.                                                                                                                                                                                                                 |
| `npm run functions:check`, `functions:lint`, `functions:test`   | Strict server typecheck, Deno lint and **4 image-validation tests passed**. Tests include real pixels, fake JPEG scans, truncation, APP/comment/trailing metadata and resource limits.                                                                                                                   |
| `npx supabase test db /private/tmp/langtify-phase4-audit-tests` | **215 pgTAP assertions in six suites passed**, including 53 Phase 4 database/Storage-policy assertions.                                                                                                                                                                                                  |
| `npm run db:test:submissions`                                   | Ten real local Auth/Storage scenario groups passed: ownership, upload constraints, restart/uncertain-response recovery, concurrent reserve/finalize, replacement denial, deletion/expiry cleanup and account cascades.                                                                                   |
| `npm run db:test:photo-audit`                                   | Malformed-image/metadata refusal, private attestation, single/batch signing denial, owner-only function access, actual signed-link expiry, cleanup fairness/live-object protection, overlapping workers, a real mid-body abort with physical-file inspection, and simultaneous upload protection passed. |
| `npm run db:test:integration`                                   | Five identity/seed/concurrency/migration scenarios passed.                                                                                                                                                                                                                                               |
| `npm run db:test:challenges`                                    | Four challenge/catalog concurrency scenarios passed.                                                                                                                                                                                                                                                     |
| `npm run db:test:bootstrap`                                     | Four migration/backfill/preflight scenario groups passed, including safe refusal of unverified completed photos.                                                                                                                                                                                         |
| `npx supabase db lint --local --level warning`                  | No schema errors.                                                                                                                                                                                                                                                                                        |
| `npm run doctor`, `npx expo install --check`                    | **21/21 Doctor checks passed**; Expo dependencies compatible.                                                                                                                                                                                                                                            |
| `npx expo config --type public`, `npm run export:check`         | Public config resolved; **iOS, Android and web exports passed**.                                                                                                                                                                                                                                         |
| `npm run security:scan`, `git diff --check`                     | No privileged credentials or server verifier code in app bundles; no whitespace errors. Native Hermes bundles are decoded before credential scanning.                                                                                                                                                    |
| Dependency audit                                                | Existing application tree: **14 moderate**, zero high/critical advisories. Separate server dependency audit: **zero advisories**. No forced dependency changes.                                                                                                                                          |

SQL fixtures run in rollback-only transactions. Integration scenarios create and
remove random local accounts and use actual local Auth, Storage and Edge Runtime.
The signed-link expiry test leaves its image present until expiry, then verifies
that the previously working link stops serving it. Cleanup tests force an oldest
job failure and verify that later work still completes without deleting the live
image. A direct authenticated request inside the local Storage container aborts
after its partial backing file appears; the test verifies removal, successful retry
using the same reservation, and physical deletion afterward. This bypasses only
local Kong request buffering; the normal Storage authentication/RLS path still runs. Native tests cover session loss during upload, committed-but-lost responses,
stale draft reads, capture cancellation and account remounts.

Docker Desktop does not share `/Applications/langtify.com`; SQL tests and the
function were served from matching copies under `/private/tmp`. No hosted database,
Storage bucket, account, function or scheduler was changed. Deno checks ran with
2.9.6; actual function integration ran in Supabase Edge Runtime 1.74.3. The Node
integration runner emits a harmless module-type warning for its shared TypeScript
JPEG helper. Earlier migration hashes were checked against the audit-start snapshot.

## Remaining risks and closure

The audited local implementation passes its checks. **Production closure remains
gated on the following deployment and device acceptance work:**

1. Deploy the function and the additive migration to the reviewed target project,
   then rerun the smoke tests there. If preexisting completed submissions are
   present, prepare a reviewed, version-bound byte-verification backfill first;
   the migration intentionally stops rather than blessing or deleting those photos.
   This audit did not implement or execute a backfill against an unknown hosted dataset.
2. Install and monitor the hourly cleanup job. The repository supplies the worker
   and cron example; no persistent external schedule was installed. Monitor retries
   and backlog, and size the batch/frequency for actual traffic.
3. Previously issued signed URLs remain bearer capabilities until their original
   expiry; deploying new RLS does not revoke old URLs or erase downloaded copies.
   Account for old long-lived capabilities during rollout. The new function only
   issues 60-second links. Camera provenance or image semantics cannot be proven
   from JPEG bytes; no AI/content evaluation was added.
4. Complete the [iOS/Android phone checklist](PHASE4_VERIFICATION.md#exact-physical-phone-acceptance-tests),
   especially high-resolution orientation/colors, real metadata absence, camera
   permission recovery, two-device submission, background/resume, session loss,
   token refresh, force-close recovery, account switching and interrupted deletion.
   Add rapid leave/reopen during preprocessing to confirm a newer draft survives.
   Exports are not signed native builds or physical-device testing.
5. Review the existing Expo dependency advisories on compatible updates. Cache
   storage remains app-private and best-effort, not encrypted. Credential scanning
   covers 143 current source/config/export artifacts (including two decoded Hermes
   bundles), not all Git history or external
   infrastructure. Production load and operational failure testing remain separate. Supabase owns
   cleanup of unfinished internal object versions; catastrophic provider/process
   failures and its internal cleanup queue require operational monitoring.

Phase 4 may close as a **locally audited implementation**, with the release gates
above explicitly tracked. It is not an unconditional production-release approval.
Phase 5 has not started.

## Audit changed files

34 files differ from the audit-start working tree. Preexisting Phase 4 changes
are excluded from this list unless the audit also modified them.

- `AGENTS.md`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/DATA_MODEL.md`
- `docs/DECISIONS.md`
- `docs/PHASE4_AUDIT.md`
- `docs/PHASE4_VERIFICATION.md`
- `docs/ROADMAP.md`
- `eslint.config.js`
- `package.json`
- `scripts/scan-credentials.mjs`
- `scripts/test-db-bootstrap.mjs`
- `scripts/test-photo-audit.mjs`
- `scripts/test-submissions-integration.mjs`
- `src/features/photos/camera-capture.tsx`
- `src/features/photos/photo-files.ts`
- `src/features/photos/photo-screen.tsx`
- `src/features/photos/use-assignment-photo.ts`
- `src/services/submissions.ts`
- `src/types/database.ts`
- `supabase/config.toml`
- `supabase/functions/photo-authority/deno.json`
- `supabase/functions/photo-authority/deno.lock`
- `supabase/functions/photo-authority/index.ts`
- `supabase/functions/photo-authority/validate-photo.ts`
- `supabase/functions/photo-authority/validate-photo_test.ts`
- `supabase/migrations/20260912050000_phase4_audit_storage.sql`
- `supabase/tests/phase4.test.sql`
- `tests/camera.test.tsx`
- `tests/photo-files.test.ts`
- `tests/photo-fixtures.ts`
- `tests/photo-service.test.ts`
- `tests/photo-state.test.tsx`
- `tsconfig.json`
