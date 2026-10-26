# Vocabulary pilot release preparation — 2026-10-21

> Latest operational status: see [the October 26 rollout record](VOCABULARY_ROLLOUT_2026_10_26.md).
> For the remaining activation decisions, see the [focused blocker review](VOCABULARY_ACTIVATION_REVIEW.md).
> The preparation results below describe the earlier local-only work.

Local preparation only. No hosted migration, import, activation, commit or push.
Dev is `ssuyyrfncvyqsgkirvpq`; Production is `lfdgjewypbhukjrtwsef` only.
All 60 approved keys and definitions retain their meaning-approval hashes. This is
an edit to unreleased draft translations/instructions, not a new set of identities.

## Editorial outcome

All 120 primary terms, their grammar metadata and separate EN/FR level rationales
were reviewed against the approved meanings. No primary translation needed a
change. Canadian **colourful** and waiting **line**, Metropolitan French
**arrêt de bus**, and the Canadian alternative **arrêt d’autobus** remain.
Sense-sensitive pairs retained include pillow/oreiller (sleeping support),
leaf/feuille (plant), messy/en désordre (untidy, not dirty), relief/soulagement
(feeling), celebration/fête (occasion), and loneliness/sentiment de solitude
(unwanted lack of connection, not automatically every case of being alone).

The review is **AI-assisted editorial work**, not independent human approval.
The sidecar `editorial-review.v0.2.0.json` has one record for every concept,
content hashes covering both terms and both guidance locales, source links where
actually checked, limitations and remaining decisions. Changing copy or levels
invalidates these records. It explicitly records `independent_human_approval=false`.
Selected sources were checked from publisher pages or indexed publisher excerpts;
403/timeouts on other pages were not counted as successful verification. No claim
is made that every term has externally verified lexical or CEFR evidence.

| English estimate | Before | Revised draft                 | Evidence and limitation                                                                                                                                                                                                                                           |
| ---------------- | ------ | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| messy            | A2     | B1                            | [Cambridge, untidy sense](https://dictionary.cambridge.org/us/dictionary/english/messy). Does not establish the French phrase's level.                                                                                                                            |
| colourful        | A2     | B1                            | [Cambridge, appearance sense](https://dictionary.cambridge.org/dictionary/english/colourful). The figurative B2 sense is excluded.                                                                                                                                |
| patience         | B1     | B2                            | [Cambridge, quality sense](https://dictionary.cambridge.org/us/dictionary/english/patience). French remains an independently estimated B1.                                                                                                                        |
| loneliness       | B2     | B2, unresolved C1 review band | [Cambridge labels this noun C1](https://dictionary.cambridge.org/dictionary/english/loneliness). Decide between a justified pedagogical B2 introduction and C1; do not substitute the easier adjective _lonely_ or use this disagreement to manufacture coverage. |

Relief's B2 estimate is supported by [Cambridge's feeling sense](https://dictionary.cambridge.org/us/dictionary/english/relief).
A wider comparison with the [Oxford 3000 headword/POS reference](https://www.oxfordlearnersdictionaries.com/external/pdf/wordlists/oxford-3000-5000/The_Oxford_3000.pdf)
led to these additional English draft changes: plate, spoon, fork, grass, cloud,
empty and round A1 → A2; leaf and happiness A2 → B1; anger and freedom B1 → B2;
stretch A2 → B2; hope B1 → A2; share A2 → A1. These are editorial decisions
using headword-level evidence, with sense review still required, especially body
stretching. [Butterfly's insect sense](https://dictionary.cambridge.org/us/dictionary/english/butterfly)
was revised A2 → B1, and [rainbow](https://dictionary.cambridge.org/us/dictionary/english/rainbow)
A2 → B2. In total, 19 English estimates changed. None changed a concept meaning.
No French level was inferred from these English references.

All levels remain provisional. Exact per-sense English evidence remains missing
for pillow, backpack, scissors, rabbit, snail, ant, sadness, sunset, puddle,
playground and picnic; these retain their draft estimates and explicit review
notes. A familiar referent alone does not establish a beginner lexical level. French has no certified per-word CEFR evidence from this pass; the
French estimates need independent review. The [Council of Europe global scale](https://www.coe.int/en/web/common-european-framework-reference-languages/table-1-cefr-3.3-common-reference-levels-global-scale)
describes proficiency, not an automatic word-labeling rule. Matching a dictionary
sense or article/gender is not proof of a CEFR classification.

Sources supporting specific translation decisions include
[oreiller](https://dictionary.cambridge.org/dictionary/french-english/oreiller),
[plant leaf](https://www.collinsdictionary.com/dictionary/english-french/leaf),
[wet](https://dictionary.cambridge.org/dictionary/english-french/wet),
[messy](https://dictionary.cambridge.org/dictionary/english-french/messy),
[hope](https://www.larousse.fr/dictionnaires/anglais-francais/hope/586969),
[celebration](https://dictionary.cambridge.org/dictionary/english-french/celebration),
and [solitude](https://dictionary.cambridge.org/us/dictionary/french-english/solitude).
Definitions and photo examples remain original editorial copy, not copied dictionary entries.

## Photo instructions

The [complete 60-concept review](VOCABULARY_PILOT_REVIEW.md) now includes English
and French primary ideas, alternatives, accessibility and safety text for every
entry. All 120 locale records remain **draft**. No reviewer names/dates were
invented. The application still requests English help; French is ready as data
for a future localized UI request, not a newly implemented app-language toggle.

Changes include dry models for rain, sunset, puddles and waves; indoor alternatives
for grass and leaves; safer stationary framing for walking; no sharp broken
pencils; switched-off kitchen appliances; fictional occasion context for a
celebration; and a clearer longing-for-company cue for loneliness. Representation
modes remain aligned between languages, including interpretive model alternatives.
Consent to both capture and sharing is required; cropping is not an anonymity
guarantee. No strangers, children, distress, purchases or hazards are required.

Remaining acceptance work applies to **all 60**: an independent bilingual editor
must review the terms, levels and both instruction locales, and people with varied
mobility, vision, space and cultural backgrounds must try the photo suggestions.
Paper models still require materials/dexterity or assistance; they are options,
not universally accessible guarantees. Running versus walking, dance versus a pose,
and abstract/emotional scenes need a recognisability rubric. A scene cannot prove
an internal feeling. Do not infer distress, relationships or diagnoses from it.

## Coverage: existing catalog plus pilot

Read-only Dev inspection at 2026-10-21 15:02:20 UTC verified the project name/ref, 36 concepts,
72 linked terms and migration head `20261012000000`. Guidance and selection-v2
migrations are absent. Snapshot digest: `c3ce56c9b766f0176549ea0d66c1b812453267177fd5b5dcd4e3d64d223fcd6c`.
No pilot keys or normalized bilingual terms/aliases collide
with the Dev snapshot. Semantic reconciliation still requires an explicit review;
a lexical comparison cannot detect every synonym or overlapping meaning.

Counts below assume a fresh user completing all three concepts every day under
selection v2, no replacements/access exclusions, and hypothetical activation of
all draft pilot entries. They are finite supply estimates, not launch guarantees.
Each learner/language simulation is separate; switching languages does not reset
permanent completion. Existing Dev fixtures have not gained editorial approval.

| Inventory / target language | A1 days | A2  | B1  | B2  | C1  | C2  |
| --------------------------- | ------- | --- | --- | --- | --- | --- |
| Dev existing / English      | 3       | 6   | 6   | 5   | 5   | 5   |
| Dev + pilot / English       | 12      | 24  | 19  | 10  | 8   | 8   |
| Dev existing / French       | 3       | 6   | 6   | 6   | 6   | 6   |
| Dev + pilot / French        | 16      | 26  | 17  | 7   | 6   | 6   |
| Pilot alone / English       | 9       | 17  | 13  | 5   | 2   | 2   |
| Pilot alone / French        | 13      | 20  | 11  | 1   | 0   | 0   |

Pilot counts: EN A1/A2/B1/B2 = **19/26/8/7**; FR = **27/28/5/0**.
No C1/C2 term is assigned. English C1/C2's two hypothetical days use B2
consolidation; the seven-word B2 pool includes the unresolved loneliness estimate. It is not
approved advanced inventory. French cannot supply one legal C1/C2 day.

Production's identity was verified as **Langtify Production**, but its read-only
catalog query failed with `LegacyDbConfigIpv6Error`: IPv6 is unavailable on this
network. An isolated temporary project-link directory also failed. No repository
link or hosted setting was changed. **Production catalog and combined coverage
are unknown**, not assumed empty or equal to Dev. Restore an authorized read-only
connection (IPv4 pooler/Management API or a suitable network), take the exact
snapshot below, then re-run planning. Do not change production network settings as
a workaround without a separate request.

## Import process and recovery

`scripts/read-vocabulary-catalog.mjs` captures public catalog metadata only, in
read-only transactions, with explicit allowed project identity. It fails without
printing provider bodies/credentials. `scripts/import-vocabulary-catalog.mjs` is
an **offline importer/SQL planner**. It has no database connection, `--apply`,
activation or draft-bypass flag. Default dry-run exits nonzero if blocked and
reports proposed rows, conflicts, coverage and a SHA-256 plan digest.

```sh
node scripts/read-vocabulary-catalog.mjs \
  --project-ref ssuyyrfncvyqsgkirvpq \
  --output /private/tmp/langtify-dev-catalog.json
node scripts/import-vocabulary-catalog.mjs \
  --project-ref ssuyyrfncvyqsgkirvpq \
  --snapshot /private/tmp/langtify-dev-catalog.json
```

Repeat with `lfdgjewypbhukjrtwsef` and a separate snapshot after connectivity is
restored. Never reuse a Dev plan or identities in Production. Existing languages
must already have active EN/FR identities; the importer does not provision them.

Before any SQL can be generated:

1. Finish human bilingual/CEFR/accessibility and EN/FR copy review, then record
   reviewer/date/evidence honestly. Resolve concerns and coverage; the original
   standalone release validator remains strict. The current pilot fails release
   validation with **123 blockers** (60 accessibility, 60 bilingual, two French
   advanced coverage, one dataset draft). Adding a combined-catalog report does
   not waive these requirements. No executable import is currently available.
2. Verify backups and migration security separately. Apply only separately
   authorized prerequisites with migration history, Dev first. Known Dev pending
   prerequisites are explicit RPC grants `20261005000000`, table grants
   `20261005010000`, photo guidance `20261013000000`, selection v2 `20261020000000`,
   in that order. Re-read Production history before deciding its list. Do not use
   an unfiltered push: account deletion remains blocked there until the Production
   cleanup worker is operational and verified. No new migration is added here.
3. Review target catalog meanings against all 60 keys. Create a reconciliation
   JSON with `project_ref`, `snapshot_sha256` (the planner's digest), real
   `reviewer`, `reviewed_at`, and exactly 60 `concepts` records containing
   `concept_key`, `meaning_sha256` from the existing approval, and `existing_id`
   (the target UUID for an existing match; null only for a reviewed new identity).
   This is separate from linguistic approval. Unknown aliases under other keys,
   different categories, terms, CEFR/POS or existing guidance block the plan.
   Resolve conflicts explicitly; the importer cannot overwrite or rename them.
4. Re-run with `--reconciliation /private/tmp/reconciled.json`. Review all inserts
   and the new `plan_sha256`. Only then use `--approve-plan <exact hash>` and
   `--write-sql /private/tmp/reviewed-import.sql` with the same inputs. This merely
   writes a new SQL artifact; it does not execute it. No privileged values appear
   in the plan. Record artifact/plan digests with the rollout evidence.
5. In a future authorized rollout, authenticate to the verified target using
   protected operator credentials. Reconfirm its ref **at the connection layer**;
   the generated SQL comment is not a server identity check. Use `ON_ERROR_STOP`
   and the whole transaction, never paste statements piecemeal. Acquire bounded
   locks on all four catalog tables and compare the entire captured state before
   any insertion. SQL escapes text and refuses stale plans. New concept/term UUIDs
   come from the target database; matching UUIDs and all unrelated records are
   retained. New concepts and terms are **inactive**; existing active flags are
   preserved. The importer never updates learning history or challenge snapshots.
6. Capture the returned concept/term identity receipt and query counts/linkage,
   guidance locales, permissions and inactive flags after commit. Activation is
   a separate, reviewed, scoped operation; no activation SQL is provided here.

A failure before commit rolls back all inserts. Do not repair a partial failure by
changing UUIDs. On timeout/lost acknowledgement, take a fresh snapshot and rebuild
the plan; an old plan deliberately rejects changed state. A completed import with
a fresh, reconciled snapshot produces **zero inserts**. This is retry safety,
not permission to replay an uncertain transaction blindly.

Keep the pre-import snapshot, plan, approved artifacts and post-commit receipt in
protected operational storage. After an unwanted committed staging import, leave
new rows inactive while investigating. Prefer a separately approved forward
correction; never hard-delete identities referenced by challenges, submissions or
permanent completion. If anything was activated, halt further activation and
review scoped deactivation and already-issued challenges. Database backup restore
is a last-resort operator procedure, not an automatic importer rollback. There is
no destructive undo script.

## Verification

Completed local checks:

- `npm run check`: strict TypeScript, zero-warning lint, Prettier and **1,048 tests / 91 suites** pass.
- Vocabulary validator/importer suites: **35 tests** pass, including nine new catalog/provenance tests; generated review matches the source.
- Structural validation: **zero errors**, 60 unchanged meaning approvals. Strict release mode deliberately exits 1 with **123 blockers**. Dev dry-run exits 1 with **246 blockers** (the release blockers, 120 draft locale approvals, two missing migrations, one missing target reconciliation), **zero detected lexical/metadata conflicts**, proposed **60/120/120** concept/term/guidance inserts, and no SQL execution.
- Local SQL/RLS mirror: **1,844 assertions / 32 files** pass. All 19 sequential Auth/database/Storage commands, guidance replay, bootstrap/replay and local database lint pass. No warning/error from database lint.
- New isolated-database importer test passes: real SQL constraints/linkage, inactive staging, injected failure rollback, competing lock serialization, stale-plan rejection, fresh-plan no-op replay, retained active flags and UUIDs. Its synthetic review/CEFR fixtures exist only in a disposable database which was dropped; no real pilot was imported.
- Function typecheck/lint and **33 tests** pass. CI setup/audit-policy regression tests: **24 pass**.
- iOS/Android/web exports pass; credential scan passes on **604 source/config/export files and both decoded Hermes bundles**. `git diff --check` passes.
- Expo Doctor: **20/21**, SDK compatibility fails because Expo now recommends `expo ~57.0.31` and `expo-router ~57.0.29`; installed `57.0.30` / `57.0.28` are unchanged.
- Audit gate correctly **fails** on the expired exception. Current audit reports **0 critical, 49 high, 11 moderate**; all findings remain visible. No threshold, exception, dependency or lockfile was changed.

CI is **not green** because of the existing dependency/audit blockers. These do
not validate or invalidate linguistic judgments. iOS release-security is not cleared. No device, independent
human review, hosted migration execution, hosted import or release clearance is
claimed. The temporary audit exceptions expire 2026-10-21 at 00:00 UTC; this task
does not renew them or alter the audit policy.

## Inactive staging preparation — 2026-10-22

This section supersedes the earlier infrastructure and executable-import status.
No hosted writes, migrations, language provisioning, vocabulary imports, activation,
commits or pushes occurred. The approved pilot, meanings, translations, CEFR values
and localized guidance were not edited in this preparation pass.

### Backups and recovery

Both explicitly targeted projects are healthy and read-only catalog queries succeed.
Production's IPv4 session pooler is `aws-0-us-east-1.pooler.supabase.com:5432`.
The repository link remains Dev. Automatic backup/WAL availability is **not** used
as recovery evidence.

Full custom-format logical exports completed through `pg_dump` with
`default_transaction_read_only=on`. Both were restored with original owners and ACLs
into separate local PostgreSQL 17.6 containers with **networking disabled**. Dev
requires `pg_cron` and `pg_net` preloaded; Cron execution was disabled. Platform role
names were recreated locally; the managed event-trigger owner requires the local
`supabase_admin` fixture to be a superuser. No hosted roles were changed.
All table counts across `public`, `private`, `auth`, `storage`, and
`supabase_migrations` matched: **78 Dev tables and 73 Production tables**.

| Archive    | SHA-256                                                            |
| ---------- | ------------------------------------------------------------------ |
| Dev        | `2d63d6071bb48cb350509aef191eb9a36d592603ca66acbfbce651a24941e036` |
| Production | `3c454cafaa105ce23b455eecb797b57ff0d3faf727182211e186e9da2aac091b` |

The verified archives and counts-only receipts are currently private files under
`/private/tmp/langtify-backup-preparation/` (directory 0700, files 0600). Temporary
connection-detail files were removed. **Durable encrypted retention is pending
operator approval:** automatic approval review rejected the proposed Application
Support destination and separately stored key files until destination/handling are
explicitly approved. Do not regard temporary storage as a durable/off-machine backup.
Do not proceed with hosted writes until retention is resolved and the backup is
still an acceptable pre-change recovery point.

These are database backups, not Storage object-byte backups or exports of Auth,
SMTP, OAuth and Edge configuration. Database role passwords are not included.
A future restore must match platform extensions/roles and restore the archive using
`pg_restore --exit-on-error --single-transaction` against a separately verified
recovery target. Do not restore over a live project casually: a whole-database restore
can erase later user activity. Keep restored Cron/network workers disabled until the
recovery target and external capabilities have been reviewed. Restore-test before use;
compare table counts, migration history, owners, grants, policies and constraints.
For a failed atomic migration/import, first verify rollback/no commit rather than
restoring the whole database. For a lost acknowledgement, snapshot and reconcile IDs
before retrying; never blindly execute a stale import plan.

### Explicit staging mode

`import-vocabulary-catalog.mjs --mode inactive-staging` accepts the structurally valid
editorial draft with the existing owner-approved identity hashes and AI-review
provenance. It retains **243 release blockers** in `release_blockers`: 123 existing
manifest/review/coverage blockers plus 120 localized-copy approvals. They are not
marked resolved or approved. The default `release-reviewed` mode still blocks SQL
on those conditions; the standalone release validator is unchanged. Neither mode
can activate vocabulary.

Staging continues to require both prerequisite migrations, active EN/FR language
identities, current target-specific reconciliation and zero conflicts. Missing locales,
malformed data, changed approved meanings or stale evidence still fail. Existing active
pilot identities block staging, avoiding changes to visible guidance or implicit
reactivation/deactivation. Inserts always use `is_active=false` for concepts and terms.
Guidance has no separate active flag; its RLS/helper checks the parent concept.
All existing unrelated rows and UUIDs remain unchanged; stale catalog snapshots fail
inside the locked transaction.

**Inactive is not confidential:** existing authenticated raw-catalog SELECT policies
allow reading concept and term rows, including inactive ones. This policy was preserved.
Daily selection and Explore exclude inactive rows; photo guidance is hidden while its
concept is inactive. If private editorial staging is required, that needs a separate
reviewed access-policy design before import, not a claim that inactive flags hide raw
catalog data.

### Identity reconciliation and current dry-runs

`data/vocabulary/reconciliation/dev.v0.2.0.json` compares all 36 existing Dev keys and
72 primary terms with all 60 approved definitions. Related-but-distinct meanings are
recorded, including BOOK/READ, CROWDED/WAITING_LINE, RIME/SNOW, BANK_RIVER/BEACH,
SUITCASE/BACKPACK and IRIDESCENCE/COLOURFUL. There is no matching meaning or primary
term/alias conflict, so all 60 pilot records are new identities; all 36 Dev UUIDs are
retained. The Production reconciliation records its empty catalog. These records are
explicitly AI-assisted identity reconciliation, not independent human editorial
approval, and are bound to each snapshot hash.

Live-state offline dry-runs found **zero conflicts**. Dev proposes 60 concepts,
120 terms and 120 guidance rows, blocked only by the absent guidance/selection-v2
migrations. Production additionally lacks both languages, so its present-state plan
cannot yet resolve the 120 term foreign keys. Do not fake Production language UUIDs.
Refresh its snapshot and reconciliation after language provisioning.

A separate **local restored-copy rehearsal** applied the scoped tracked migrations,
inserted Production's two languages, and imported 60/120/120 rows in each local copy.
Both passed: all pilot concepts/terms inactive, existing catalog rows/UUIDs unchanged,
zero pilot selection eligibility, zero authenticated guidance visibility, and rejection
of stale migration scripts. This is not evidence of any hosted deployment.

### Exact future operations, after retention and execution approval

Use the offline artifact preparer with a fresh read-only snapshot and a new output
directory. It contains no connection or apply option:

```sh
node scripts/prepare-vocabulary-deployment.mjs \
  --snapshot /private/tmp/langtify-prepared-dev-snapshot.json \
  --output-dir /private/tmp/langtify-reviewed-dev-execution
node scripts/prepare-vocabulary-deployment.mjs \
  --snapshot /private/tmp/langtify-prepared-prod-snapshot.json \
  --output-dir /private/tmp/langtify-reviewed-prod-execution
```

Each generated migration transaction locks migration history, asserts the complete
expected version list, applies the original migration body, and inserts its history
record in the same transaction. Source SHA-256 values are in the plan. An unexpected
baseline, unknown migration or changed live history stops execution. Original migrations
are unchanged. Verify the authenticated connection's project identity before each
artifact; a target comment is not a database identity assertion.

1. **Dev first:** `20261005000000_explicit_service_role_rpc_grants`,
   `20261005010000_explicit_service_role_table_grants`,
   `20261013000000_vocabulary_photo_guidance`,
   `20261020000000_bounded_challenge_selection`, in that order.
2. Verify Dev schema/security/history, then refresh its read-only snapshot. Rebind
   identity reconciliation only after confirming its catalog is unchanged; rerun the
   inactive dry-run and review the exact plan hash before generating SQL.
3. **Production:** `20261013000000_vocabulary_photo_guidance`, then
   `20261020000000_bounded_challenge_selection`. Explicitly exclude
   `20261003000000_storage_cleanup_coordination` and `20261012000000_account_deletion`.
   Do not use an unfiltered `db push`.
4. Execute Production's separately generated `languages.sql`: insert `en / English /
English` and `fr / French / Français`, active, with database-generated UUIDs.
   It locks/asserts the confirmed empty catalog and does not upsert, rename or
   reactivate existing rows. No Dev seed concepts are included.
5. Refresh Production's snapshot, confirm language identities and reconciliation,
   then dry-run and review the import plan as for Dev.

For either environment, use its own snapshot/reconciliation and exact project ref:

```sh
node scripts/import-vocabulary-catalog.mjs --mode inactive-staging \
  --snapshot <current-snapshot.json> --project-ref <exact-project-ref> \
  --reconciliation <current-target-reconciliation.json>
```

Only after zero blockers/conflicts, add `--approve-plan <exact-plan-sha256>` and
`--write-sql <new-private-file.sql>` to generate the inactive insert transaction.
This still does not execute anything. After later execution, verify 60 distinct
concepts, 120 correctly linked EN/FR terms, 120 localized guidance rows, inactive
concept/term flags, unchanged unrelated UUIDs/rows, and unchanged selection/XP/RLS.
Activation remains a separate operation requiring all release approvals; no activation
script is provided.

### Verification for this preparation pass

- `npm run check`: TypeScript, ESLint, formatting, **1,048 tests / 91 suites** pass.
- Vocabulary Node tests: **38 pass**, including new staging/release gate separation,
  active-identity rejection and scoped migration/language preparation regressions.
- Local SQL/RLS: **1,844 assertions / 32 files** pass.
- `npm run db:test:vocabulary`: passes, including real local photo verification,
  privacy, deletion, concurrency, preview expiry, and the isolated inactive importer.
  The first attempt lacked the local Edge Function server; it passed after starting
  the documented temporary function mirror. No hosted functions were deployed.
- Both complete backup restores and both restored-copy rollout rehearsals pass.
- Credential scan: **608 files and both decoded Hermes bundles** pass. Existing
  export artifacts were scanned; new exports/device tests were not needed or claimed
  for this tooling-only pass. `git diff --check` passes.
- No package, dependency, original migration, mobile code or CI-policy edits in this
  pass. Earlier uncommitted editorial work remains intact. Existing expired audit
  exceptions/SDK patch recommendations are separate release issues, not waived here.
