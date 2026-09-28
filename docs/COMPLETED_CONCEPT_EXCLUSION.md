# Completed concepts and Daily Word selection

This physical-QA change affects new Daily Challenge generation and replacements.
No Phase 11, commit, push or hosted deployment. Existing uncommitted QA work is
preserved. Physical iPhone acceptance remains pending.

## Cause and rule

The shared selector previously excluded only concepts already assigned within the
same challenge. Earlier assignments affected unseen-first/least-recently-assigned
ordering, but successful completion did not remove a concept from the candidate pool.

Both generation and replacement now exclude every semantic concept this account has
ever genuinely completed. Completion means the existing trusted photo lifecycle
successfully committed a verified `pending → completed` transition. Daily and Past
Words captures count, independent of camera/library, language, visibility or moderation.
Reservations, rejected finalizations and abandoned uploads do not count.

This is concept identity, not spelling or term identity. An English term and a French
term for the same concept share the exclusion; distinct meanings remain separate.
Never-completed assignments retain their original unseen-first/oldest-assignment
ordering. Exact review/target/stretch CEFR, A1/C2 boundaries, reference-term admission,
catalog locking, current-challenge uniqueness and replacement history are unchanged.

## Deletion, recovery and concurrency

Once a valid completion commits, deleting its photo or reversing its XP never makes
the concept new again. Trusted hard photo/challenge deletion also retains this private
fact. Deleting the account removes its completion history. No public history endpoint
or client mutation is added.

Existing immutable assignments are not regenerated. The owner may still finish an
old assignment or restore its deleted photo through the existing daily/historical
rules. That restores only the existing reversible XP entitlement and cannot multiply
the concept record. XP, levels, streaks, bonuses and deletion reconciliation are unchanged.

Selection and finalization serialize on the existing owner profile lock. Selection
also advances the existing progress revision, so an old repeatable-read snapshot must
abort instead of missing a concurrently committed completion. A challenge selected
before a later completion keeps its existing assignments. Normal creation retries
still return one challenge; failed creation/replacement leaves no partial writes.

## Schema and rollout

Migration: **`20260928010000_completed_concept_exclusion.sql`**.

- Adds `private.completed_concepts`: owner/concept primary key, first submission UUID
  and first completion timestamp. No photo FK intentionally: the source ID survives
  physical history deletion. Concept identity remains protected by its catalog FK.
- Enables RLS with no client grants/policies. An immutable guard rejects edits or
  deletion while the account exists. A private finalization trigger inserts once.
- Extends only `private.assign_challenge_word(uuid, text)` with the shared completion
  exclusion and serialization fence. Public RPC signatures and response shapes stay
  unchanged; no generated public type change, Edge Function or native dependency.
- Backfills retained verified submission timestamps, including soft-deleted rows,
  plus durable positive word events joined to their owned assignments. Signed XP,
  submissions, assignments and current challenge snapshots are not rewritten.
- First installation aborts atomically if an old positive word event has lost BOTH
  its submission and assignment. That requires review of trusted historical evidence;
  do not guess a concept, delete ledger history or suppress the guard. Normal photo
  deletion retains sufficient evidence. Replay preserves existing completion facts.

The primary key supports owner/concept probes without per-candidate photo/XP scans.
No redundant secondary index is added. Bootstrap exercises a generic indexed lookup
among 25,000 extra completion records. Existing assignment-history indexes still
support recency ordering for eligible concepts.

For Langtify Dev, review/apply prior pending migrations in filename order, then this
migration during a quiet window: backfill takes profile/submission table locks. Load
the updated app JavaScript for the exhaustion copy. No Edge Function deployment,
new secret or development-client rebuild is required. Nothing was deployed here.

## Exhaustion

The development seed remains 36 concepts. A required exact-level pool may run out
quickly, especially the two A1 or two C2 slots. The server returns the existing
`insufficient_vocabulary` condition and rolls back. It never reuses a completed concept
or substitutes another CEFR level.

Today says: “Not enough new words are available for this challenge yet. You can still
browse your vocabulary.” Existing reload and tab navigation remain available.
Replacement says: “No other new words are available at this level. Your word hasn’t
changed.” The saved card and replacement history remain intact. Catalog expansion
is separate work; the 100-day streak tests use rollback-only extra vocabulary rather
than weakening the new rule or changing the development seed.

## Verification

Passed locally:

- `npx supabase migration up --local`: migration applied to the persistent local stack.
- `npx supabase test db <mirror>/supabase/tests/`: **1,248 assertions / 26 files**.
  Covers both capture kinds, later-day generation, replacement, cross-language
  identity, pending/failed uploads, deletion/revocation/reupload, hard history
  deletion, account erasure/isolation, recency, exact CEFR/A1/C2, exhaustion and RLS.
- `db:test:challenges`: simultaneous creation/idempotency, same/different-slot
  replacements, catalog integrity, finalization versus generation/replacement, and
  rejection of stale repeatable-read selection. Exhaustion rolls back all writes.
- `db:test:progress`: real JPEGs through local Auth/Storage/photo-authority, durable
  concept exclusion, concurrent finalization/deletion, unchanged XP/milestones,
  restoration without farming and direct/cross-user denial.
- `db:test:bootstrap`: disposable schema/replay, nonempty preserved XP/photos,
  backfill after reversed and hard-deleted legacy photos, atomic refusal of lost
  source identity, private grants and indexed lookup over 25,000 extra facts.
- All **18** integration commands passed sequentially against their appropriate
  local/disposable database: `db:test:integration`, `db:test:challenges`,
  `db:test:submissions`, `db:test:photo-audit`, `db:test:progress`,
  `db:test:vocabulary`, `db:test:discover`, `db:test:ratings`, `db:test:safety`,
  `db:test:social`, `db:test:avatars`, `db:test:inbox`, `db:test:explore`,
  `db:test:past-words`, `db:test:notifications`, `db:test:notification-sender`,
  `db:test:bootstrap`, and `test:auth:integration`.
- `npx supabase db lint --local --level warning --fail-on warning`: no warnings/errors.
- `npm run check`: TypeScript, lint, formatting, **967 app tests / 79 suites**.
  Existing exhaustion/retry tests now assert the clearer messages and retained cards.
- `functions:check`, `functions:lint`, `functions:test`: **24 tests** pass.
- `EXPO_NO_DOTENV=1 npm run doctor`: **21/21**; `npx expo install --check`:
  SDK dependencies up to date.
- `npm run export:check -- --clear` with dotenv disabled and public local fixtures:
  iOS, Android and web exports pass.
- `npm run security:scan`: source/config/web plus both decoded native Hermes bundles
  pass; no privileged credentials or server implementation in exported apps.
- `git diff --check`: passes.

The initial concurrency fixture teardown was rejected by the existing Storage
`photo_deletion_not_requested` guard. It was fixed to call normal begin/delete/finish
before account cleanup, then rerun successfully; no security guard was bypassed.
Long-streak fixtures gained rollback-only vocabulary capacity. No existing assertion
was removed or weakened. Existing React test-fixture and Node module-type warnings
remain unrelated.

SQL and functions used the documented temporary Docker-shareable mirror with normal
JWT verification. The temporary function server/mirror is removed after testing;
the persistent local database/Auth/Storage services remain running. Hosted Dev and
physical iPhone acceptance have not been performed.

## Physical iPhone acceptance

1. Complete one word, then prepare a later server-local day. That concept must never
   return in generation or Replace. Device clock changes must not control admission.
2. Delete the photo: check the existing XP/streak reversal, then confirm selection
   still excludes its concept. Reupload its original eligible assignment and verify
   the existing entitlement is restored once.
3. Complete a Past Word and change learning language. Its equivalent term must also
   remain excluded. Existing daily snapshots stay unchanged.
4. Exhaust an exact-level pool: verify clear Today/Replace copy, usable Vocabulary,
   no wrong-level/completed fallback and no disappearing saved card.
5. Repeat across two devices and switch accounts during loading. Confirm one current
   challenge, coherent replacement state and independent account eligibility.

Automated verification does not replace physical acceptance or authorize deployment.
