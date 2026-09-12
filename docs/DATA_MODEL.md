# Phase 3 data model

Supabase/PostgreSQL is authoritative. Vocabulary and challenges join the existing identity schema.
Photo/submission tables and Storage buckets remain out of scope. Email stays in Auth.

## Tables

- `profiles`: auth user UUID primary/foreign key; nullable username before
  onboarding; created/updated timestamps; nullable server-owned completion time.
  Usernames are trimmed and lowercase, 3–30 ASCII letters/digits/underscores,
  starting with a letter or digit. A unique index on lowercase username enforces
  case-insensitive uniqueness. This is an explicit validation choice for Phase 2.
- `languages`: UUID key, stable unique language code, name, native name, active
  flag and creation time. Seed English (`en`) and French (`fr`).
- `user_language_profiles`: UUID key, unique user ID (one profile in V1), reference
  and target language FKs, CEFR A1–C2, IANA timezone, created/updated timestamps.
  Languages must differ and must be active when chosen. PostgreSQL validates
  timezone names against its timezone catalog; the stored value is authoritative.

## Ownership and atomic completion

All three tables use RLS. Authenticated users read/update their own profile and
read/insert/update their own learning record. Language reads require authentication.
No anonymous, cross-user, client catalog-write or client delete policy is granted.
Column grants protect IDs, timestamps and completion metadata from client writes.

A signup trigger creates the profile. A narrowly scoped `complete_onboarding` RPC
uses `auth.uid()` (never a caller-supplied user ID), validates inputs, locks the
user's profile, upserts the learning record, and marks completion in one transaction.
It also recovers a missing profile for accounts predating the trigger. A failure
rolls back every write; a retry is safe. Completion requires a username and learning
record. Errors after commit are resolved by reloading persisted state.

`20260912010000_phase2_audit_invariants.sql` adds a deferred constraint trigger on
learning-record deletion/update. It checks final transaction state under a profile
row lock, preventing a completed profile from losing its learning record. Atomic
replacement and cascading Auth-user deletion remain possible. Installation locks
both affected tables and refuses inconsistent existing data; it does not silently
clear completion timestamps or manufacture learning preferences. Apply migrations
transactionally in version order; the original schema migration remains unchanged.

The language seed inserts missing codes only. Replaying it cannot reactivate or
rename an administratively edited language. Active-language validation applies
when a learning record is written; deactivating a catalog entry does not erase
existing users' stored selections or revoke their completion.

## Shared vocabulary

- `vocabulary_concepts`: semantic key (unique), category, active/photographable flags,
  timestamps. `BANK_FINANCIAL` and `BANK_RIVER` are separate meanings.
- `vocabulary_terms`: concept/language foreign keys, term, independent CEFR A1–C2,
  part of speech, active flag and timestamps. Unique `(concept_id, language_id)`
  permits one primary term per meaning/language. Identical spelling across distinct
  concepts is allowed. Reference equivalents are resolved through the concept.

## Daily challenge snapshots and history

- `daily_challenges`: owner and learning-profile foreign keys; unique
  `(user_language_profile_id, local_challenge_date)`; saved language pair, configured
  CEFR, IANA timezone and server creation time. Configuration/date are immutable.
- `daily_challenge_words`: challenge FK, review/target/stretch slot, saved CEFR,
  target/reference term FKs, concept FK, language/text snapshots, assignment/replacement times.
  Unique `(daily_challenge_id, concept_id)` covers active and replaced history.
  A partial unique index allows at most one active assignment per slot. Deferred
  constraints require three active assignments when the transaction commits.

Assignment insertion validates catalog eligibility against the challenge snapshot
and copies text/meaning from backend records. An update can only retire an active
assignment once. Replacements retire then insert atomically, so a pool failure
leaves the old assignment active. Historical active IDs remain owned by their
original user; the RPC does not introduce an unrequested age/replacement limit.
Today displays only the challenge returned for the current server-derived date.

Ordinary users can read the shared catalog and only their own challenges/history.
They cannot directly mutate any Phase 3 table. The two authenticated RPCs are the
only client write entry points. Private helpers are not directly callable. Catalog
FKs restrict deleting referenced terms/concepts; deactivation or text edits do not
rewrite saved cards. Deleting an Auth account cascades through its challenges.

The additive `20260912020000_phase3_challenges.sql` migration preserves both Phase 2
migrations. Use the migration runner once per version, not repeated raw schema DDL.
The development seed inserts missing semantic keys and language terms without
rewriting catalog administration. It contains 36 concepts and 72 English/French
terms: six French examples per level, with an intentional cross-language CEFR
variation. Production level assignments and vocabulary licensing need separate review.

## Phase 3 audit invariants

`20260912030000_phase3_audit_integrity.sql` adds target/reference language snapshots
on assignment rows and composite foreign keys linking each term ID to its original
concept/language and each assignment to its challenge language pair. Used terms
cannot be moved to another meaning or language. Text, CEFR and activation can still
be edited without rewriting historical cards; unused term identities can be corrected.
These relational checks remain safe under concurrent/repeatable-read catalog edits.

Assignment history cannot be deleted individually while the parent challenge exists.
Parent challenge/account deletion still cascades; no retention or replacement policy
was added. Invalid or missing internal CEFR/slot inputs now fail instead of defaulting
to C2. The new migration explicitly brackets its backfill and DDL in a transaction,
locks affected tables, and refuses existing semantic/language-link inconsistencies
without guessing repairs. Previously saved text, concepts, levels and dates are preserved.

The older Phase 2 audit migration received only an explicit BEGIN/COMMIT wrapper
after its initial LOCK statement was reproduced failing under the installed CLI.
Its original SQL body and migration version remain unchanged. The original Phase 2
identity and Phase 3 schema files remain unchanged by this audit. Respect transaction
boundaries supplied by each file when applying migrations manually.

## Future concepts

Photo submissions, completion, streaks and community ratings are not schemas in
Phase 3. No Phase 4 tables or functions are created.
