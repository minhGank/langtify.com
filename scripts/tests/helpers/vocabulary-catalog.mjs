// Synthetic approval data for disposable local tests only.
import { loadPilot, jsonFile } from '../../validate-vocabulary.mjs';
import { digest, reviewHash } from '../../lib/vocabulary-catalog.mjs';
import { meaningHash } from '../../lib/vocabulary-guidance.mjs';
const projectRef = 'ssuyyrfncvyqsgkirvpq';
export function fixture() {
  const { manifest, options } = loadPilot();
  const guidance = jsonFile('data/vocabulary/photo-guidance.v0.2.0.json');
  // Synthetic approval/coverage only inside tests; real checked-in pilot is never promoted.
  manifest.status = 'approved';
  manifest.concepts.forEach((c, i) => {
    if (i < 3) c.terms.fr.cefr = 'B2';
    c.editorial = {
      status: 'approved',
      reviewer: 'Synthetic test reviewer',
      reviewed_at: '2026-10-21',
      concerns: [],
      translation_evidence: ['Synthetic fixture'],
      cefr_evidence: { en: ['Synthetic fixture'], fr: ['Synthetic fixture'] },
    };
    c.photography.availability = 'everyday';
  });
  for (const c of guidance.concepts)
    for (const value of Object.values(c.locales))
      value.review = {
        status: 'approved',
        reviewer: 'Synthetic fixture',
        reviewed_at: '2026-10-21',
      };
  const snapshot = {
    project_ref: projectRef,
    read_only: 'on',
    captured_at: '2026-10-21T12:00:00Z',
    migrations: ['20261013000000', '20261020000000'],
    guidance_available: true,
    languages: [
      { id: '00000000-0000-4000-8000-000000000001', code: 'en', is_active: true },
      { id: '00000000-0000-4000-8000-000000000002', code: 'fr', is_active: true },
    ],
    concepts: [],
    terms: [],
    guidance: [],
  };
  const editorialReview = jsonFile('data/vocabulary/editorial-review.v0.2.0.json');
  for (const row of editorialReview.concepts)
    row.content_sha256 = reviewHash(
      manifest.concepts.find((c) => c.concept_key === row.concept_key),
      guidance.concepts.find((c) => c.concept_key === row.concept_key),
    );
  return {
    editorialReview,
    manifest,
    options,
    guidance,
    snapshot,
    projectRef,
    approval: jsonFile('data/vocabulary/meaning-approval.v0.2.0.json'),
  };
}
export function reconcile(input) {
  return {
    ...input,
    reconciliation: {
      project_ref: input.projectRef,
      snapshot_sha256: digest(input.snapshot),
      reviewer: 'Synthetic fixture',
      reviewed_at: '2026-10-21',
      concepts: input.manifest.concepts.map((c) => ({
        concept_key: c.concept_key,
        meaning_sha256: meaningHash(c),
        existing_id:
          input.snapshot.concepts.find((r) => r.concept_key === c.concept_key)?.id ?? null,
      })),
    },
  };
}
