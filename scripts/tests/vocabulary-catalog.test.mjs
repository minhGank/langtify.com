import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { loadPilot, jsonFile } from '../validate-vocabulary.mjs';
import {
  buildCatalogPlan,
  catalogImportSql,
  validateSnapshot,
  validateEditorialReview,
  combinedCoverage,
  reviewHash,
  stateSql,
} from '../lib/vocabulary-catalog.mjs';
import { fixture, reconcile } from './helpers/vocabulary-catalog.mjs';
const projectRef = 'ssuyyrfncvyqsgkirvpq';
const id = (n) => `81000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function applied(input, plan) {
  const s = structuredClone(input.snapshot);
  for (const [i, c] of plan.inserts.concepts.entries()) s.concepts.push({ ...c, id: id(i + 1) });
  for (const [i, t] of plan.inserts.terms.entries()) {
    const { concept_key, ...row } = t;
    s.terms.push({
      ...row,
      id: id(100 + i),
      concept_id: s.concepts.find((c) => c.concept_key === concept_key).id,
    });
  }
  for (const g of plan.inserts.guidance) {
    const { concept_key, ...row } = g;
    s.guidance.push({
      ...row,
      concept_id: s.concepts.find((c) => c.concept_key === concept_key).id,
    });
  }
  return { ...input, snapshot: s };
}
test('actual draft never produces executable SQL; identities alone are insufficient', () => {
  const i = fixture();
  Object.assign(i, loadPilot());
  i.guidance = jsonFile('data/vocabulary/photo-guidance.v0.2.0.json');
  i.editorialReview = jsonFile('data/vocabulary/editorial-review.v0.2.0.json');
  const p = buildCatalogPlan(reconcile(i));
  assert.ok(p.blockers.length > 120);
  assert.throws(() => catalogImportSql(p, p.plan_sha256), /blocked/);
});
test('explicit inactive staging accepts the unchanged draft and retains every release blocker', () => {
  const i = fixture();
  Object.assign(i, loadPilot());
  i.guidance = jsonFile('data/vocabulary/photo-guidance.v0.2.0.json');
  i.editorialReview = jsonFile('data/vocabulary/editorial-review.v0.2.0.json');
  const strict = buildCatalogPlan(reconcile(i));
  const staged = buildCatalogPlan(reconcile({ ...i, mode: 'inactive-staging' }));
  assert.deepEqual(staged.release_blockers, strict.release_blockers);
  assert.ok(staged.release_blockers.length > 120);
  assert.deepEqual(staged.blockers, []);
  assert.deepEqual(staged.conflicts, []);
  assert.match(catalogImportSql(staged, staged.plan_sha256), /true,false/);
  assert.ok(staged.inserts.terms.every((r) => r.is_active === false));
  assert.equal(i.manifest.status, 'draft');
  assert.throws(() => buildCatalogPlan({ ...i, mode: 'activate' }), /Unknown/);
});
test('staging cannot enrich active pilot identities or bypass conflicts, structure or prerequisites', () => {
  const i = fixture();
  const after = applied(i, buildCatalogPlan(reconcile(i)));
  after.mode = 'inactive-staging';
  for (const mutate of [
    (s) => {
      s.concepts[0].is_active = true;
    },
    (s) => {
      s.terms[0].is_active = true;
    },
    (s) => {
      s.terms[0].term = 'Conflicting term';
    },
  ]) {
    const changed = structuredClone(after);
    mutate(changed.snapshot);
    const p = buildCatalogPlan(reconcile(changed));
    assert.ok(p.conflicts.length);
    assert.throws(() => catalogImportSql(p, p.plan_sha256), /blocked/);
  }
  after.snapshot.guidance_available = false;
  after.snapshot.guidance = [];
  const blocked = buildCatalogPlan(reconcile(after));
  assert.throws(() => catalogImportSql(blocked, blocked.plan_sha256), /blocked/);
  i.manifest.concepts[0].definition = 'Changed approved meaning';
  assert.throws(() => buildCatalogPlan({ ...i, mode: 'inactive-staging' }));
});
test('review provenance covers all entries and invalidates changed copy/levels', () => {
  const { manifest } = loadPilot(),
    guidance = jsonFile('data/vocabulary/photo-guidance.v0.2.0.json'),
    review = jsonFile('data/vocabulary/editorial-review.v0.2.0.json');
  assert.deepEqual(validateEditorialReview(manifest, guidance, review), []);
  guidance.concepts[0].locales.fr.primary_idea += ' Modified';
  assert.ok(validateEditorialReview(manifest, guidance, review).length);
  review.independent_human_approval = true;
  assert.ok(validateEditorialReview(manifest, guidance, review).length);
});
test('atomic insert-only inactive plan, scoped hash, escaping, and exact replay', () => {
  const i = fixture(),
    p = buildCatalogPlan(reconcile(i));
  assert.deepEqual(p.blockers, []);
  assert.deepEqual(p.conflicts, []);
  assert.deepEqual(Object.fromEntries(Object.entries(p.inserts).map(([k, v]) => [k, v.length])), {
    concepts: 60,
    terms: 120,
    guidance: 120,
  });
  const sql = catalogImportSql(p, p.plan_sha256);
  assert.match(sql, /share row exclusive mode/);
  assert.match(sql, /catalog_snapshot_drift/);
  assert.match(sql, /commit;/);
  assert.doesNotMatch(sql, /\b(update|delete|truncate)\s+(?:from\s+)?public\./i);
  assert.ok(p.inserts.terms.every((t) => t.is_active === false));
  assert.throws(() => catalogImportSql(p, 'wrong'), /integrity/);
  p.inserts.concepts[0].category = 'altered';
  assert.throws(() => catalogImportSql(p, p.plan_sha256), /integrity/);
  const valid = buildCatalogPlan(reconcile(i));
  const after = applied(i, valid);
  const repeated = buildCatalogPlan(reconcile(after));
  assert.deepEqual(repeated.conflicts, []);
  assert.ok(Object.values(repeated.inserts).every((v) => v.length === 0));
  assert.equal(after.snapshot.concepts[0].id, id(1));
});
test('changed existing terms, guidance, categories and cross-key aliases conflict, never overwrite', () => {
  const i = fixture(),
    base = applied(i, buildCatalogPlan(reconcile(i)));
  for (const mutate of [
    (s) => {
      s.terms[0].term = 'Different';
    },
    (s) => {
      s.terms[0].cefr_level = 'C2';
    },
    (s) => {
      s.concepts[0].category = 'different';
    },
    (s) => {
      s.guidance[0].primary_idea = 'Different';
    },
    (s) => {
      s.concepts[0].concept_key = 'OTHER_BED';
    },
  ]) {
    const input = structuredClone(base);
    mutate(input.snapshot);
    const p = buildCatalogPlan(reconcile(input));
    assert.ok(p.conflicts.length);
    assert.throws(() => catalogImportSql(p, p.plan_sha256), /blocked/);
  }
});
test('missing language/migration/locale/reconciliation and stale semantic UUID fail closed', () => {
  for (const mutate of [
    (i) => {
      i.snapshot.languages[0].is_active = false;
    },
    (i) => {
      i.snapshot.migrations = [];
    },
    (i) => {
      i.snapshot.guidance_available = false;
    },
    (i) => {
      delete i.guidance.concepts[0].locales.fr;
      i.editorialReview.concepts[0].content_sha256 = reviewHash(
        i.manifest.concepts[0],
        i.guidance.concepts[0],
      );
    },
  ]) {
    const i = fixture();
    mutate(i);
    assert.ok(buildCatalogPlan(reconcile(i)).blockers.length);
  }
  const i = fixture();
  assert.ok(buildCatalogPlan(i).blockers.some((b) => b.includes('reconciliation')));
  const r = reconcile(i);
  r.reconciliation.concepts[0].existing_id = id(999);
  assert.ok(buildCatalogPlan(r).conflicts.length);
});
test('snapshot rejects other projects, duplicates, orphan terms and unexpected private fields', () => {
  const i = fixture();
  assert.throws(() => validateSnapshot(i.snapshot, 'lfdgjewypbhukjrtwsef'), /target/);
  for (const mutate of [
    (s) => s.languages.push(s.languages[0]),
    (s) => {
      s.languages[0].secret = 'not-allowed';
    },
    (s) => {
      s.terms.push({
        id: id(100),
        concept_id: id(1),
        language_id: s.languages[0].id,
        term: 'bed',
        cefr_level: 'A1',
        part_of_speech: 'noun',
        is_active: true,
      });
    },
  ]) {
    const s = structuredClone(i.snapshot);
    mutate(s);
    assert.throws(() => validateSnapshot(s, projectRef));
  }
});
test('combined coverage counts distinct active bilingual identities and never promotes fixtures', () => {
  const i = fixture(),
    after = applied(i, buildCatalogPlan(reconcile(i)));
  const c = combinedCoverage(i.manifest, after.snapshot);
  assert.equal(
    c.combined.provisional.en.A1.fullCompletionDays,
    0,
    'inactive existing pilot is not silently activated',
  );
  after.snapshot.concepts.forEach((c) => (c.is_active = true));
  after.snapshot.terms.forEach((t) => (t.is_active = true));
  const d = combinedCoverage(i.manifest, after.snapshot);
  assert.ok(d.combined.provisional.en.A1.fullCompletionDays > 0);
  assert.equal(d.combined.reviewed.en.A1.fullCompletionDays, 0);
});
test('CLI has no apply, activation or arbitrary target escape hatch', () => {
  for (const args of [
    ['--apply'],
    ['--activate'],
    ['--snapshot', 'x', '--project-ref', 'old-project'],
  ]) {
    const r = spawnSync(process.execPath, ['scripts/import-vocabulary-catalog.mjs', ...args], {
      encoding: 'utf8',
    });
    assert.equal(r.status, 1);
  }
});

test('snapshot SQL supports a pre-guidance schema without reading a missing table', () => {
  assert.match(stateSql(), /public.vocabulary_photo_guidance/);
  assert.doesNotMatch(stateSql({ includeGuidance: false }), /public.vocabulary_photo_guidance/);
  assert.match(stateSql({ includeGuidance: false }), /'guidance','\[\]'::jsonb/);
});

test('scoped migration artifacts track history atomically and exclude unrelated Production changes', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const { prepareMigrations, prepareLanguages } = await import('../lib/vocabulary-deployment.mjs');
  const sources = readdirSync('supabase/migrations')
    .filter((n) => n.endsWith('.sql'))
    .map((n) => ({
      version: n.split('_')[0],
      name: n.slice(15, -4),
      sql: readFileSync('supabase/migrations/' + n, 'utf8'),
    }));
  const s = fixture().snapshot;
  s.project_ref = 'lfdgjewypbhukjrtwsef';
  s.migrations = sources
    .filter((r) => r.version <= '20261005010000' && r.version !== '20261003000000')
    .map((r) => r.version);
  s.guidance_available = false;
  const plan = prepareMigrations(s, sources);
  assert.deepEqual(
    plan.map((p) => p.version),
    ['20261013000000', '20261020000000'],
  );
  for (const p of plan) {
    assert.match(p.sql, /migration_history_drift/);
    assert.match(p.sql, /insert into supabase_migrations.schema_migrations/);
    assert.match(p.sql, /lock table supabase_migrations/);
    assert.ok(p.expected_after.includes(p.version));
  }
  s.migrations.push('99999999999999');
  assert.throws(() => prepareMigrations(s, sources), /baseline/);
  s.languages = [];
  const sql = prepareLanguages(s);
  assert.match(sql, /language_catalog_drift/);
  assert.match(sql, /Français/);
  assert.doesNotMatch(sql, /on conflict|\bupdate\b|\bdelete\b|vocabulary_concepts/i);
  s.languages = [{ id: id(999), code: 'en', is_active: false }];
  assert.throws(() => prepareLanguages(s), /inactive/);
});
