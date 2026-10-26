import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  validateMeaningApproval,
  validateGuidance,
  buildGuidancePlan,
  guidanceUpsertSql,
} from '../lib/vocabulary-guidance.mjs';
import { localImportSql } from '../import-vocabulary-guidance.mjs';
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const manifest = read('data/vocabulary/pilot.v0.2.0.json');
const approval = read('data/vocabulary/meaning-approval.v0.2.0.json');
const guidance = read('data/vocabulary/photo-guidance.v0.2.0.json');
const catalog = manifest.concepts.map((c, i) => ({
  concept_key: c.concept_key,
  id: `78000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
}));
const plan = (copy = guidance, cat = catalog, allowDraftLocal = true) =>
  buildGuidancePlan(manifest, approval, copy, cat, { allowDraftLocal });
test('records exactly 60 identity/meaning approvals without promoting translation/CEFR review', () => {
  assert.equal(validateMeaningApproval(manifest, approval), 60);
  assert.equal(validateGuidance(manifest, guidance).length, 0);
  assert.ok(manifest.concepts.every((c) => c.editorial.status === 'draft'));
  const changed = structuredClone(manifest);
  changed.concepts[0].definition += ' Changed meaning.';
  assert.throws(() => validateMeaningApproval(changed, approval), /stale/);
  const translated = structuredClone(manifest);
  translated.concepts[0].terms.fr.display = 'une autre traduction';
  assert.equal(validateMeaningApproval(translated, approval), 60);
  const duplicate = structuredClone(approval);
  duplicate.concepts[1] = duplicate.concepts[0];
  assert.throws(() => validateMeaningApproval(manifest, duplicate), /stale/);
});
test('rejects unsafe incomplete guidance, unknown locales, mismatched modes and copy drift', () => {
  for (const mutate of [
    (g) => {
      g.concepts[0].locales.en.safety_guidance = '';
    },
    (g) => {
      g.concepts[0].locales.en.primary_idea = 'a'.repeat(2001);
    },
    (g) => {
      g.concepts[0].locales.en.alternative_mode = null;
    },
    (g) => {
      g.concepts[0].locales.es = g.concepts[0].locales.en;
    },
    (g) => {
      g.concepts[0].locales.en.primary_idea = 'Other meaning.';
    },
    (g) => {
      g.concepts[0].locales.en.review = { status: 'approved', reviewer: null, reviewed_at: null };
    },
    (g) => {
      g.concepts[1] = g.concepts[0];
    },
  ]) {
    const g = structuredClone(guidance);
    mutate(g);
    assert.ok(validateGuidance(manifest, g).length);
  }
});
test('supports a complete independently reviewed French locale', () => {
  const g = structuredClone(guidance);
  const en = g.concepts[0].locales.en;
  g.concepts[0].locales.fr = {
    ...en,
    primary_idea: 'Cadrez cet objet.',
    alternative_idea: 'Utilisez une maquette.',
    accessibility_guidance: 'Vous pouvez rester assis.',
    safety_guidance: 'Respectez la vie privée.',
    review: { status: 'approved', reviewer: 'Fixture reviewer', reviewed_at: '2026-10-13' },
  };
  assert.deepEqual(validateGuidance(manifest, g), []);
  assert.equal(plan(g).rows.length, 120);
  g.concepts[0].locales.fr.representation_mode =
    en.representation_mode === 'literal' ? 'interpretive' : 'literal';
  assert.ok(validateGuidance(manifest, g).length);
});
test('default planning blocks unreviewed copy and never silently creates missing identities', () => {
  assert.equal(plan(guidance, catalog, false).blockers.length, 120);
  assert.throws(() => guidanceUpsertSql(plan(guidance, catalog, false)), /blocked/);
  assert.equal(plan(guidance, []).blockers.length, 60);
  assert.equal(plan(guidance, []).rows.length, 0);
  assert.throws(() => plan(guidance, [catalog[0], catalog[0]]), /identities/);
});
test('preserves target catalog UUIDs and writes only guidance with idempotent upserts', () => {
  const p = plan();
  assert.deepEqual(p.blockers, []);
  assert.equal(p.rows.length, 120);
  for (const row of p.rows)
    assert.equal(row.concept_id, catalog.find((c) => c.concept_key === row.concept_key).id);
  const sql = localImportSql(p);
  assert.match(sql, /lock table public.vocabulary_concepts in share mode/);
  assert.match(sql, /catalog_identity_drift/);
  assert.match(sql, /on conflict\(concept_id,locale\) do update/);
  assert.match(sql, /is distinct from/);
  assert.equal((sql.match(/insert into public.vocabulary_photo_guidance/g) || []).length, 120);
  assert.doesNotMatch(sql, /(insert into|update|delete from) public.vocabulary_(concepts|terms)/);
});
test('CLI refuses hosted or unknown targeting options before database access', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/import-vocabulary-guidance.mjs', '--project-ref', 'lfdgjewypbhukjrtwsef'],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Local guidance import failed/);
});
