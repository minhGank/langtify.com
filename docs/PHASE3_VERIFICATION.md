# Phase 3 verification and handoff

This is the original implementation record. See [Phase 3 audit](PHASE3_AUDIT.md)
for subsequent integrity/lifecycle fixes and current verification results.

Implemented and verified locally on 2026-09-12. Phase 2 was the starting point.
No Phase 4 functionality, camera, submissions/completion, buckets, streaks, feed,
ratings, comments, followers or notifications were added. Dependencies and the
lockfile are unchanged. The local environment file was not edited by this task.
No hosted project was linked or migrated.

## Schema and vocabulary model

The additive migration `20260912020000_phase3_challenges.sql` creates:

- `vocabulary_concepts`: one semantic meaning per unique concept key, category,
  active and photographable flags, timestamps.
- `vocabulary_terms`: one primary term per `(concept_id, language_id)`, independent
  CEFR A1–C2, part of speech, active flag and timestamps.
- `daily_challenges`: owner, learning profile, unique profile/local date, saved
  target/reference languages, configured CEFR, timezone and creation time.
- `daily_challenge_words`: slot, exact CEFR, target/reference term references,
  concept, displayed text snapshots and assignment/replacement timestamps.

English/French equivalents follow the shared concept. Identical spellings such as
English “bank” may belong to separate `BANK_FINANCIAL` and `BANK_RIVER` meanings.
No per-language vocabulary tables or duplicate translation table exists.

The seed adds **36 photographable development concepts and 72 linked terms**.
French has six examples at each A1–C2 level. English covers all six levels and
intentionally differs for `ALLEY` (English A2, French B2), demonstrating independent
levels. Advanced examples include architectural/material/nature details that can
be photographed. These CEFR choices are provisional development examples, not a
reviewed production curriculum. Replaying the seed inserts missing rows and
preserves existing catalog edits/deactivations.

## Generation and replacement

`get_or_create_today_challenge()` takes no arguments. It validates the authenticated
owner and completed onboarding, locks their profile and learning record, then
computes the local date from one server timestamp and the persisted IANA timezone.
An existing profile/date challenge is returned unchanged. Otherwise, three slots
are created in one transaction: review one level below, target at the configured
level, stretch one above, clamped to A1/A1/A2 and C1/C2/C2 at the boundaries.

Each selection requires the exact target language/CEFR, an active target term,
an active photographable concept, and an active term for the reference language.
It excludes every concept already in that challenge, including retired assignments.
Remaining candidates are ordered by never assigned, then oldest most-recent
assignment across that user's concept history, with random ties. Catalog rows are
held with shared locks through commit. Insufficient vocabulary raises the controlled
`insufficient_vocabulary` error and rolls back every partial write.

`replace_daily_challenge_word(active_assignment_id)` accepts only the assignment ID.
It verifies ownership, serializes writes, rejects retired/unknown/other-user IDs
with the same controlled unavailable response, retires the old row and inserts
an eligible replacement. The slot and saved configuration remain unchanged. If
selection fails, the old assignment remains active. Retrying an old ID does not
silently replace the next word; reload after an uncertain response. Repeated
replacement is supported until the eligible concepts are exhausted, without an
invented count or age limit. Today only exposes the current returned challenge.

Configuration and term text are snapshots. Same-profile/date requests reuse the
original challenge even after settings change. A timezone change can select a
different calendar date, but never edits a previous date/timezone. Catalog edits
cannot change already-displayed historical text. No mastery or spaced repetition
logic was introduced.

## Security and invariants

All four tables have RLS. Authenticated users read the shared catalog and only
their own challenges and assignment history. Ordinary users have **no direct
insert/update/delete grants** on Phase 3 tables; no blanket user-data policies
were introduced. The existing language catalog stays read-only to clients.

Only authenticated users can execute the two public RPCs. Private helpers have
no public/anon/authenticated execution permissions. Elevated functions use an
empty search path, qualified relation/function references and `auth.uid()`;
payload reads independently verify the immutable challenge owner, including after
privileged learning-row reassignment. Neither API accepts owner IDs, dates, language IDs, levels, timezones or selected
replacement terms. Client requests retain the submitting session's JWT.

A unique profile/date constraint makes generation idempotent. Partial uniqueness
allows at most one active row per slot; deferred checks require exactly three
active rows at commit. Uniqueness on challenge/concept includes replacement
history. Trigger validation enforces selection eligibility, immutable challenge
configuration, and retirement-only assignment updates. Foreign keys preserve
catalog linkage; account deletion cascades through owned history.

Today state is keyed by owner, learning profile and relevant settings. Obsolete
responses are ignored after account/profile changes or unmount. Focus/resume and
one-minute active polling ask the server for the date; device time is not an
assignment input. Background polling skips pending writes. Failed reads show a
retry state; failed replacement retains the card with a safe message.

## Commands and results

| Command/check                                               | Result                                                                                                                                                               |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx supabase migration up --local`                         | Phase 3 migration applied; subsequent invocation had no pending migrations.                                                                                          |
| Local `psql` execution of `supabase/seed.sql`               | 36 concepts / 72 terms inserted without resetting data.                                                                                                              |
| `npm run db:seed`                                           | Transactional local seed replay succeeded without duplicates.                                                                                                        |
| `npx supabase gen types typescript --local --schema public` | Types regenerated; fresh temporary output matched the checked-in file after repository formatting.                                                                   |
| `npm run check`                                             | Typecheck, zero-warning lint, formatting and **99 application tests in 12 suites** passed.                                                                           |
| `npx supabase test db /private/tmp/langtify-phase3-tests/`  | **142 tests in four SQL suites** passed, including all Phase 2 tests.                                                                                                |
| `npm run db:test:integration`                               | All five existing identity/seed/migration safety scenarios passed.                                                                                                   |
| `npm run db:test:challenges`                                | Simultaneous creation, same-ID concurrent replacement, and different-slot concurrent replacement passed using ordinary authenticated roles.                          |
| `npx supabase db lint --local --level warning`              | No schema errors.                                                                                                                                                    |
| `node /private/tmp/langtify-phase3-smoke.cjs`               | Real local Auth/REST sign-in, onboarding, challenge generation/retry, replacement, own-history read, persisted SDK restoration and sign-out passed. Fixture deleted. |
| `npx expo install --check`                                  | Dependencies compatible/up to date.                                                                                                                                  |
| `npm run doctor`                                            | 21/21 checks passed.                                                                                                                                                 |
| `npx expo config --type public --json`                      | Current public configuration resolves with Langtify metadata.                                                                                                        |
| `CI=1 npm run export:check -- --clear`                      | Fresh iOS, Android and web production exports passed.                                                                                                                |
| Secret/whitespace review                                    | No privileged credentials introduced; local env remains ignored; `git diff --check` passed.                                                                          |

Database suites cover concept linkage/ambiguous meanings, language resolution,
all six CEFR configurations, timezone/DST boundaries, settings/text snapshots,
exact eligibility filters, missing/inactive reference terms, semantic uniqueness,
idempotency, unseen preference, oldest-history fallback, repeated/exhausted
replacement, partial-failure rollback, ownership and mutation denial. Client tests
cover payload ownership/completeness, token binding, retry/error states, duplicate
submission guards, stale results, account/configuration changes and Today cards.

Docker Desktop does not share `/Applications/langtify.com`. SQL tests were copied
unchanged into the shared temporary directory and run with the same Supabase test
runner; README documents this fallback. SQL fixtures roll back; concurrency/HTTP
fixtures use isolated random accounts and are deleted. No hosted data is touched.
The HTTP smoke test uses Node SDK storage and does not replace phone testing.

## Target setup and exact phone tests

Apply all pending migrations to the intended **development** project, then its
reviewed development seed. For this local stack, use `npm run db:migrate` and
`npm run db:seed`. Keep the public URL/key configured as described in README;
a phone needs a reachable LAN or hosted development API URL. Start with `npm start`.
No migration has been applied to a hosted environment by this task.

Run these on **both iOS and Android**:

1. Sign in with an onboarded French-target/English-reference B1 account. Open Today.
   Confirm date/timezone and Review A2, Target B1, Stretch B2 cards, each with a
   French term, English equivalent and Replace action. No camera action appears.
2. Use separate freshly onboarded A1 and C2 accounts. Confirm A1/A1/A2 and C1/C2/C2,
   respectively, with three different concepts. Do not reuse a same-day challenge
   after changing settings and expect its saved levels to change.
3. Refresh, switch tabs, force-close/reopen, and sign in on a second device on the
   same local day. Confirm the same saved challenge and current active assignments.
4. Replace each slot. Confirm a new concept, identical slot level, linked reference
   text and loading/disabled controls. Refresh/relaunch to confirm persistence.
   Continue replacing until the small development pool is exhausted: a controlled
   message must appear and the current word must remain active.
5. On two devices showing the same active assignment, replace it simultaneously.
   One request succeeds; the stale request reports unavailable. Refresh both and
   confirm the same three active cards without repeated concepts.
6. Disable networking while loading and while replacing. Check retry/error text.
   Reconnect and refresh before retrying an uncertain replacement. Confirm there
   are still three saved active assignments and no client-invented completion.
7. Sign out, then switch to an account with different setup while a request is
   delayed. Old cards must disappear and late responses must not populate the
   new account. Verify signed-out direct routes remain blocked.
8. Through controlled development administration, change that user's CEFR/language
   pair/timezone. Reopen Today: a same-profile/date challenge retains its saved
   configuration; any new local-date challenge uses the new settings. Changing
   only the phone clock/timezone must not override the persisted server setting.
9. Keep Today focused across local midnight or background it before midnight and
   resume afterward. Confirm the server returns the new date within the active
   refresh interval or on resume, with one challenge for that date. Repeat around
   daylight-saving transitions when feasible; automated tests cover fixed DST cases.
10. Check large text, VoiceOver/TalkBack labels, light/dark themes, scrolling,
    safe areas and replacement controls on a small screen.

## Remaining risks and boundaries

No known blocking implementation defect remains in the tested scope. Physical
phone acceptance, native binaries/signing and hosted rollout remain unperformed.
The modest seed exhausts by design and needs language-expert CEFR/translation/
photographability and licensing review before production content use. Candidate
ranking is appropriate for the development catalog; profile locks serialize a
user's operations and should be load-tested before a large catalog/traffic rollout.
An open foreground screen can show the prior date for up to the one-minute poll
interval; offline clients show an error when refresh fails. No offline assignment
engine, immediate JWT revocation or settings UI was added. Existing Phase 2 storage
and previously recorded dependency-advisory limitations remain documented there.

## Changed files

Compared against the working tree at Phase 3 start; generated exports and ignored
local runtime/environment files are excluded. Earlier migrations and dependency
versions are unchanged.

- `AGENTS.md`
- `README.md`
- `app/(tabs)/index.tsx`
- `docs/PRODUCT.md`
- `docs/ARCHITECTURE.md`
- `docs/DATA_MODEL.md`
- `docs/ROADMAP.md`
- `docs/DECISIONS.md`
- `docs/PHASE3_VERIFICATION.md`
- `package.json` (local test/seed commands only)
- `scripts/lib/local-db.mjs`
- `scripts/test-db-integration.mjs`
- `scripts/test-challenges-integration.mjs`
- `src/features/challenges/errors.ts`
- `src/features/challenges/today-screen.tsx`
- `src/features/challenges/use-today-challenge.ts`
- `src/services/challenges.ts`
- `src/types/database.ts`
- `supabase/migrations/20260912020000_phase3_challenges.sql`
- `supabase/seed.sql`
- `supabase/tests/phase3.test.sql`
- `supabase/tests/phase3-selection.test.sql`
- `tests/challenge-fixtures.ts`
- `tests/challenge-service.test.ts`
- `tests/challenge-state.test.tsx`
- `tests/today-screen.test.tsx`
