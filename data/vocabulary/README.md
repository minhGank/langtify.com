# Vocabulary manifest contract — v2 diverse pilot

The current offline draft is **v0.2.0: 60 concepts / 120 English–French terms**.
A photographable meaning can be an object, action, emotion, property, situation or
abstract idea represented in a recognisable scene. The noun-only v1 restriction
was an editorial tooling limitation, not a Langtify product rule.

The 60 identities and meanings are approved by the project owner (2026-10-13).
Translations, CEFR estimates, accessibility and instruction copy remain drafts.
The separately authorized [photo-guidance implementation](../../docs/VOCABULARY_PHOTO_GUIDANCE.md)
adds a local-only guidance importer and optional Today help. It creates no catalog
UUIDs and changes no selection rules. The target remains 600 distinct meanings,
with A1–B2 quality prioritised and no manufactured C1/C2 classifications.

## Current and historical files

- `pilot.v0.2.0.json`: current draft; all 60 entries have draft status, per-language
  provisional CEFR rationale, primary and alternative photo ideas, interpretation
  modes, access limitations and safety guidance.
- `meaning-approval.v0.2.0.json`: owner approval of keys/definitions only, pinned by
  per-meaning hashes. It cannot mark bilingual review or CEFR evidence complete.
- `photo-guidance.v0.2.0.json`: versioned EN/FR localization contract; currently
  English copy only, with independent draft copy review. The English fields must
  match the pilot photography metadata. See the photo-guidance runbook for import.
- `french-grammar.v2.json`: separate draft consistency assertions for noun gender,
  number and onset; verb infinitives; adjective agreement and invariable phrases.
  This catches accidental changes, not semantic accuracy or external certification.
- `seed-baseline.v1.json`: unchanged seed SQL hash and 36 Dev seed identities/labels,
  with curated lexical exclusions. Extra crowded/packed forms now guard against
  replacing the existing CROWDED identity under a new key. The SQL itself is unchanged.
- `../../docs/VOCABULARY_PILOT_REVIEW.md`: generated current review, all 60 concepts,
  detailed bilingual rationale, photo alternatives and proposed curriculum decisions.
- `pilot.v0.1.0.json`, `french-grammar.v1.json` and `pilot-review.v0.1.0.json`: retained
  historical drafts, not current content or an approved import. The archived review
  is `../../docs/VOCABULARY_PILOT_REVIEW_v0.1.0.md`. Its hardware emphasis and advanced
  review queue are superseded. The old annotation sidecar is no longer a CLI input.

The CLI pins v0.2.0. `loadPilot('0.1.0')` is available to local tests to preserve v1
regression coverage. Unknown versions fail. Do not overwrite released artifacts;
review a new content version when changing approved content.

## Commands

```sh
# Current draft validation; does not mean editorial approval.
node scripts/validate-vocabulary.mjs

# Generate the review or check that it matches the manifest and generator.
node scripts/validate-vocabulary.mjs --write-review
node scripts/validate-vocabulary.mjs --check-review

# Expected exit 1 while draft/accessibility/coverage blockers remain.
node scripts/validate-vocabulary.mjs --release

node --test scripts/tests/vocabulary-manifest.test.mjs scripts/tests/vocabulary-guidance.test.mjs
npm run check
```

All paths are resolved from the script directory. Unsupported flags such as
`--import` fail. `--check-review` and the regression test fail on stale output;
tests do not regenerate the document. No network is needed for validation.

## Versioned shape

Both schema versions retain strict known-field validation. V1 remains noun-only
for its historical artifact; v2 supports the broader approved curriculum scope.
Every listed field is required unless an explicitly nullable value is described.
Strings must be nonempty, trimmed and NFC. Unknown fields and enum values fail.

| Object      | Fields                                                                                                                                                                                                                                        |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest    | `schema_version: 2`, `dataset_id: langtify-vocabulary-pilot`, content `version`, ISO `created_at`, `status: draft/approved`, `expected_concepts: 60`, `languages: [en, fr]`, `language_policy`, `source_policy`, `concepts[]`                 |
| Concept     | Stable uppercase `concept_key`, `definition`, `category`, `part_of_speech: noun/verb/adjective`, `photography`, `terms`, `editorial`                                                                                                          |
| Photography | `photographable: true`, `mode: literal/interpretive`, `guidance`, `alternative`, `alternative_mode: literal/interpretive`, `difficulty: easy/moderate/context_dependent`, `accessibility`, `availability: everyday/review_required`, `safety` |
| Terms       | Exactly `en` and `fr`; each has `lemma`, `display`, `aliases[]`, `cefr`, `cefr_review_band`, `cefr_rationale`, `grammar`                                                                                                                      |
| Editorial   | `status: draft/approved`, nullable `reviewer` and `reviewed_at`, `concerns[]`, `translation_evidence[]`, `cefr_evidence: {en: [], fr: []}`                                                                                                    |

Nine categories: `everyday_objects`, `animals_plants`, `actions_activities`,
`emotions_expressions`, `nature_weather`, `places_environments`,
`social_situations`, `visual_descriptions`, `abstract_scenes`. Each must appear in
this representative pilot; counts are editorial choices, not daily quotas.

English grammar metadata remains null and display equals lemma. French nouns use
`{gender, number, article, onset}` as in v1. French verbs use `{form: infinitive}`,
including reflexive phrases. Adjectives use `{form: masculine_singular, feminine,
masculine_plural, feminine_plural}`, or `{form: invariable}` for a phrase such as
`en désordre`. Verbs/adjectives display their lemma without a noun article. All
French forms must agree with the separately stored grammar assertions. The field
`part_of_speech` describes the matched sense in this pilot; do not force future
cross-language part-of-speech mismatches into this contract without review.

Each language's CEFR can be A1–C2 or null. Null requires a non-null review band;
a review band is never assigned coverage. All v0.2 terms have provisional estimates,
not approval. Each has a language-specific rationale, not inherited from its
translation. No term is assigned C1/C2, and French B2 is also absent.

Literal/interpretive describes the **example**, not whether a word is eligible.
Both modes are allowed. Emotion and abstract-scene primary examples must be
interpretive: a photo must not be presented as proof of a hidden mental state.
An animal photo can be literal while its toy-model alternative is interpretive.
Difficulty and accessibility are separate from CEFR. Required text fields cannot
prove that an example is safe or accessible; human testing is still required.
All 60 availability fields remain `review_required` rather than claiming access
has been validated for everyone.

## Duplicate and identity checks

The validator checks keys, normalized definitions, primary terms and aliases within
each language and against the seed baseline. Case, accents, ligatures, punctuation
and leading articles are normalized. Seed SQL parsing and its pinned hash remain
strict; do not refresh the hash merely to conceal drift. The alias map is curated,
not a general semantic equivalence engine. New synonyms and scene overlap need
bilingual review. See the report for READ/BOOK, WAITING_LINE/CROWDED,
SNOW/RIME, BEACH/BANK_RIVER and other distinctions.

Eight v0.1 meanings keep their keys: BED, PILLOW, BOTTLE, PLATE, SPOON, FORK,
BACKPACK and SCISSORS. The 52 others are new proposals, not repurposed old keys.
None duplicates a known seed meaning. The existing 36 seed concepts remain
**development fixtures**, not approved Production content. CROWDED is intentionally
absent here because it already has a Dev identity, despite fitting the new direction.

A future approved import must reconcile semantic meaning and key, preserve actual
Dev concept/term UUIDs, and avoid copying Dev UUIDs blindly into Production. It must
fail on unknown semantic matches, default to a reviewed dry-run with explicit project
ref and artifact hash, apply atomically and replay as a no-op. Never reset completed
history or rewrite immutable assignment snapshots. Full catalog import remains
unimplemented. The local guidance-only importer reuses existing UUIDs and refuses
missing identities; it never creates terms/concepts or connects to hosted projects.

## Approval and curriculum gates

The separate identity/meaning approval is already recorded. Full bilingual release
approval still requires reviewer/date, translation and independent EN/FR level
evidence, no unresolved concerns, and reviewed accessibility. Drafts may not
claim a completed human review. Merely filling these fields cannot authenticate a
reviewer's identity or validate a linguistic claim.

The release gate requires full editorial approval and feasible three-concept days
for every supported learner level under selection policy v2. It no longer requires
every lexical CEFR bin to be populated. The report separates provisional from
reviewed supply and simulates successive fully completed days; it does not promise
a launch horizon. See [selection policy v2](../../docs/DAILY_SELECTION_V2.md).

Preferred patterns remain unchanged. Nearby fallback preserves actual levels,
three distinct concepts, and permanent semantic completion exclusion across
languages. C2 can use B2 consolidation. An insufficient bounded pool fails
atomically; completed concepts never recycle. This pilot remains insufficient for
all six learner levels, and its translations/levels still await independent review.

## Evidence and verification

Definitions and examples are original editorial work. Selected dictionary and
regional references are linked in the review to support senses, not to claim CEFR
certification. CEFR proficiency descriptors do not automatically classify individual
words: [Council of Europe](https://www.coe.int/en/web/common-european-framework-reference-languages/cefr-descriptors).

The local test suite exercises both schema versions, duplicate/seed drift rejection,
noun/verb/adjective agreement, interpretive/accessibility metadata, draft approval
gates, coverage shortfalls and deterministic review output. The photo-guidance
runbook records additional SQL, importer and mobile tests for the implementation.
Physical photo recognisability, accessibility and bilingual review remain pending.
