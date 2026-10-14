import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { validateManifest, seedConcepts } from '../lib/vocabulary-manifest.mjs';
import { loadPilot, renderReview } from '../validate-vocabulary.mjs';
// Preserve regression coverage for the archived v1 contract as well as current v2.
const { manifest, options } = loadPilot('0.1.0');
const current = loadPilot();
const changed = (mutate) => {
  const m = structuredClone(manifest);
  mutate(m);
  return validateManifest(m, options);
};
const invalid = (mutate) => assert.ok(changed(mutate).errors.length > 0);

test('60 original proposals, 120 terms; seed excluded; no false Production approval', () => {
  const result = validateManifest(manifest, options);
  assert.deepEqual(result.errors, []);
  assert.equal(manifest.concepts.length, 60);
  assert.equal(seedConcepts(options.seedSql, options.baseline).length, 36);
  assert.equal(result.approved, 0);
  assert.ok(result.blockers.length > 0);
  assert.deepEqual(result.unresolved, { en: 12, fr: 12 });
  for (const l of ['en', 'fr']) {
    assert.equal(result.coverage[l].C1, 0);
    assert.equal(result.coverage[l].C2, 0);
  }
  assert.ok(manifest.concepts.some((c) => c.terms.en.cefr !== c.terms.fr.cefr));
});

test('rejects malformed, incomplete, unknown or unversioned structures', () => {
  for (const mutate of [
    (m) => {
      m.schema_version = 3;
    },
    (m) => {
      m.concepts.pop();
    },
    (m) => {
      delete m.concepts[0].terms.fr;
    },
    (m) => {
      m.concepts[0].extra = true;
    },
    (m) => {
      m.concepts[0].photography = null;
    },
    (m) => {
      m.concepts[0].terms.en.cefr = 'D1';
    },
    (m) => {
      m.concepts[0].terms.fr.aliases = null;
    },
    (m) => {
      m.concepts[0].definition = ' ';
    },
    (m) => {
      m.languages = ['en'];
    },
  ])
    invalid(mutate);
  assert.ok(validateManifest(null, options).errors.length);
});

test('duplicate keys, definitions, primary words and aliases fail within pilot', () => {
  invalid((m) => {
    m.concepts[1].concept_key = m.concepts[0].concept_key;
  });
  invalid((m) => {
    m.concepts[1].definition = m.concepts[0].definition;
  });
  invalid((m) => {
    m.concepts[1].terms.en.aliases = ['TABLE'];
  });
  invalid((m) => {
    m.concepts[1].terms.fr.aliases = ['table'];
  });
  invalid((m) => {
    m.concepts[0].terms.en.aliases = ['table'];
  });
});

test('seed collisions rejected despite key renames, article/diacritic variants and synonyms', () => {
  invalid((m) => {
    m.concepts[0].concept_key = 'DOG';
  });
  invalid((m) => {
    m.concepts[0].concept_key = 'NEW_CYCLE';
    m.concepts[0].terms.en.lemma = 'bike';
    m.concepts[0].terms.en.display = 'bike';
  });
  invalid((m) => {
    m.concepts[0].terms.fr.aliases = ['La Fenetre'];
  });
  invalid((m) => {
    m.concepts[0].terms.en.aliases = ['riverbank'];
  });
  invalid((m) => {
    m.concepts[0].terms.fr.aliases = ['bicyclette'];
  });
});

test('known plural seed variants cannot create new concepts', () => {
  invalid((m) => {
    m.concepts[0].terms.en.aliases = ['dogs'];
  });
  invalid((m) => {
    m.concepts[0].terms.fr.aliases = ['les vélos'];
  });
});

test('changed seed or incomplete alias baseline fails closed', () => {
  assert.throws(
    () => validateManifest(manifest, { ...options, seedSql: options.seedSql + '\n' }),
    /Seed baseline changed/,
  );
  const baseline = structuredClone(options.baseline);
  baseline.concepts.pop();
  assert.throws(() => validateManifest(manifest, { ...options, baseline }), /Incomplete/);
});

test('French grammar checks elision, lexical gender, plural and full display agreement', () => {
  const index = (key) => manifest.concepts.findIndex((c) => c.concept_key === key);
  invalid((m) => {
    m.concepts[index('EGG')].terms.fr.display = 'le œuf';
  });
  invalid((m) => {
    m.concepts[index('CLOCK')].terms.fr.grammar.onset = 'aspirated_h';
  });
  invalid((m) => {
    const t = m.concepts[index('HAMMER')].terms.fr;
    t.grammar.gender = 'f';
    t.grammar.article = 'la';
    t.display = 'la marteau';
  });
  invalid((m) => {
    const t = m.concepts[index('SCISSORS')].terms.fr;
    t.grammar.number = 'singular';
    t.grammar.article = 'le';
    t.display = 'le ciseaux';
  });
  invalid((m) => {
    m.concepts[index('FRYING_PAN')].terms.fr.grammar.gender = 'm';
  });
});

test('curated regression examples preserve translation senses and grammar (not full accuracy proof)', () => {
  const expected = {
    FRYING_PAN: ['frying pan', 'la poêle', 'f'],
    TOWEL: ['towel', 'la serviette de toilette', 'f'],
    POTATO: ['potato', 'la pomme de terre', 'f'],
    EGG: ['egg', 'l’œuf', 'm'],
    SCISSORS: ['scissors', 'les ciseaux', 'm'],
    PLIERS: ['pliers', 'la pince universelle', 'f'],
  };
  for (const [key, values] of Object.entries(expected)) {
    const c = manifest.concepts.find((c) => c.concept_key === key);
    assert.deepEqual([c.terms.en.display, c.terms.fr.display, c.terms.fr.grammar.gender], values);
  }
});

test('non-photographable and undocumented senses cannot pass validation', () => {
  invalid((m) => {
    m.concepts[0].photography.photographable = false;
  });
  invalid((m) => {
    m.concepts[0].photography.guidance = '';
  });
  invalid((m) => {
    m.concepts[0].part_of_speech = 'adjective';
  });
  invalid((m) => {
    m.concepts[0].category = 'abstract';
  });
});

test('review bands never count as advanced coverage; fake approval rejected', () => {
  const result = validateManifest(manifest, options);
  assert.ok(result.blockers.some((b) => b.includes('fr/C2')));
  invalid((m) => {
    m.status = 'approved';
  });
  invalid((m) => {
    m.concepts[0].editorial.status = 'approved';
  });
  invalid((m) => {
    m.concepts[0].editorial.reviewer = 'unearned review';
  });
  const changedResult = changed((m) => {
    m.concepts[0].terms.en.cefr = 'B2';
  });
  assert.equal(changedResult.coverage.en.B2, result.coverage.en.B2 + 1);
  assert.equal(changedResult.coverage.fr.A1, result.coverage.fr.A1);
});

test('current review is deterministic, contains all 60 rows and matches the document', async () => {
  const { format } = await import('prettier');
  const result = validateManifest(current.manifest, current.options);
  const report = await format(renderReview(current.manifest, result), {
    parser: 'markdown',
    proseWrap: 'preserve',
    printWidth: 95,
  });
  assert.equal(
    report,
    readFileSync(new URL('../../docs/VOCABULARY_PILOT_REVIEW.md', import.meta.url), 'utf8'),
  );
  assert.equal(report.split('\n').filter((line) => /^\| \d+ +\|/.test(line)).length, 60);
  for (const c of current.manifest.concepts) {
    assert.ok(report.includes(c.concept_key));
    assert.ok(report.includes(c.photography.alternative));
    assert.ok(report.includes(c.terms.en.cefr_rationale));
    assert.ok(report.includes(c.terms.fr.cefr_rationale));
  }
  assert.match(report, /No C1\/C2 terms are claimed/);
  assert.match(report, /CROWDED already exists in the seed/);
  assert.match(report, /Recommendation requiring approval/);
});

const changedCurrent = (mutate) => {
  const m = structuredClone(current.manifest);
  mutate(m);
  return validateManifest(m, current.options);
};
const invalidCurrent = (mutate) => assert.ok(changedCurrent(mutate).errors.length > 0);
const entry = (m, key) => m.concepts.find((c) => c.concept_key === key);

test('v2 contains 60 diverse meanings, eight preserved identities and no manufactured advanced coverage', () => {
  const m = current.manifest,
    r = validateManifest(m, current.options);
  assert.deepEqual(r.errors, []);
  assert.equal(m.schema_version, 2);
  assert.equal(m.concepts.length, 60);
  assert.equal(new Set(m.concepts.map((c) => c.category)).size, 9);
  assert.deepEqual(
    new Set(m.concepts.map((c) => c.part_of_speech)),
    new Set(['noun', 'verb', 'adjective']),
  );
  assert.equal(
    m.concepts.filter((c) => manifest.concepts.some((p) => p.concept_key === c.concept_key)).length,
    8,
  );
  for (const c of m.concepts) {
    assert.equal(c.editorial.status, 'draft');
    assert.equal(c.editorial.reviewer, null);
    assert.equal(c.photography.availability, 'review_required');
    assert.notEqual(c.terms.en.cefr_rationale, c.terms.fr.cefr_rationale);
    assert.equal(c.terms.en.cefr_review_band, null);
    assert.equal(c.terms.fr.cefr_review_band, null);
  }
  assert.equal(r.approved, 0);
  assert.deepEqual(r.unresolved, { en: 0, fr: 0 });
  for (const l of ['en', 'fr']) {
    assert.equal(r.coverage[l].C1, 0);
    assert.equal(r.coverage[l].C2, 0);
  }
  assert.equal(r.coverage.fr.B2, 0);
  assert.ok(m.concepts.some((c) => c.terms.en.cefr !== c.terms.fr.cefr));
  for (const c of manifest.concepts.filter((c) => c.terms.en.cefr === null))
    assert.ok(!m.concepts.some((n) => n.concept_key === c.concept_key));
});

test('v2 checks verb, inflected adjective, invariable phrase and noun grammar separately', () => {
  assert.equal(entry(current.manifest, 'WASH_HANDS').terms.fr.display, 'se laver les mains');
  assert.equal(entry(current.manifest, 'MESSY').terms.fr.display, 'en désordre');
  assert.equal(entry(current.manifest, 'COLOURFUL').terms.en.display, 'colourful');
  invalidCurrent((m) => {
    entry(m, 'RUN').terms.fr.display = 'le courir';
  });
  invalidCurrent((m) => {
    entry(m, 'RUN').terms.fr.grammar.form = 'masculine_singular';
  });
  invalidCurrent((m) => {
    entry(m, 'WET').terms.fr.grammar.feminine = 'mouillé';
  });
  invalidCurrent((m) => {
    entry(m, 'WET').terms.fr.grammar = { form: 'invariable' };
  });
  invalidCurrent((m) => {
    entry(m, 'MESSY').terms.fr.grammar.feminine = 'en désordrée';
  });
  invalidCurrent((m) => {
    entry(m, 'PILLOW').terms.fr.display = 'le oreiller';
  });
  invalidCurrent((m) => {
    entry(m, 'RUN').part_of_speech = 'adverb';
  });
});

test('v2 requires interpretation/accessibility metadata without asserting mental states as facts', () => {
  for (const c of current.manifest.concepts.filter((c) =>
    ['emotions_expressions', 'abstract_scenes'].includes(c.category),
  ))
    assert.equal(c.photography.mode, 'interpretive');
  assert.equal(entry(current.manifest, 'BUTTERFLY').photography.mode, 'literal');
  assert.equal(entry(current.manifest, 'BUTTERFLY').photography.alternative_mode, 'interpretive');
  invalidCurrent((m) => {
    entry(m, 'HAPPINESS').photography.mode = 'literal';
  });
  invalidCurrent((m) => {
    entry(m, 'LONELINESS').photography.alternative = '';
  });
  invalidCurrent((m) => {
    entry(m, 'RUN').photography.accessibility = '';
  });
  invalidCurrent((m) => {
    entry(m, 'RUN').photography.alternative_mode = 'automatic';
  });
  invalidCurrent((m) => {
    delete entry(m, 'RUN').photography.difficulty;
  });
  invalidCurrent((m) => {
    entry(m, 'RUN').photography.photographable = false;
  });
});

test('v2 preserves draft, category, schema and duplicate/seed gates', () => {
  invalidCurrent((m) => {
    m.concepts[0] = null;
  });
  invalidCurrent((m) => {
    m.schema_version = 3;
  });
  invalidCurrent((m) => {
    m.concepts.pop();
  });
  invalidCurrent((m) => {
    for (const c of m.concepts) c.category = 'everyday_objects';
  });
  invalidCurrent((m) => {
    m.status = 'approved';
  });
  invalidCurrent((m) => {
    m.concepts[0].editorial.status = 'approved';
  });
  invalidCurrent((m) => {
    m.concepts[0].terms.en.aliases = ['crowded'];
  });
  invalidCurrent((m) => {
    m.concepts[0].terms.en.aliases = ['packed'];
  });
  invalidCurrent((m) => {
    m.concepts[0].terms.fr.aliases = ['plein de monde'];
  });
  invalidCurrent((m) => {
    m.concepts[0].terms.en.aliases = ['happiness'];
  });
  invalidCurrent((m) => {
    m.concepts[0].definition = m.concepts[1].definition;
  });
  assert.throws(() => renderReview(current.manifest, { errors: ['bad'] }), /valid v2/);
  assert.throws(() => loadPilot('0.3.0'), /Unsupported/);
});

test('CLI draft succeeds, release gate rejects unsupported coverage and approval, unknown flags fail', () => {
  execFileSync(process.execPath, ['scripts/validate-vocabulary.mjs', '--check-review'], {
    stdio: 'pipe',
  });
  const blocked = spawnSync(process.execPath, ['scripts/validate-vocabulary.mjs', '--release'], {
    encoding: 'utf8',
  });
  assert.equal(blocked.status, 1);
  assert.match(blocked.stdout, /no assigned coverage/);
  assert.match(blocked.stdout, /independent bilingual review pending/);
  assert.equal(
    spawnSync(process.execPath, ['scripts/validate-vocabulary.mjs', '--import'], { stdio: 'pipe' })
      .status,
    1,
  );
});
