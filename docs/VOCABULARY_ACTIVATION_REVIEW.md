# Existing pilot activation review — 2026-10-26

The historical review below preceded the owner's explicit activation approval on
2026-10-26. See the execution result at the end for current status. Owner approval
is recorded separately in `data/vocabulary/owner-approval.v0.2.0.json`; it does not
claim independent linguistic or accessibility certification.

**Pre-approval review.** This is a focused AI-assisted review of the already staged
60 identities, 120 terms and 120 localized guidance rows. It is not independent
human approval. No hosted queries or writes, imports, backups or migrations were
repeated. The October 26 staging receipts and post-import catalog snapshots were
used; any later hosted drift must be checked immediately before execution.

## What the 243 blockers mean

| Count | Check                                           | Finding                                                    |
| ----- | ----------------------------------------------- | ---------------------------------------------------------- |
| 60    | Accessibility review pending                    | Approval fields, not 60 demonstrated accessibility defects |
| 60    | Independent bilingual review pending            | Approval fields, not 60 incorrect translations             |
| 120   | EN/FR guidance copy approval pending            | Two draft locale records per concept                       |
| 1     | Dataset remains draft                           | Dataset approval record                                    |
| 2     | French C1/C2 have no feasible three-concept day | Real catalog coverage limitation                           |

Thus **241 approval-state blockers and two coverage blockers**, not 243 content
errors. These categories were recomputed with the existing planner for both
environments. Its release gate still fails; no flags or requirements were relaxed.

## Concrete findings and remaining decisions

All 120 primary labels and all 120 localized guidance entries were inspected.
No confirmed wrong translation, changed meaning, unsafe instruction or mandatory
inaccessible activity was found. Existing safety instructions exclude provoking
distress, photographing strangers/children, dangerous actions and unconsented
sharing. Solo/model alternatives are present. These are editorial findings, not
physical-device or universal-accessibility certification: models can still require
props, dexterity, assistance and visual interpretation.

- **Stretch / s’étirer:** keep English B2. The [Cambridge body-exercise
  sense](https://dictionary.cambridge.org/dictionary/english/stretch) explicitly
  carries B2, resolving the previous headword-versus-sense concern. French A2
  remains a separate curriculum estimate.
- **Loneliness / le sentiment de solitude:** translation and unwanted-disconnection
  meaning are sound. English B2 versus C1 remains a curriculum choice, not a
  proven semantic error. Recommend **C1**: a [university C1 word
  list](https://depo.btu.edu.tr/dosyalar/ydyo/Dosyalar/BTU%20SFL%20C1%20LEVEL%20WORDS.pdf)
  supports that placement. The earlier Cambridge loneliness page could not be
  re-fetched in this pass (403), so it is not claimed as newly verified evidence.
  Do not substitute _lonely_ or change the approved noun identity. No level was
  changed locally or in staging while this decision is pending.
- **Remaining CEFR estimates:** retain provisionally, especially the French
  estimates. Missing dictionary level labels are not evidence of a bad translation.
  Owner acceptance can authorize a pilot; it must not be recorded as independent
  bilingual certification or exact scientific CEFR validation.
- **Coverage:** Production French C1/C2 has zero eligible B2/C1/C2 concepts.
  French B2 has only five B1 concepts, allowing one full day for a fresh learner
  completing all three. English C1/C2 can initially form two days from the current
  seven B2 concepts. Moving loneliness to C1 still leaves two full advanced English
  days. These are upper-bound simulations before replacements/prior completions.
  Dev's existing fixtures improve supply but do not approve Production content.
  Recommend accepting this as a **limited pilot**, with the existing controlled
  shortage response, rather than calling it a complete six-level launch. No
  relabeling of French terms or selection-rule changes are proposed.

The sole consolidated approval proposal is: **accept the existing translations,
EN/FR guidance and provisional levels as an owner-reviewed limited pilot; choose
English loneliness C1; and accept the documented advanced-French shortage while
keeping the existing selection rules.** This approval has not been given. If it is
given, record the owner's decision separately from AI evidence and independent
review, bound to the exact content hashes. Any narrow change to release gating must
explicitly encode that decision; do not mark accessibility universally verified,
discard safety/semantic errors, or silently waive the two coverage checks.

## Prepared operation, not execution

Offline comparison reproduced both staging artifact hashes and matched all 60
concept UUIDs, 120 term UUIDs, bilingual text/levels, guidance and migration receipts.
There are **zero inserts and zero content conflicts** against those saved snapshots.

Review artifacts are local temporary files under
`/private/tmp/langtify-activation-review-20261026/`:

- `dev.review.sql` targets `ssuyyrfncvyqsgkirvpq`.
- `prod.review.sql` targets `lfdgjewypbhukjrtwsef`.
- `prepare.mjs` regenerates these offline from the existing snapshots/receipts;
  `rehearse.mjs` tests them in disposable local databases only.

Each SQL file has an **unconditional approval-pending exception and ends in
ROLLBACK**. They cannot activate the hosted catalogs as supplied. Their proposed
transaction locks the four catalog tables, compares the complete catalog against
the recorded state, updates only the recorded 120 term and 60 concept active flags,
asserts exact row counts and verifies the expected final catalog. Guidance has no
active flag; its visibility follows concept activation. No inserts, deletes,
UUID changes, RLS/policy/grant changes or selection changes are included.

These drafts currently preserve staged loneliness B2. If the recommended C1 is
approved, prepare a separate, old-value-guarded correction of its existing English
term UUID in each environment and bind the final activation to that revised
content. Do not reimport or overwrite other terms. Before any future execution,
verify target identity and live catalog against the receipt, record the explicit
approval and settle this correction. Execute Dev first and verify before Production.
Abort on drift. No new backup/migration/import is required merely to activate.

Local rehearsal passed for both environments: approval gate, exact scoped updates,
preserved unrelated catalog/guidance, rollback, late-failure atomicity and rejection
of changed content. Disposable databases were removed. This proves SQL behavior
against catalog constraints, not a new hosted verification.

Validation: `npm run check` passed (TypeScript, ESLint, formatting and 1,048 tests
across 91 suites); the manifest/guidance/coverage/catalog Node suites passed all
38 tests. Credential scan passed for 612 files and two existing decoded Hermes
bundles; `git diff --check` passed. Only this review and a link in the release
preparation document changed in this pass; existing uncommitted work was preserved.

## Owner-authorized activation — completed 2026-10-26

The owner explicitly approved all existing translations and EN/FR guidance for a
limited pilot, English loneliness C1, other provisional CEFR estimates and the
documented shortages. `owner-approval.v0.2.0.json` binds this authorization to exact
content and staging-receipt hashes. No independent certification was asserted.
The generic full-release validator remains strict; this was a separately authorized
operation for exactly these records, not a general exception for future vocabulary.

| Environment                       | Activated concepts | Activated terms | Linked guidance locales | Completed UTC |
| --------------------------------- | ------------------ | --------------- | ----------------------- | ------------- |
| Dev `ssuyyrfncvyqsgkirvpq`        | 60                 | 120             | 120                     | 17:40:47      |
| Production `lfdgjewypbhukjrtwsef` | 60                 | 120             | 120                     | 17:41:34      |

Before each write, the project identity/health, migration history, exact catalog
and schema/security fingerprint matched the recorded state. Each atomic transaction
corrected only the existing English loneliness term B2 → C1, then activated the
recorded concept/term UUIDs. All 120 guidance rows stayed unchanged. Postconditions
verified the complete expected catalog, including unrelated rows. Zero inserts or
deletes; Dev totals remain 96 concepts/192 terms, Production 60/120.

Read-only checks found 60 pilot concepts eligible in each target language: active
photographable concepts, active target/reference terms, active EN/FR languages.
The existing database level planner produced three-term plans for all Dev learner
levels, Production English A1–C2 and Production French A1–B2. Production French
C1/C2 returned NULL (the accepted controlled shortage). No actual user challenge
was generated; prior completions, assignments and saved proficiency still govern
individual eligibility. Completed-concept exclusion and existing challenges are
unchanged, as are functions, RLS, grants, policies, triggers, Storage and migrations.

Receipts with identities, approval/SQL hashes, counts and first-day level plans are
in `data/vocabulary/activation-receipts/2026-10-26.dev.json` and `.prod.json`.
Reviewed SQL and local evidence are under `/private/tmp/langtify-activation-20261026/`.
Do not rerun the transaction: it intentionally rejects an already active catalog.

The exact revised transactions passed disposable local rollback/late-failure/drift
rehearsals. `npm run check` passed (1,048 tests/91 suites); 39 vocabulary tests,
including owner-approval hash/provenance regression, passed. No reimports, backups,
migrations, infrastructure deployment, commits or pushes were performed.
