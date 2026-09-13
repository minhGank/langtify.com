# Phase 7 data model

Supabase/PostgreSQL is authoritative. Vocabulary and challenges join the existing identity schema.
Phase 4 adds submissions and private photo storage. Email stays in Auth.

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

## Submissions and private photo storage

`20260912040000_phase4_submissions.sql` is additive and explicitly transactional.
All previously applied migration files are unchanged by Phase 4. It configures a
private `challenge-submissions` bucket accepting `image/jpeg`, limited to 5 MiB.

`submissions` contains a UUID, owner, challenge/assignment IDs, concept/target/reference
term references and text snapshots, unique storage path, visibility (database default
`private`), lifecycle status, created/updated/expiry/submitted/deleted timestamps.
Composite foreign keys preserve assignment identity and challenge ownership. A
trigger derives identity/text/path from the assignment, protects immutable columns
and validates transitions. A partial unique index permits one non-deleted row per
assignment. Submission insertion/finalization requires an active assignment. An
assignment with any non-deleted submission cannot be replaced, including through
direct privileged assignment updates checked by the trigger.

| State       | Object                                             | Assignment behavior                                   |
| ----------- | -------------------------------------------------- | ----------------------------------------------------- |
| `pending`   | May not yet exist                                  | Not completed; finish or discard before replacement.  |
| `completed` | Decoded and attested for its exact Storage version | Completed; no duplicate submission or replacement.    |
| `deleting`  | Removal pending or in progress                     | Reserved until Storage removal and retirement finish. |
| `deleted`   | Absent at retirement                               | Incomplete; new photo/replacement allowed.            |

Owners can select their rows through RLS but cannot directly insert/update/delete.
Public RPCs are `get_assignment_photo`, `reserve_submission`, `finalize_submission`,
`set_submission_visibility`, `begin_submission_deletion`, and
`finish_submission_deletion`. They derive ownership from `auth.uid()` and lock in
profile/assignment/submission order. Visibility is validated, and finalization is
idempotent. The audit additionally requires trusted byte verification before completion. Completion is represented by persisted submission state, not a client
flag. Today payloads include only minimal submission ID/status information.

Storage policies permit inserting only the exact unexpired owner reservation path,
selecting only the owner's live rows, and deleting only after deletion intent.
Custom object metadata is rejected; there is no UPDATE/upsert/move policy. `public` visibility grants no additional direct table/Storage access; Phase 7 controlled reads are described below. The boolean upload-policy helper locks its reservation while Storage
inserts. Private definer helpers have empty search paths and revoked client access.

`private.photo_cleanup_queue` retains object paths across submission/account/challenge
cascades. Only service-role callers execute `claim_photo_cleanup` and
`finish_photo_cleanup`. The worker expires 24-hour pending leases, retries deleting
rows, removes objects through Storage API, and retires rows only after metadata is
absent. A sweep finds orphan or late objects lacking a live submission. Queue attempt times
rotate failing jobs fairly; already-queued rows do not starve discovery of new work. Soft-deleted
rows preserve idempotency/history; no retention duration beyond this lifecycle was
invented. Operational cleanup scheduling is required; see README.

## Phase 4 audit enforcement

`20260912050000_phase4_audit_storage.sql` adds `private.photo_verifications`: one
receipt per submission, with immutable object ID/version, SHA-256, bounded dimensions,
and server verification time. Only the trusted Supabase function can invoke the
service-only target/attestation RPCs. The ordinary owner finalization RPC still checks
identity, active assignment, expiry and Storage presence; its transition now also
requires the matching receipt. Receipt creation and finalization can be retried
independently after uncertain responses. No fake verification backfill is performed.
The migration fails transactionally if unverified preexisting completed photos exist.

A narrowly scoped `storage.objects` trigger protects only `challenge-submissions`:
commit-time inserts require the same pending unexpired owner reservation, content
identity cannot be updated, and physical deletion requires a deleting/deleted/missing
submission. The deletion check also protects a valid image from a stale cleanup job.
Standard upload/read/delete operations retain owner RLS; reusable upload signing,
copy and client-selected signing lifetimes are denied. The Auth-verified function
alone issues preview URLs with a fixed 60-second TTL. The bucket remains private.

## Future concepts

Community interactions remain unimplemented. Phase 5 progress is described below.

## Phase 5 progress and XP

- `private.word_completions`: one fact per submitted photo, with owner, assignment,
  challenge, server completion timestamp, persisted IANA timezone snapshot, derived
  local date and nullable revocation time. A partial unique index permits at most
  one unrevoked completion per assignment; foreign keys preserve identity links.
  Source provenance distinguishes new server snapshots from legacy backfill.
- `private.progress_accounts`: per-owner revision mutex; actual row updates force
  stronger-isolation stale writers to abort. It does not store a trusted XP total.
- `private.qualified_days_seen`: durable owner/date identities, retained after photo
  deletion so replay cannot create additional milestone candidates.
- `private.streak_milestones`: owner, threshold, exact qualifying start/end dates,
  source submission and creation time. Unique owner/threshold/end-date and checked
  window width. All six thresholds and rewards are fixed in backend code.
- `private.xp_awards`: unique owner/source key, immutable kind/reward, current balance
  (zero or full reward), monotonically increasing revision and most recent cause.
  This is the reconciliation projection, not a client-editable XP integer.
- `public.xp_events`: immutable signed credits/reversals, owner, event kind, durable
  source key/revision, cause submission UUID and timestamp. Unique owner/source/
  revision; checked amounts and event kinds. Source keys are `word:<assignment>`,
  `challenge:<challenge>` and `milestone:<threshold>:<window-end>`. Ordinary accounts
  may SELECT their own events, never INSERT/UPDATE/DELETE. No anonymous access.

Every source adjustment writes an event and projection in one transaction. Total
XP is `sum(xp_events.amount)`; never sum only positive entries as lifetime XP.
Retired photo IDs remain explainable in history. Cause IDs intentionally are not
cascade foreign keys: parent challenge maintenance must not erase XP reasons.
Account erasure cascades personal XP history; an immutable-ledger trigger permits
that only once its owning profile has been removed. Challenge/assignment cascades
reconcile lost facts while the profile remains. Backend-only tables/helpers have
no anon/authenticated privileges.

`get_my_progress(challenge_id default null)` validates optional challenge ownership
and returns the caller's daily count, signed XP total, derived level/thresholds,
current/longest streak and valid word/full-challenge totals. It never creates a
challenge. `get_submission_xp(submission_id)` exposes the currently credited word,
challenge and milestone amounts last caused by that owned photo; it is feedback,
not an award endpoint. The ledger remains the full historical explanation.

Migration `20260913000000_phase5_progress.sql` locks submission writes, creates the
schema and chronologically replays existing verified completion/deletion events in
one transaction. Phase 4 did not record a finalization-time timezone: legacy facts
use the challenge's saved timezone and `legacy_challenge_snapshot` provenance.
This is an explicit approximation if the user changed timezone before finalizing.
New photos snapshot the learning timezone at finalization. The migration does not
rewrite photos or infer timestamps from clients. Supabase migration tracking makes
normal reruns a no-op; raw SQL is intentionally not blindly replayable over history.

## Phase 5 audit integrity

`20260913010000_phase5_audit_integrity.sql` preserves the original Phase 5 migration
and all existing events. Milestone source formatting explicitly uses a timestamp
without timezone and `YYYY-MM-DD`, avoiding session DateStyle/TimeZone aliases.
Level calculation verifies its numeric square-root estimate against exact integer
thresholds, including the upper bigint range.

Before replacing the functions, the migration checks canonical milestone sources
and agreement between source balances/revisions and signed event history. Ambiguous
legacy aliases or inconsistent projections abort the migration atomically for
reviewed reconciliation; the migration never guesses dates, rewrites events or
silently erases credit. Valid existing history and replay are tested unchanged.
See PHASE5_AUDIT.md for reproductions, coverage and deployment limits.

## Phase 5.5 identity behavior (no schema changes)

All ownership remains anchored to the Supabase `auth.users.id`, regardless of
password or Google identity. Supabase may automatically link a compatible OAuth
identity to the same user for a safely verified email. The app consumes the
resulting authenticated UUID and never queries/matches application accounts by
provider email. No manual linking, merge function, Google-specific profile or
second user table is introduced. Existing profile creation runs on `auth.users`
insertion; repeated login to the same UUID only reloads existing data. Provider
metadata does not populate required onboarding fields or grant completion.

XP, challenges, submissions, private Storage and RLS remain unchanged. PKCE pending
records are local technical state and confer no database authorization; server-
validated Supabase JWTs still authorize every account-bound request.

## Phase 6 vocabulary history projection

Migration `20260914000000_phase6_vocabulary_history.sql` adds only a partial index
on completed `submissions(user_id, concept_id, submitted_at DESC, id DESC)` and
`get_my_vocabulary(requested_concept, search_text, requested_level, before_time,
before_id, page_size)`. It is transactional and can replay without changing rows.
There are no new completion/history tables or lifecycle triggers. Generated public
TypeScript types include the RPC.

The RPC defaults to 12 items, validates 1–24, limits search to 100 characters,
validates CEFR and a paired finite timestamp/UUID cursor. It derives the owner from
`auth.uid()`, executes as invoker with an empty search path, and is granted only to
authenticated users. Source RLS still applies to submissions and assignments.
Text/meaning comes from submission snapshots; CEFR and language IDs come from
assignment snapshots, never mutable catalog text. Count and latest selection group
by concept UUID, including across language pairs. Detail also returns its latest
summary independently of the current capture page. Empty or foreign concept IDs
produce no personal history.

Search/filter apply to the latest capture in the grouped library. Literal `%` and
`_` cannot broaden substring search. Total concepts is unfiltered (for detail it
is 0 or 1). A bounded cursor page returns rows plus `has_more`; response size is
bounded, but computing exact counts/latest still scans the owner's eligible history.
Monitor query plans/latency at production scale before adding any projection.

Dictionary reads exclude `deleting` as well as `pending`/`deleted`; no photo is
shown while physical removal is underway. Existing completion and XP transitions
remain unchanged. A disappearing newest capture exposes the previous valid one;
no surviving capture means no learned-concept row. Private/public both stay owner-only in this dictionary RPC.

## Phase 7 public projection

Migration `20260915000000_phase7_discover.sql` adds no product tables or write
triggers. `private.discover_candidates` joins immutable submission/assignment
snapshots to a currently onboarded username, a nondeleted/unbanned Auth owner and
an existing Storage object matching its private verification receipt's ID/version,
bucket and path. Only completed, public, unreplaced captures qualify. No catalog
join rewrites historical words or CEFR. No grouping collapses repeated captures.

- Partial `submissions_discover_newest` index: `(submitted_at DESC, id DESC)` for
  completed/public rows, including assignment and owner join keys.
- `challenge_words_discover_language`: `(target_language_id, id)` for language joins.
- Private `discover_target(viewer)` verifies saved onboarded learning state and
  active Auth account; neither helper nor eligibility view is client-accessible.
- Authenticated `get_discover_feed(before_time, before_id, page_size)` derives the
  caller and target internally. Page size is 1–24 (default 12); cursor fields must
  be paired and time finite. `(submitted_at,id) < cursor` prevents tied duplicates.
- Envelope: caller's own `viewer_id`, saved `target_language_id`, `items`, `has_more`.
  Each item contains exactly `id`, `target_term`, `reference_term`, `cefr_level`,
  `username`, `submitted_at`. No submitter UUID, challenge ID, raw path, email,
  timezone, learning profile or XP history is returned.
- Service-only `get_discover_photo_targets(viewer, expected_target, submission_ids)`
  checks the verified viewer against saved target, accepts 1–24 distinct UUIDs and
  uses the same eligibility view. Only this privileged internal result includes
  paths. Edge Function projects public fields and 60-second signed capabilities.

Both RPCs are stable security definers with empty search paths and explicit grants.
Existing submission/profile/Storage/XP RLS and mutation permissions are unchanged.
Anonymous feed access is denied. Visibility and deletion changes are reflected at
read snapshots; no lock is held across external Storage signing. Existing signed
capabilities retain their original expiry. Migration replay does not backfill or
change photo, challenge, XP or streak history.

### Phase 7 audit pagination plan

`20260915010000_phase7_audit_pagination.sql` only replaces the feed RPC body with
an indexable `(submitted_at,id)` upper bound, using an internal infinity/max-UUID
sentinel for the initial page. External cursor validation and the exact public
projection are unchanged. The old migration remains intact. Replay tests preserve
feed results, submissions and the complete XP ledger over nonempty data.
