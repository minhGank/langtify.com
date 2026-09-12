# Phase 2 data model

Supabase/PostgreSQL is authoritative. No vocabulary/challenge/photo tables or
Storage buckets belong to this phase. Email stays in Supabase Auth.

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

## Future concepts, not schemas

Vocabulary will use A1–C2 and photographable words. Daily review/target/stretch
slots will follow PRODUCT.md's boundaries; replacements preserve slot level.
Submission visibility defaults private; future photos use Supabase Storage.
Streak maintenance requires at least one completed daily word; semantic ratings
are 1–5. No columns, indexes, policies, or tables for these concepts are created.
