# Phase 3 audit — 2026-09-12

Scope: vocabulary catalog and daily challenge engine correctness, concurrency,
security, and durable history. No Phase 4 functionality, dependencies, routes,
architecture, or product policies were added or changed.

## Findings and fixes

1. **Medium — used catalog identities could change.** A privileged catalog edit
   could move a referenced term to another concept or language, leaving its
   historical assignment linked to an incompatible live catalog row. Existing
   text snapshots stayed unchanged, but ordinary single-column foreign keys did
   not protect the relationship. Reproduced before fixing. The additive audit
   migration snapshots assignment languages and adds composite foreign keys for
   target/reference term identity and the challenge language pair. Used term
   identities are now protected even against a concurrent repeatable-read editor.
   Text, CEFR, and activation edits remain possible; unused terms can still be
   corrected. Saved cards retain their original text and levels.
2. **Medium — retired assignment history could be deleted.** Privileged maintenance
   could remove a retired row while retaining its challenge, weakening semantic
   exclusion and assignment recency history. Reproduced before fixing. A database
   trigger now rejects individual assignment deletion while the parent challenge
   remains. Existing parent challenge/account deletion cascades still work; this
   does not introduce a retention policy. Ordinary clients already lacked delete
   privileges; neither this finding nor finding 1 was a client RLS bypass.
3. **Medium — background refresh could swallow a Replace action.** The shared
   request-busy flag silently ignored a tap during an invisible polling read.
   A regression test reproduced it. Read and write activity are tracked separately;
   a replacement supersedes obsolete read responses while duplicate writes remain
   blocked.
4. **Medium — resume/token refresh could leave stale cards after a replacement.**
   A read could complete before an in-flight mutation and invalidate its eventual
   response. Foreground refresh now waits for the write to settle, then reloads
   authoritative state. A same-account token change reconciles through the latest
   gateway. Tests also cover a lost write response and stale/unmounted requests.
5. **Low — invalid internal CEFR/slot inputs defaulted to C2.** PostgreSQL's null
   handling in the previous clamp expression silently produced C2 for invalid or
   missing arguments. Public callers could not directly choose those arguments,
   and existing table checks constrained valid inputs. The private helper now
   rejects invalid/null values explicitly. Valid slot policy is unchanged.
6. **Medium — migration transaction assumptions broke fresh setup.** The installed
   CLI did not supply the transaction required by the older Phase 2 audit
   migration's initial `LOCK TABLE`. The failure was reproduced before any DDL
   from that file executed. Only explicit `BEGIN`/`COMMIT` boundaries were added
   to that file; its original SQL body and version are unchanged. The new Phase 3
   audit migration also supplies its own transaction. Original identity and
   Phase 3 schema migration files are unchanged. A disposable-database replay
   now checks ordered setup and an upgrade with existing assignment history.

The new migration is
`supabase/migrations/20260912030000_phase3_audit_integrity.sql`. It locks affected
tables, checks existing concept/language links before backfill, and fails rather
than guessing a repair for inconsistent history. Backfill and constraints are
atomic. A deliberate preflight failure was tested for absence of partial schema
changes; successful backfill preserved assignment IDs, concepts, text and CEFR.
Migration versions are applied once by the runner; raw additive DDL is not intended
to be replayed repeatedly. A second local migration-runner invocation reported no
pending migrations.

## Reviewed behavior that passed

- Concepts link language equivalents without equating ambiguous spellings.
  One primary term per concept/language is enforced in SQL; different languages
  may assign different CEFR levels. English financial and river-bank meanings
  remain separate. Eligibility requires the exact target language/level and an
  active linked reference term, active concept, and photographability.
- All six CEFR configurations were checked, including A1/A1/A2 and C1/C2/C2.
  There is no fallback to another level when vocabulary is insufficient.
- Generation derives owner, settings, timezone and local date on the server.
  Unique profile/date identity and serialized RPCs prevent duplicate challenges.
  Partial uniqueness and deferred checks enforce exactly three active slots;
  challenge/concept uniqueness includes all replacement history.
- Selection favors unseen concepts and then the oldest most-recent assignment,
  excluding every concept already used in the challenge. Repeated replacement,
  exhaustion, and rollback after partial generation/replacement were exercised.
- The saved language pair, CEFR, date/timezone and displayed terms survive later
  settings/catalog edits. Same-profile/date requests reuse that snapshot; a new
  server-derived local date uses current settings. Fixed timezone/DST cases pass.
  Device clock/timezone does not select the challenge date.
- RLS restricts challenges/history to their owner. Anonymous access, cross-user
  reads/replacements, and direct client mutation are denied. No caller-selected
  replacement term, owner, date, level or language is accepted by the public RPCs.
  Definer functions use empty search paths, qualified references, and authenticated
  ownership checks; private helper execution remains revoked.
- Client services pin requests to the submitting JWT and validate payload
  ownership/completeness. Account/configuration changes invalidate Today state;
  session restoration and stale account responses are covered by application
  tests. No tested cross-user disclosure or mutation path remains.
- Public configuration validation and service-role/public-key separation remain
  intact. Local environment files remain ignored and were not edited by this audit.

## Verification after fixes

| Command/check                                                    | Result                                                                                                                                                                            |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                                                  | Typecheck, lint with zero warnings, formatting, and **103 application tests in 12 suites passed**. Includes four new challenge request-ordering regressions.                      |
| `npx supabase test db /private/tmp/langtify-phase3-audit-tests/` | **162 pgTAP tests in five suites passed**, including 20 new integrity tests and all Phase 2 tests.                                                                                |
| `npm run db:test:challenges`                                     | Four concurrency scenarios passed: simultaneous creation, same-ID replacement, different-slot replacement, and repeatable-read catalog edit versus newly committed assignment.    |
| `npm run db:test:integration`                                    | Five identity/seed/migration safety scenarios passed.                                                                                                                             |
| `npm run db:test:bootstrap`                                      | Ordered schema replay/nonempty backfill and inconsistent-history rollback checks passed in a disposable database.                                                                 |
| `npx supabase db lint --local --level warning`                   | No schema errors.                                                                                                                                                                 |
| `npx supabase migration up --local`                              | New audit migration applied locally; subsequent run had no pending migrations.                                                                                                    |
| `npx supabase gen types typescript --local --schema public`      | Fresh temporary generated output matched `src/types/database.ts` after repository formatting.                                                                                     |
| `node /private/tmp/langtify-phase3-smoke.cjs`                    | Real local Auth/REST confirmation, sign-in, onboarding, generation/retry, replacement, own-history read, persisted SDK restoration, and sign-out passed; fixture account removed. |
| `npx expo install --check`                                       | Dependencies compatible/up to date.                                                                                                                                               |
| `npm run doctor`                                                 | **21/21 checks passed.**                                                                                                                                                          |
| `npx expo config --type public --json`                           | Public Langtify configuration resolved successfully.                                                                                                                              |
| `CI=1 npm run export:check -- --clear`                           | Fresh **iOS, Android and web** production bundle exports passed.                                                                                                                  |
| Credential/whitespace review                                     | No privileged JWT, Supabase secret key or private-key material found in reviewed repository files or exported bundles; local env ignored; `git diff --check` passed.              |

Docker Desktop does not share the workspace's `/Applications` path. SQL suites
were copied unchanged into the shared temporary directory and run with the normal
Supabase test runner, as documented in README. SQL suites roll back their fixtures;
integration fixtures and the disposable bootstrap database are removed. No hosted
database was modified. Bootstrap models the minimal Auth SQL contract and does
not simulate provisioning the full Supabase stack.

An intermittent pre-existing React `act` warning was traced to a session test
finishing before deferred token-refresh revalidation. The test now waits for the
load and observes the refreshed account; no auth implementation change was needed.
The Supabase type generator emitted its own listener-count warning but exited
successfully with matching types. Bundle tooling's color-environment warnings
also did not affect export success.

## Remaining risks and closure

**Phase 3 is safe to close as an implementation milestone based on the local
verification above; no known blocking defect remains in the audited scope.** This
does not certify a production deployment or replace physical-device acceptance.

- Apply the pending audit migration to each intended environment before relying
  on its invariants. Back up important data and investigate any preflight failure;
  the migration intentionally refuses inconsistent history. Table locks/backfill
  may need a maintenance window on a large dataset.
- Test on both iOS and Android: force-close/session restoration, same-day challenge
  persistence, repeated replacement/exhaustion, two-device replacement races,
  replacement during background/resume or token refresh, offline recovery, account
  switching during requests, local midnight, and accessibility. Detailed steps are
  in [Phase 3 verification](PHASE3_VERIFICATION.md#target-setup-and-exact-phone-tests).
  Exports are not signed native binaries; no phone or hosted rollout was performed.
- Development vocabulary still needs expert translation/CEFR/photographability and
  licensing review. Relational constraints cannot prove that a human supplied the
  correct meaning or level. Catalog identity corrections for used terms now need
  explicit new catalog records rather than silently reparenting history.
- Catalog selection and per-user serialization need realistic load testing before
  substantial traffic. The active screen refreshes at a one-minute interval;
  offline refresh cannot discover a new server date. Persisted timezone changes
  may select another date under the existing policy; no cooldown was invented.
- Privileged administrators can remove parent challenges/accounts or override
  database protections deliberately. Existing session-storage and JWT-lifetime
  limitations remain as documented in the Phase 2 audit. The credential scan is
  not a forensic audit of old Git history or external infrastructure.

Phase 4 has not started.

## Files changed by this audit

Compared with the working tree at audit start, preserving pre-existing Phase 3
implementation changes. Generated exports, temporary checks and ignored runtime
files are excluded. Dependency versions and `package-lock.json` are unchanged.

- `AGENTS.md`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/DATA_MODEL.md`
- `docs/DECISIONS.md`
- `docs/PHASE2_AUDIT.md`
- `docs/PHASE3_AUDIT.md`
- `docs/PHASE3_VERIFICATION.md`
- `package.json` (bootstrap test command only)
- `scripts/lib/local-db.mjs`
- `scripts/test-challenges-integration.mjs`
- `scripts/test-db-bootstrap.mjs`
- `scripts/test-db-integration.mjs`
- `src/features/challenges/use-today-challenge.ts`
- `src/types/database.ts`
- `supabase/migrations/20260912010000_phase2_audit_invariants.sql` (transaction wrapper only)
- `supabase/migrations/20260912030000_phase3_audit_integrity.sql`
- `supabase/tests/phase3-audit.test.sql`
- `supabase/tests/phase3.test.sql`
- `tests/challenge-state.test.tsx`
- `tests/session-state.test.tsx`
