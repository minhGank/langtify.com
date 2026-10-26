import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPilot, jsonFile } from '../validate-vocabulary.mjs';
import { digest } from '../lib/vocabulary-catalog.mjs';
import { validateMeaningApproval } from '../lib/vocabulary-guidance.mjs';

test('limited-pilot owner approval binds exact content without inventing certification', () => {
  const { manifest } = loadPilot();
  const guidance = jsonFile('data/vocabulary/photo-guidance.v0.2.0.json');
  const owner = jsonFile('data/vocabulary/owner-approval.v0.2.0.json');
  const meanings = jsonFile('data/vocabulary/meaning-approval.v0.2.0.json');
  validateMeaningApproval(manifest, meanings);
  assert.equal(owner.approval_kind, 'product_owner_limited_pilot');
  assert.equal(owner.approved_content_sha256, digest({ manifest, guidance }));
  assert.equal(owner.meaning_approval_sha256, digest(meanings));
  assert.equal(owner.independent_linguistic_certification, false);
  assert.equal(owner.independent_accessibility_certification, false);
  assert.equal(owner.remaining_cefr_status, 'provisional_owner_accepted');
  assert.equal(manifest.concepts.find((c) => c.concept_key === 'LONELINESS').terms.en.cefr, 'C1');
  assert.deepEqual(owner.concept_keys, manifest.concepts.map((c) => c.concept_key).sort());
  assert.ok(manifest.concepts.every((c) => c.editorial.reviewer === null));
  assert.ok(
    guidance.concepts.every((c) =>
      Object.values(c.locales).every((g) => g.review.reviewer === null),
    ),
  );
  for (const env of ['dev', 'prod'])
    assert.equal(
      owner.staging_receipts[env],
      digest(jsonFile(`data/vocabulary/staging-receipts/2026-10-26.${env}.json`)),
    );
});
