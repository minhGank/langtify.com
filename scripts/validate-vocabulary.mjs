import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { validateManifest, LEVELS, DIVERSE_CATEGORIES } from './lib/vocabulary-manifest.mjs';
import { validateMeaningApproval, validateGuidance } from './lib/vocabulary-guidance.mjs';
import { validateEditorialReview } from './lib/vocabulary-catalog.mjs';
const root = new URL('../', import.meta.url);
export const jsonFile = (relative) => JSON.parse(readFileSync(new URL(relative, root), 'utf8'));
export function loadPilot(version = '0.2.0') {
  if (!['0.1.0', '0.2.0'].includes(version)) throw new Error('Unsupported pilot version.');
  return {
    manifest: jsonFile(`data/vocabulary/pilot.v${version}.json`),
    options: {
      seedSql: readFileSync(new URL('supabase/seed.sql', root), 'utf8'),
      baseline: jsonFile('data/vocabulary/seed-baseline.v1.json'),
      grammar: jsonFile(`data/vocabulary/french-grammar.v${version === '0.2.0' ? 2 : 1}.json`),
    },
  };
}
const cell = (value) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
const categories = {
  everyday_objects: 'Everyday objects',
  animals_plants: 'Animals and plants',
  actions_activities: 'Actions and activities',
  emotions_expressions: 'Emotions and expressions',
  nature_weather: 'Nature and weather',
  places_environments: 'Places and environments',
  social_situations: 'Social interactions and situations',
  visual_descriptions: 'Visual descriptions',
  abstract_scenes: 'Abstract meanings in scenes',
};
const level = (t) => t.cefr ?? 'Unresolved';
const grammar = (g) =>
  g.form === 'infinitive'
    ? 'Infinitive; no noun article.'
    : g.form === 'invariable'
      ? 'Invariable adjectival phrase; no noun article.'
      : g.form === 'masculine_singular'
        ? `Adjective: masculine singular primary; feminine ${g.feminine}; plural ${g.masculine_plural} / ${g.feminine_plural}.`
        : `${g.gender === 'm' ? 'Masculine' : 'Feminine'}, ${g.number}; article ${g.article}.`;

export function renderReview(m, result) {
  if (m.schema_version !== 2 || result.errors.length)
    throw new Error('A valid v2 manifest is required for the current review.');
  const identityApproved = validateMeaningApproval(
    m,
    jsonFile('data/vocabulary/meaning-approval.v0.2.0.json'),
  );
  const prior = jsonFile('data/vocabulary/pilot.v0.1.0.json');
  const retained = m.concepts.filter((c) =>
    prior.concepts.some((p) => p.concept_key === c.concept_key),
  );
  const count = (field) =>
    Object.fromEntries(
      [...new Set(m.concepts.map((c) => c[field]))].map((v) => [
        v,
        m.concepts.filter((c) => c[field] === v).length,
      ]),
    );
  const literal = m.concepts.filter((c) => c.photography.mode === 'literal').length;
  return `# Vocabulary pilot ${m.version} — diverse photographic meanings

**Editorial draft, ${m.created_at}. 60 concepts / 120 primary terms. ${identityApproved} identities/meanings approved by the project owner; ${result.approved} fully verified bilingual entries. No import.**

Any meaning that can be recognisably represented through a photograph is eligible: objects, living things, actions, emotions, situations, properties and abstract meanings. Photographable does not mean concrete noun. This version supersedes the [object-heavy v0.1 review](VOCABULARY_PILOT_REVIEW_v0.1.0.md); its 12 speculative advanced component candidates are all absent, not relabelled as easier words. Useful familiar objects remain part of the mix.

Canadian English and standard Metropolitan French remain primary. English verbs use their base form and French verbs the infinitive; adjective entries are not forced into noun grammar. Each language has its own provisional CEFR rationale below. **These are editorial estimates, not externally certified word levels.** Original definitions and examples are newly written; no proprietary word list is copied.

## Mix and interpretation

| Category | Concepts |
| --- | --- |
${DIVERSE_CATEGORIES.map((c) => `| ${categories[c]} | ${count('category')[c] ?? 0} |`).join('\n')}

Parts of speech: ${Object.entries(count('part_of_speech'))
    .map(([k, n]) => `${n} ${k}s`)
    .join(
      ', ',
    )}. Primary examples: **${literal} literal / ${60 - literal} interpretive**. Alternatives have their own mode; a paper butterfly represents an animal but is not a literal animal photograph.

**Literal** means the relevant object, visible action, place or property can appear in the image, including a consenting staged action. **Interpretive** means the scene suggests a meaning through expression, context, a model or metaphor. No photograph proves happiness, loneliness, friendship or another internal state. Both modes are eligible editorially; recognisability still needs human testing. Staging is disclosed in the guidance, not passed off as documentary evidence.

The project owner approved all 60 concept identities and meanings on 2026-10-13, recorded in meaning-approval.v0.2.0.json with per-meaning hashes. Translation accuracy, CEFR estimates and guidance copy are separate: entries retain draft status, with independent human reviewer/date unset. The 2026-10-21 model-assisted editorial pass records selected dictionary evidence, 19 English level corrections and a B2/C1 loneliness decision subsequently resolved to C1 by the owner on 2026-10-26. All 60 English and French guidance drafts are now authored; both locales are owner-approved for the limited pilot in owner-approval.v0.2.0.json, without independent linguistic or accessibility certification. See [release preparation](VOCABULARY_RELEASE_PREPARATION.md) and the content-hashed editorial review sidecar. Accessibility ratings are estimates, not device-tested guarantees. Easy means a simple reachable setup; moderate needs framing/context; context-dependent needs weather, location, season or a substitute. All 60 still require accessibility review. No user must show a face, involve strangers or children, reveal distress, travel, buy props, perform the depicted physical activity, or enter an unsafe setting. Real participants must consent to capture and any sharing; even cropped images can identify someone. Solo alternatives are provided. Props and library alternatives are options, not hidden requirements.

## All 60 proposals

The table shows primary ideas. Every entry's alternative, meaning boundary, French grammar and independent level rationale follow below. Category headings avoid making the table unnecessarily wide.

${DIVERSE_CATEGORIES.map(
  (category) => `### ${categories[category]}

| # | English | French | EN / FR CEFR estimate | Mode | Photo example | Accessibility |
| --- | --- | --- | --- | --- | --- | --- |
${m.concepts
  .map((c, i) => ({ c, i }))
  .filter(({ c }) => c.category === category)
  .map(
    ({ c, i }) =>
      `| ${i + 1} | ${cell(c.terms.en.display)} | ${cell(c.terms.fr.display)} | ${level(c.terms.en)} / ${level(c.terms.fr)} | ${c.photography.mode} | ${cell(c.photography.guidance)} | ${c.photography.difficulty.replaceAll('_', ' ')} — ${cell(c.photography.accessibility)} |`,
  )
  .join('\n')}`,
).join('\n\n')}

## CEFR coverage and current daily feasibility

Structural errors: **${result.errors.length}**. Release blockers: **${result.blockers.length}**. Approval is not inferred from a passing structure check.

| Language | ${LEVELS.join(' | ')} | Unresolved |
| --- | ${LEVELS.map(() => '---').join(' | ')} | --- |
${['en', 'fr'].map((l) => `| ${l} | ${LEVELS.map((k) => result.coverage[l][k]).join(' | ')} | ${result.unresolved[l]} |`).join('\n')}

No C1/C2 terms are claimed. French B2 coverage is also absent in this draft. Do not force advanced labels onto familiar meanings or obscure hardware. All assigned A1–B2 values remain provisional, including asymmetric pairs such as relief/soulagement and celebration/fête. The primary phrase, not a shorter synonym, is what the estimate applies to.

Selection policy v2 retains all six learner levels and the preferred patterns, but plans all three concepts together. Nearby-level fallback is bounded to one level below/above, with at most one word above the learner. C2 may use B2 consolidation only when C1/C2 supply is insufficient. Actual term levels remain visible. Existing challenges keep policy v1. See [the implementation and verification plan](DAILY_SELECTION_V2.md).

The table below simulates a fresh user completing all three concepts daily, with no replacements, prior completions or accessibility exclusions. Provisional counts are **not release approval**. A finite horizon is not a guarantee for every user or language switch.

| Language | Learner | Provisional full days | Fallback days | B2 consolidation days | Fully reviewed full days |
| --- | --- | --- | --- | --- | --- |
${['en', 'fr']
  .flatMap((language) =>
    LEVELS.map((learner) => {
      const supply = result.readiness.provisional[language][learner];
      return `| ${language} | ${learner} | ${supply.fullCompletionDays} | ${supply.fallbackDays} | ${supply.consolidationDays} | ${result.readiness.reviewed[language][learner].fullCompletionDays} |`;
    }),
  )
  .join('\n')}

The validator checks feasible three-concept days under the actual policy instead of demanding every lexical CEFR bin be populated. It preserves separate linguistic/editorial release gates. This pilot still cannot support the complete six-level offering. No concept, translation or CEFR estimate was changed to improve these figures. Category variety is a soft tie-break among equally recent candidates, not a quota or a new eligibility rule.

The long-term target remains 600 distinct meanings / 1,200 primary terms, not 600 objects or six equal quotas. At three new completed meanings daily, 600 permits at most 200 full-completion days before global exhaustion; exact-level pools, access constraints and replacements can make the practical horizon shorter. Set a launch horizon and replenishment plan. Completed concepts must never be recycled to conceal exhaustion.

## Identity, seed exclusions and semantic boundaries

Eight concepts keep their v0.1 keys and meanings: ${retained.map((c) => c.concept_key).join(', ')}. The other 52 proposals replace the previous draft's emphasis; they are not renames of hardware identities. Keep v0.1 as historical draft data. No persistent identifiers or existing captures are rewritten.

All 36 Dev seed keys and known lexical aliases remain excluded. **CROWDED already exists in the seed**; it belongs in the broader curriculum but is not one of these 60 new-to-seed proposals. DOG, CAT, BOOK and other seed fixtures are likewise not automatically approved. A future approved version must reuse the actual Dev concept identity after semantic reconciliation, never create a renamed duplicate or blindly copy Dev UUIDs to Production.

Additional reviewed boundaries (automated lexical checks alone cannot prove them):

- READ is an action; seed BOOK is an object. A closed book alone should not stand for reading.
- WAITING_LINE concerns order/turn-taking, not seed CROWDED (density) or TRAFFIC_JAM (vehicles). A sparse toy line is enough; a crowd is not required. The seed exclusion list now recognises additional crowded/packed-scene forms too.
- SNOW is precipitation/accumulation, not seed RIME (frost deposition). RAINBOW and COLOURFUL are not seed IRIDESCENCE (angle-dependent sheen). PUDDLE is pooled water, not seed REFLECTION; show its edge.
- BEACH means a sand/pebble shore, not seed BANK_RIVER's river edge. FOREST centres trees, PARK centres a managed leisure space; an ambiguous generic green view is not ideal for both.
- HAPPINESS is a feeling; CELEBRATION is an event. FRIENDSHIP is a relationship; SHARE and HELP are acts. LONELINESS is unwanted disconnection, not any person alone or SADNESS in general. PATIENCE is calm waiting/persistence, not simply standing in a line.
- EMPTY describes contents, MESSY arrangement, WET surface state and ROUND shape. They may apply to an existing object without becoming duplicates of that object's identity. A photograph can express multiple meanings; that does not justify duplicate meanings in the catalog.

## Translation and interpretation decisions

- Loneliness uses **le sentiment de solitude** to distinguish unwanted feeling from chosen solitude. This qualified phrase is an editorial choice awaiting review; the dictionary supports solitude as a translation, not a guaranteed one-to-one emotional inference. [Larousse loneliness](https://www.larousse.fr/dictionnaires/anglais-francais/loneliness/592813).
- Relief in the emotion sense is **le soulagement**, not the French false friend relief. [Larousse relief](https://www.larousse.fr/dictionnaires/anglais-francais/relief/606974).
- Messy means **en désordre**, not necessarily sale. The French phrase is invariable; inflected adjectives elsewhere include their agreement forms. [Larousse messy](https://www.larousse.fr/dictionnaires/anglais-francais/messy/594861).
- Celebration uses **la fête** for a joyful occasion, not every possible sense of célébration. [Larousse celebration](https://www.larousse.fr/dictionnaires/anglais-francais/celebration/569145).
- Canadian spelling **colourful** is primary; colorful remains an alias. Waiting **line** is primary English with queue as an alias. French **arrêt de bus** is primary with **arrêt d’autobus** recorded as a Canadian alternative, also found in Quebec's language-learning material. [Québec transport vocabulary](https://referencesfrancisation.immigration-quebec.gouv.qc.ca/moodle_ref/mod/resource/view.php?id=922).

These sources support selected senses/usage, not exact per-word CEFR classifications. CEFR describes communicative proficiency and vocabulary range, not an automatic label determined by word rarity or photographic difficulty. [Council of Europe descriptors](https://www.coe.int/en/web/common-european-framework-reference-languages/cefr-descriptors).

## Detailed editorial cards

${m.concepts
  .map(
    (c, i) => `### ${i + 1}. ${c.concept_key}

**${c.terms.en.display} — ${c.terms.fr.display}** · ${categories[c.category]} · ${c.part_of_speech} · draft.

Meaning: ${c.definition}

Primary photo (${c.photography.mode}): ${c.photography.guidance}

Alternative (${c.photography.alternative_mode}): ${c.photography.alternative}

Accessibility: ${c.photography.accessibility}

Safety: ${c.photography.safety}

English ${level(c.terms.en)}: ${c.terms.en.cefr_rationale}

French ${level(c.terms.fr)}: ${c.terms.fr.cefr_rationale}

French grammar: ${grammar(c.terms.fr.grammar)}

French photo draft: ${jsonFile('data/vocabulary/photo-guidance.v0.2.0.json').concepts.find((g) => g.concept_key === c.concept_key).locales.fr.primary_idea}

French alternative: ${jsonFile('data/vocabulary/photo-guidance.v0.2.0.json').concepts.find((g) => g.concept_key === c.concept_key).locales.fr.alternative_idea}

French accessibility: ${jsonFile('data/vocabulary/photo-guidance.v0.2.0.json').concepts.find((g) => g.concept_key === c.concept_key).locales.fr.accessibility_guidance}

French safety: ${jsonFile('data/vocabulary/photo-guidance.v0.2.0.json').concepts.find((g) => g.concept_key === c.concept_key).locales.fr.safety_guidance}

Review concern: ${c.editorial.concerns.join(' ')}
`,
  )
  .join('\n')}

## Owner pilot acceptance and remaining validation

1. The owner approved the existing translations, bilingual guidance and a limited pilot on 2026-10-26, selected English loneliness C1 and accepted remaining provisional levels and advanced-level shortages. See owner-approval.v0.2.0.json. Draft fields preserve the absence of independent linguistic/accessibility certification; they do not revoke this scoped owner approval.
2. Interpretive scenes and models remain eligible under the approved photographic-meaning principle and owner-approved guidance. A scene suggests a meaning rather than proving an internal state. Future rating-copy or AI-validation changes are outside this rollout.
3. Test solo/seated alternatives and phone framing with people with differing mobility, vision, living space and cultural backgrounds. No single scene is universally obvious. Decide whether accessibility preferences or an optional creative slot should affect future assignment; neither exists in the algorithm today.
4. Selection v2 is deployed in both environments and unchanged. The owner accepts controlled shortages for this limited pilot, including Production French C1/C2. This is not approval to claim a fully supplied six-level launch.
5. Set the content horizon, replacement reserve and expansion balance before growing to 600. Do not auto-approve the existing 36 fixtures or force C1/C2 for apparent completeness.

Offline checks validate structure, grammar metadata, documented duplicates and draft gates. They cannot certify translation accuracy, photo meaning or CEFR. See [manifest contract](../data/vocabulary/README.md). An offline, gated catalog import planner is included; the 60 concepts are already staged in both environments; activation status is recorded separately in VOCABULARY_ACTIVATION_REVIEW.md.
`;
}
async function main(args) {
  if (args.some((a) => !['--release', '--write-review', '--check-review'].includes(a)))
    throw new Error('Unsupported flag.');
  const { manifest, options } = loadPilot();
  const result = validateManifest(manifest, options);
  const identityApproved = validateMeaningApproval(
    manifest,
    jsonFile('data/vocabulary/meaning-approval.v0.2.0.json'),
  );
  result.errors.push(
    ...validateGuidance(manifest, jsonFile('data/vocabulary/photo-guidance.v0.2.0.json')),
    ...validateEditorialReview(
      manifest,
      jsonFile('data/vocabulary/photo-guidance.v0.2.0.json'),
      jsonFile('data/vocabulary/editorial-review.v0.2.0.json'),
    ),
  );
  console.log(
    JSON.stringify(
      { dataset: manifest.dataset_id, version: manifest.version, identityApproved, ...result },
      null,
      2,
    ),
  );
  if (args.includes('--write-review') || args.includes('--check-review')) {
    if (result.errors.length) throw new Error('Refusing to render an invalid manifest.');
    const { format } = await import('prettier');
    const rendered = await format(renderReview(manifest, result), {
      parser: 'markdown',
      proseWrap: 'preserve',
      printWidth: 95,
    });
    const path = new URL('docs/VOCABULARY_PILOT_REVIEW.md', root);
    if (args.includes('--write-review')) writeFileSync(path, rendered);
    if (args.includes('--check-review') && readFileSync(path, 'utf8') !== rendered)
      throw new Error('Review document is stale; regenerate it.');
  }
  process.exitCode =
    result.errors.length || (args.includes('--release') && result.blockers.length) ? 1 : 0;
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(
      'Vocabulary validation failed:',
      error instanceof Error ? error.message : 'unknown error',
    );
    process.exitCode = 1;
  });
}
