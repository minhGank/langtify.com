# Concept photo guidance

Local implementation, 2026-10-13. No hosted project changes or catalog import.
The project owner approved the 60 identities and meanings in pilot v0.2.0.
That approval does not verify translation accuracy, CEFR estimates or localized
instruction copy.

## Data and authority

`20261013000000_vocabulary_photo_guidance.sql` adds one optional row per concept
UUID and instruction locale (`en` or `fr`) in `vocabulary_photo_guidance`:

- Primary idea and its `literal` / `interpretive` representation mode.
- An optional alternative idea paired with its own representation mode.
- Required accessibility and safety guidance.

Each text field has a 2,000-character limit and cannot be blank. The concept foreign
key, composite primary key, locale/mode checks and alternative-pair constraint are
server-enforced. This version supports one alternative, matching the pilot; a list
can be introduced later if editorial needs justify it. No concept/term backfill,
selection change, new challenge write or historical snapshot rewrite occurs.

RLS permits authenticated reads of active, photographable catalog concepts only.
Anonymous access and client writes are denied; trusted `service_role` has explicit
SELECT/INSERT/UPDATE/DELETE, independent of Supabase defaults. Guidance is shared
editorial catalog content, not personal data. Private helper execution is denied to
clients and service_role. The existing owner-checked challenge payload adds an
optional `photo_guidance` field to each word. Its owner check, assignment ordering,
submission projection and existing RPC permissions remain intact.

Instructions follow the **interface language**, not the language being learned.
The current UI is English, so the challenge payload requests English. The private
helper supports French and falls back to a whole English row if French is missing;
it never mixes translated examples with untranslated safety or substitutes French
for an English request. English copy for all 60 concepts is staged in
`data/vocabulary/photo-guidance.v0.2.0.json`; French instruction translations are
not yet authored. French vocabulary terms are a separate concern.

Guidance is current editorial metadata, not an immutable assignment snapshot.
Existing challenge cache/session rules apply; there is no new polling or request.
Corrections appear on the next normal challenge fetch. Daily selection, exact CEFR
slots, immutable word/translation snapshots, permanent completed-concept exclusion,
XP, streaks and Storage authority are unchanged.

## Mobile presentation

Today offers a compact, initially collapsed **Photo idea** disclosure when a valid
complete guidance record is available. Opening it shows the primary idea, optional
alternative, accessibility tips and safety together. The control exposes its
expanded state to accessibility tools and has a 44-point minimum touch height.
Replacement resets the disclosure. Older deployments and concepts without guidance
retain the existing card; malformed optional help is omitted rather than showing
an example without its safety instructions. There are no new navigation routes.

## Editorial gates and local import

`meaning-approval.v0.2.0.json` records the owner's approval date and SHA-256 of each
concept key/definition pair. Changed meanings or keys invalidate that approval.
Translation/CEFR edits cannot claim new approval from it. The pilot's bilingual
review/evidence fields remain draft/unset, and the release validator still reports
coverage and editorial blockers. Guidance copy has a separate review record per
locale; structural validity alone never approves its language or safety quality.

Run the structural/editorial report and offline tests:

```sh
node scripts/validate-vocabulary.mjs
node --test scripts/tests/vocabulary-manifest.test.mjs scripts/tests/vocabulary-guidance.test.mjs
```

The new **guidance-only** importer resolves exact keys to existing local concept
UUIDs. It never creates, renames or deletes concepts or vocabulary terms. It rejects
missing/duplicate identities, stale meaning approval, invalid localized copy and
unapproved copy. It locks the catalog and rechecks the UUID/key mapping within the
transaction; repeated identical upserts perform no update. It accepts no project
ref, hosted URL, service key or remote connection option.

```sh
# Read-only plan against local Docker; exits nonzero for editorial/identity blockers.
node scripts/import-vocabulary-guidance.mjs

# Only after existing catalog identities and copy review are complete:
node scripts/import-vocabulary-guidance.mjs --apply-local

# Rollback-only isolated fixtures, including import and migration replay:
node scripts/test-vocabulary-guidance.mjs
```

`--allow-draft-local` is an explicit local-fixture escape hatch for copy review,
not translation/CEFR approval or permission to import hosted data. The importer has
no hosted mode. The existing 36 seed concepts remain development fixtures and are
not renamed, reused as different meanings, or automatically approved. No full
pilot catalog importer is introduced: its terms/levels still need separate review.

## Before any Dev deployment

1. Review this diff and local results, including the independent translation/CEFR
   and guidance-copy gates. Approve a **separate** Dev deployment explicitly.
2. Reverify Dev ref `ssuyyrfncvyqsgkirvpq`, actual migration history and pending diff.
   Apply only this reviewed migration after its prerequisites; do not use an
   unfiltered migration push that includes unrelated pending files. No Edge
   Function, Auth, Cron or Storage setting changes are required.
3. Verify the new table constraints, RLS, effective anon/authenticated/service_role
   grants, private helper restrictions, existing RPC grants and challenge owner
   filtering. Verify old concepts still return a valid three-word challenge.
4. Before importing vocabulary, obtain separate bilingual translation/CEFR and
   localized-copy review. Resolve exact existing Dev UUIDs by semantic identity.
   Approve a distinct catalog/import plan; this guidance-only local script must not
   be pointed at hosted projects. The pilot is not sufficient launch inventory for
   all six exact CEFR levels, and completed concepts must never be recycled.
5. Use disposable Dev accounts and a separately approved small guidance fixture to
   verify complete retrieval, replacement/cold reload, wrong-user denial, old
   concepts, and existing completion exclusion. Exercise iPhone/Android large text,
   VoiceOver/TalkBack, scrolling and capture-button reachability. French fallback
   is DB-tested but a French interface is not implemented.
6. Review counts and exact ID-preservation results before any separately authorized
   catalog import or Production rollout. Ship the optional client and migration in
   either order; guidance appears only after reviewed rows exist.

## Local migration record limitation

The targeted SQL was applied to local Docker and its constraints/retrieval tested.
Its migration-history row was **not** recorded. Automatic approval review rejected
both the unfiltered `supabase migration up --local` (could apply unrelated pending
migrations) and manually recording history after a direct SQL application (outside
the standard runner). Neither rejected action was retried or bypassed. Local schema
verification and rollback-only replay are separate evidence from CLI migration
history; reconcile through an approved, scoped migration workflow before relying on
that local history for deployment planning.

## Files in this change

- Database: the new migration and `supabase/tests/vocabulary-guidance.test.sql`;
  additive guidance table types in `src/types/database.ts`.
- Mobile: `src/services/photo-guidance.ts`, the optional field/parser in
  `src/services/challenges.ts`, `src/features/challenges/photo-guidance.tsx` and its
  use in `today-screen.tsx`.
- Editorial: the meaning-approval and localized-guidance JSON sidecars, a scoped
  approval clarification in `pilot.v0.2.0.json`, `data/vocabulary/README.md`,
  `scripts/validate-vocabulary.mjs` and regenerated `VOCABULARY_PILOT_REVIEW.md`.
- Tooling: `scripts/lib/vocabulary-guidance.mjs`,
  `scripts/import-vocabulary-guidance.mjs`,
  `scripts/test-vocabulary-guidance.mjs`, and
  `scripts/tests/vocabulary-guidance.test.mjs`.
- Application tests: `tests/photo-guidance.test.ts`,
  `tests/photo-guidance-ui.test.tsx`, `tests/vocabulary-guidance.test.ts`, and an
  additional Today replacement/presentation test.
- Documentation: this runbook and small README / PRODUCT / ARCHITECTURE /
  DATA_MODEL additions. Existing account-deletion and other user changes are
  preserved; they are not claimed as part of this implementation.

## Verification

- `npm run check`: TypeScript, ESLint and formatting pass; **1,040 tests / 90
  suites** pass. The offline vocabulary suites include **22 tests**, with six new
  guidance/approval/import tests.
- All 18 existing local integration commands pass sequentially: integration,
  challenges, submissions, bootstrap, photo-audit, progress, vocabulary, discover,
  ratings, safety, notifications, notification-sender, social, avatars, inbox,
  explore, past-words and cleanup. No hosted project or real account is involved.
- `npm run export:check`: iOS, Android and web exports pass.
  `npm run security:scan`: **581 files and two decoded Hermes bundles** pass.
  Exports are not signed native builds or physical-device tests.
- Online `npm run doctor`: **20/21**; online `npx expo install --check` fails only
  because of these newly recommended patches. Dependencies were not changed in
  this vocabulary task. The earlier offline SDK-map check passed but is superseded
  by this online result.

| Package            | Installed | Recommended |
| ------------------ | --------- | ----------- |
| expo               | 57.0.27   | ~57.0.28    |
| expo-auth-session  | 57.0.14   | ~57.0.15    |
| expo-crypto        | 57.0.3    | ~57.0.4     |
| expo-dev-client    | 57.0.19   | ~57.0.20    |
| expo-router        | 57.0.25   | ~57.0.26    |
| expo-splash-screen | 57.0.9    | ~57.0.10    |
| jest-expo          | 57.0.5    | ~57.0.6     |

The structural/editorial validator passes with 60 meaning approvals and zero
structure errors. Its release mode intentionally exits 1: independent bilingual
and accessibility reviews, draft status and five empty language/CEFR bands remain
**126 blockers**. Guidance copy review is a separate import gate. No catalog or
English/French guidance has been imported into a hosted project.

- Final SQL/RLS suite via the documented Docker-shared mirror:
  `npx supabase test db /private/tmp/langtify-db-tests/` passes **1,784 assertions /
  31 files**, including **41 guidance assertions**. The mirror contains the exact
  repository SQL files; it avoids Docker's unshared workspace path.
- `node scripts/test-vocabulary-guidance.mjs` passes: rollback-only fixture import,
  no-op replay, preserved concept identities/content, unchanged other function
  bodies and rejection of catalog identity drift. `npm run db:test:bootstrap`
  passes again with the final constraints in a fresh disposable database.
- `npx supabase db lint --local --level warning` reports no warnings/errors.
  `git diff --check` and deterministic review checks pass.
- The guidance importer's actual local dry-run exits 1 with **zero writable rows
  and 60 missing-identity blockers**. This is expected: the 60-concept pilot is not
  imported. No draft catalog was created just to satisfy a test.

Hosted verification and physical-device acceptance remain pending.
