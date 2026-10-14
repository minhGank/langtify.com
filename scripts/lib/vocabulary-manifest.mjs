// Offline editorial validation only. No database client or import operation.
import { createHash } from 'node:crypto';
export const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const CATEGORIES = [
  'home',
  'kitchen',
  'food',
  'clothing',
  'personal',
  'tools',
  'garden',
  'built_environment',
  'components',
];
export const DIVERSE_CATEGORIES = [
  'everyday_objects',
  'animals_plants',
  'actions_activities',
  'emotions_expressions',
  'nature_weather',
  'places_environments',
  'social_situations',
  'visual_descriptions',
  'abstract_scenes',
];
export const normalize = (text) =>
  text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replaceAll('œ', 'oe')
    .replaceAll('Œ', 'OE')
    .toLowerCase()
    .replace(/[’']/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
const lexical = (text) => normalize(text).replace(/^(?:le|la|les|un|une|des|l|the|a|an) /, '');
const text = (x) =>
  typeof x === 'string' && x.trim().length > 0 && x === x.trim() && x === x.normalize('NFC');
const record = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

export function seedConcepts(sql, baseline) {
  const sha = createHash('sha256').update(sql).digest('hex');
  if (
    baseline.schema_version !== 1 ||
    baseline.seed_sha256 !== sha ||
    baseline.approval !== 'development_fixtures_only'
  )
    throw new Error('Seed baseline changed: review and rebuild the exclusion baseline.');
  const block = sql.match(/with examples\([^)]*\) as \(values\s*([\s\S]*?)\n\), inserted as/);
  if (!block) throw new Error('Unsupported seed format.');
  const quoted = "'((?:[^']|'')*)'";
  const pattern = new RegExp('\\(\\s*' + Array(7).fill(quoted).join('\\s*,\\s*') + '\\s*\\)', 'g');
  const matches = [...block[1].matchAll(pattern)];
  if (block[1].replace(pattern, '').replace(/[\s,]/g, '') || !matches.length)
    throw new Error('Unparsed seed rows.');
  const rows = matches.map((m) => ({
    key: m[1],
    labels: [m[3], m[4]].map((t) => t.replaceAll("''", "'")),
  }));
  if (
    !Array.isArray(baseline.concepts) ||
    baseline.concepts.length !== rows.length ||
    new Set(baseline.concepts.map((c) => c.concept_key)).size !== rows.length
  )
    throw new Error('Incomplete seed exclusion baseline.');
  return rows.map((row) => {
    const saved = baseline.concepts.find((c) => c.concept_key === row.key);
    if (
      !saved ||
      !Array.isArray(saved.aliases) ||
      !saved.aliases.every(text) ||
      !row.labels.every((label) => saved.aliases.includes(label))
    )
      throw new Error('Seed labels missing from exclusion baseline.');
    return { key: row.key, aliases: saved.aliases };
  });
}

export function validateManifest(manifest, { seedSql, baseline, grammar }) {
  const errors = [],
    warnings = [],
    blockers = [];
  const add = (path, message) => errors.push(`${path}: ${message}`);
  function shape(value, fields, path) {
    if (!record(value)) {
      add(path, 'expected object');
      return false;
    }
    for (const field of fields) if (!(field in value)) add(path, `missing ${field}`);
    for (const field of Object.keys(value))
      if (!fields.includes(field)) add(path, `unknown ${field}`);
    return true;
  }
  function string(value, path) {
    if (!text(value)) add(path, 'expected nonempty trimmed NFC text');
  }
  function texts(value, path) {
    if (!Array.isArray(value) || !value.every(text)) {
      add(path, 'expected text array');
      return [];
    }
    return value;
  }
  const seed = seedConcepts(seedSql, baseline);
  const seedKeys = new Set(seed.map((c) => c.key));
  const seedWords = new Map(seed.flatMap((c) => c.aliases.map((a) => [lexical(a), c.key])));
  const seenKeys = new Set(),
    seenDefinitions = new Set();
  const seenTerms = { en: new Map(), fr: new Map() };
  const coverage = Object.fromEntries(
    ['en', 'fr'].map((l) => [l, Object.fromEntries(LEVELS.map((level) => [level, 0]))]),
  );
  const unresolved = { en: 0, fr: 0 };
  let approved = 0;
  if (
    !shape(
      manifest,
      [
        'schema_version',
        'dataset_id',
        'version',
        'created_at',
        'status',
        'expected_concepts',
        'languages',
        'language_policy',
        'source_policy',
        'concepts',
      ],
      'manifest',
    )
  )
    return { errors, warnings, blockers, coverage, unresolved, approved };
  if (![1, 2].includes(manifest.schema_version)) {
    add('schema_version', 'unsupported version');
    return { errors, warnings, blockers, coverage, unresolved, approved };
  }
  const diverse = manifest.schema_version === 2;
  if (manifest.dataset_id !== 'langtify-vocabulary-pilot') add('dataset_id', 'unsupported dataset');
  if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.version))
    add('version', 'expected semantic version');
  if (
    typeof manifest.created_at !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(manifest.created_at) ||
    !Number.isFinite(Date.parse(manifest.created_at))
  )
    add('created_at', 'invalid date');
  if (!['draft', 'approved'].includes(manifest.status)) add('status', 'invalid review status');
  if (JSON.stringify(manifest.languages) !== '["en","fr"]') add('languages', 'expected en and fr');
  string(manifest.language_policy, 'language_policy');
  string(manifest.source_policy, 'source_policy');
  if (manifest.expected_concepts !== 60) add('expected_concepts', 'pilot requires exactly 60');
  if (!Array.isArray(manifest.concepts)) {
    add('concepts', 'expected array');
    return { errors, warnings, blockers, coverage, unresolved, approved };
  }
  if (manifest.concepts.length !== manifest.expected_concepts) add('concepts', 'count mismatch');
  if (
    !record(grammar) ||
    grammar.schema_version !== manifest.schema_version ||
    !record(grammar.forms)
  )
    throw new Error('Invalid French grammar baseline.');
  for (const [i, c] of manifest.concepts.entries()) {
    const p = `concepts[${i}]`;
    if (
      !shape(
        c,
        [
          'concept_key',
          'definition',
          'category',
          'part_of_speech',
          'photography',
          'terms',
          'editorial',
        ],
        p,
      )
    )
      continue;
    if (typeof c.concept_key !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(c.concept_key))
      add(p, 'invalid concept key');
    if (seenKeys.has(c.concept_key) || seedKeys.has(c.concept_key))
      add(p, 'duplicate/seed concept key');
    seenKeys.add(c.concept_key);
    string(c.definition, `${p}.definition`);
    if (text(c.definition)) {
      const definition = normalize(c.definition);
      if (seenDefinitions.has(definition)) add(p, 'duplicate semantic definition');
      seenDefinitions.add(definition);
    }
    if (!(diverse ? DIVERSE_CATEGORIES : CATEGORIES).includes(c.category))
      add(p, 'unknown category');
    if (!(diverse ? ['noun', 'verb', 'adjective'] : ['noun']).includes(c.part_of_speech))
      add(p, 'unsupported part of speech');
    if (
      shape(
        c.photography,
        [
          'photographable',
          'guidance',
          'availability',
          'safety',
          ...(diverse
            ? ['mode', 'alternative', 'alternative_mode', 'accessibility', 'difficulty']
            : []),
        ],
        `${p}.photography`,
      )
    ) {
      if (c.photography.photographable !== true) add(p, 'not photographable');
      string(c.photography.guidance, `${p}.guidance`);
      string(c.photography.safety, `${p}.safety`);
      if (diverse) {
        for (const k of ['alternative', 'accessibility']) string(c.photography[k], `${p}.${k}`);
        for (const k of ['mode', 'alternative_mode'])
          if (!['literal', 'interpretive'].includes(c.photography[k])) add(p, `invalid ${k}`);
        if (!['easy', 'moderate', 'context_dependent'].includes(c.photography.difficulty))
          add(p, 'invalid photo difficulty');
        if (
          ['emotions_expressions', 'abstract_scenes'].includes(c.category) &&
          c.photography.mode !== 'interpretive'
        )
          add(
            p,
            'internal states/abstract meanings require interpretation, not photographic proof',
          );
      }
      if (!['everyday', 'review_required'].includes(c.photography.availability))
        add(p, 'invalid availability');
      if (c.photography.availability === 'review_required')
        blockers.push(`${c.concept_key}: accessibility review pending`);
    }
    if (shape(c.terms, ['en', 'fr'], `${p}.terms`))
      for (const language of ['en', 'fr']) {
        const t = c.terms[language],
          tp = `${p}.${language}`;
        if (
          !shape(
            t,
            [
              'lemma',
              'display',
              'aliases',
              'cefr',
              'cefr_review_band',
              'cefr_rationale',
              'grammar',
            ],
            tp,
          )
        )
          continue;
        string(t.lemma, `${tp}.lemma`);
        string(t.display, `${tp}.display`);
        string(t.cefr_rationale, `${tp}.cefr_rationale`);
        const aliases = texts(t.aliases, `${tp}.aliases`);
        if (t.cefr === null) {
          unresolved[language]++;
          blockers.push(`${c.concept_key}/${language}: CEFR unresolved`);
        } else if (!LEVELS.includes(t.cefr)) add(tp, 'invalid CEFR');
        else coverage[language][t.cefr]++;
        if (t.cefr_review_band !== null && !LEVELS.includes(t.cefr_review_band))
          add(tp, 'invalid review band');
        if (t.cefr === null && t.cefr_review_band === null)
          add(tp, 'unresolved level needs review band');
        const forms = [t.lemma, ...aliases].filter(text);
        for (const form of forms) {
          const normalized = lexical(form);
          if (seedWords.has(normalized))
            add(tp, `seed semantic/lexical collision with ${seedWords.get(normalized)}`);
          const previous = seenTerms[language].get(normalized);
          if (previous !== undefined) add(tp, `ambiguous/duplicate label ${form} (${previous})`);
          seenTerms[language].set(normalized, c.concept_key);
        }
        if (language === 'en') {
          if (t.grammar !== null) add(tp, 'English grammar must be null');
          if (t.display !== t.lemma) add(tp, 'English display must equal primary lemma');
        } else if (diverse && c.part_of_speech !== 'noun') {
          const invariable = c.part_of_speech === 'adjective' && t.grammar?.form === 'invariable';
          const fields =
            c.part_of_speech === 'verb' || invariable
              ? ['form']
              : ['form', 'feminine', 'masculine_plural', 'feminine_plural'];
          if (shape(t.grammar, fields, `${tp}.grammar`)) {
            const expectedForm =
              c.part_of_speech === 'verb'
                ? 'infinitive'
                : invariable
                  ? 'invariable'
                  : 'masculine_singular';
            if (t.grammar.form !== expectedForm || t.display !== t.lemma)
              add(tp, 'non-noun French form/display error');
            for (const field of fields) string(t.grammar[field], `${tp}.${field}`);
            const known = grammar.forms[t.lemma];
            if (
              !known ||
              known.part_of_speech !== c.part_of_speech ||
              fields.some((k) => known[k] !== t.grammar[k])
            )
              add(tp, 'French non-noun grammar baseline mismatch');
          }
        } else if (shape(t.grammar, ['gender', 'number', 'article', 'onset'], `${tp}.grammar`)) {
          const g = t.grammar;
          if (
            !['m', 'f'].includes(g.gender) ||
            !['singular', 'plural'].includes(g.number) ||
            !['vowel', 'consonant', 'mute_h', 'aspirated_h'].includes(g.onset)
          )
            add(tp, 'invalid French grammar');
          const expected =
            g.number === 'plural'
              ? 'les'
              : ['vowel', 'mute_h'].includes(g.onset)
                ? 'l’'
                : g.gender === 'f'
                  ? 'la'
                  : 'le';
          if (
            g.article !== expected ||
            t.display !== expected + (expected === 'l’' ? '' : ' ') + t.lemma
          )
            add(tp, 'French article/display agreement error');
          const known = grammar.forms[t.lemma];
          if (!known) add(tp, 'French lemma missing from independent grammar baseline');
          else if (
            (diverse && known.part_of_speech !== 'noun') ||
            ['gender', 'number', 'onset'].some((k) => g[k] !== known[k])
          )
            add(tp, 'French lexical gender/number/onset mismatch');
        }
      }
    if (
      shape(
        c.editorial,
        ['status', 'reviewer', 'reviewed_at', 'concerns', 'translation_evidence', 'cefr_evidence'],
        `${p}.editorial`,
      )
    ) {
      const e = c.editorial;
      const concerns = texts(e.concerns, `${p}.concerns`);
      concerns.forEach((concern) => warnings.push(`${c.concept_key}: ${concern}`));
      const evidence = texts(e.translation_evidence, `${p}.translation_evidence`);
      if (shape(e.cefr_evidence, ['en', 'fr'], `${p}.cefr_evidence`))
        for (const l of ['en', 'fr']) texts(e.cefr_evidence[l], `${p}.cefr_evidence.${l}`);
      if (!['draft', 'approved'].includes(e.status)) add(p, 'invalid editorial status');
      if (e.status === 'approved') {
        approved++;
        if (
          !text(e.reviewer) ||
          !text(e.reviewed_at) ||
          !/^\d{4}-\d{2}-\d{2}$/.test(e.reviewed_at) ||
          !Number.isFinite(Date.parse(e.reviewed_at)) ||
          !evidence.length ||
          !['en', 'fr'].every(
            (l) =>
              Array.isArray(e.cefr_evidence?.[l]) &&
              e.cefr_evidence[l].length &&
              LEVELS.includes(c.terms?.[l]?.cefr),
          ) ||
          concerns.length ||
          c.photography?.availability !== 'everyday'
        )
          add(
            p,
            'approval requires resolved concerns, reviewer/date and translation/CEFR evidence',
          );
      } else {
        if (e.reviewer !== null || e.reviewed_at !== null)
          add(p, 'draft must not claim completed independent review');
        blockers.push(`${c.concept_key}: independent bilingual review pending`);
      }
    }
  }
  if (diverse) {
    for (const category of DIVERSE_CATEGORIES)
      if (!manifest.concepts.some((c) => c?.category === category))
        add('concepts', `missing category ${category}`);
  }
  for (const l of ['en', 'fr'])
    for (const level of LEVELS)
      if (!coverage[l][level])
        blockers.push(`${l}/${level}: no assigned coverage (review bands do not count)`);
  if (manifest.status === 'approved' && (approved !== manifest.concepts.length || blockers.length))
    add('status', 'dataset cannot be approved with unresolved entries/coverage');
  if (manifest.status !== 'approved') blockers.push('Dataset is a draft, not an import approval.');
  return { errors, warnings, blockers, coverage, unresolved, approved };
}
