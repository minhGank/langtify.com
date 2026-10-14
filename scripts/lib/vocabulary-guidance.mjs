import { createHash } from 'node:crypto';
export const meaningHash = (c) =>
  createHash('sha256')
    .update(JSON.stringify([c.concept_key, c.definition]))
    .digest('hex');
export function validateMeaningApproval(manifest, approval) {
  if (
    approval?.schema_version !== 1 ||
    approval.scope !== 'concept_identity_and_meaning' ||
    approval.manifest_version !== manifest.version ||
    approval.approved_by !== 'project_owner' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(approval.approved_at) ||
    !Array.isArray(approval.concepts) ||
    approval.concepts.length !== manifest.concepts.length ||
    new Set(approval.concepts.map((c) => c.concept_key)).size !== manifest.concepts.length ||
    manifest.concepts.some(
      (c) =>
        !approval.concepts.some(
          (a) => a.concept_key === c.concept_key && a.meaning_sha256 === meaningHash(c),
        ),
    )
  )
    throw new Error('Concept identity/meaning approval is missing or stale.');
  return approval.concepts.length;
}
const fields = [
  'primary_idea',
  'representation_mode',
  'alternative_idea',
  'alternative_mode',
  'accessibility_guidance',
  'safety_guidance',
];
const validText = (s) =>
  typeof s === 'string' &&
  s === s.trim() &&
  s === s.normalize('NFC') &&
  s.length > 0 &&
  s.length <= 2000;
const mode = (s) => ['literal', 'interpretive'].includes(s);
export function guidanceFromConcept(c) {
  return {
    primary_idea: c.photography.guidance,
    representation_mode: c.photography.mode,
    alternative_idea: c.photography.alternative || null,
    alternative_mode: c.photography.alternative ? c.photography.alternative_mode : null,
    accessibility_guidance: c.photography.accessibility,
    safety_guidance: c.photography.safety,
  };
}
export function validateGuidance(manifest, guidance) {
  const errors = [];
  if (
    guidance?.schema_version !== 1 ||
    guidance.manifest_version !== manifest.version ||
    !Array.isArray(guidance.concepts)
  )
    return ['Invalid localized guidance manifest.'];
  if (
    guidance.concepts.length !== manifest.concepts.length ||
    new Set(guidance.concepts.map((c) => c.concept_key)).size !== manifest.concepts.length
  )
    errors.push('Guidance must cover each concept exactly once.');
  for (const entry of guidance.concepts) {
    const c = manifest.concepts.find((c) => c.concept_key === entry.concept_key);
    if (
      !c ||
      !entry.locales ||
      typeof entry.locales !== 'object' ||
      Array.isArray(entry.locales) ||
      !entry.locales.en
    ) {
      errors.push('Unknown concept or missing English guidance.');
      continue;
    }
    for (const [locale, value] of Object.entries(entry.locales)) {
      if (!['en', 'fr'].includes(locale) || !value || typeof value !== 'object') {
        errors.push('Invalid guidance locale.');
        continue;
      }
      if (
        Object.keys(value).some((k) => ![...fields, 'review'].includes(k)) ||
        fields.some((k) => !(k in value))
      )
        errors.push(`${c.concept_key}/${locale}: unknown/missing field`);
      if (
        !validText(value.primary_idea) ||
        !validText(value.accessibility_guidance) ||
        !validText(value.safety_guidance) ||
        !mode(value.representation_mode) ||
        !(
          (value.alternative_idea === null && value.alternative_mode === null) ||
          (validText(value.alternative_idea) && mode(value.alternative_mode))
        )
      )
        errors.push(`${c.concept_key}/${locale}: invalid text/mode/alternative`);
      const review = value.review;
      if (
        !review ||
        !['draft', 'approved'].includes(review.status) ||
        (review.status === 'draft' && (review.reviewer !== null || review.reviewed_at !== null)) ||
        (review.status === 'approved' &&
          (!validText(review.reviewer) ||
            !/^\d{4}-\d{2}-\d{2}$/.test(review.reviewed_at) ||
            !Number.isFinite(Date.parse(review.reviewed_at))))
      )
        errors.push(`${c.concept_key}/${locale}: invalid copy review`);
      if (locale === 'en' && fields.some((k) => value[k] !== guidanceFromConcept(c)[k]))
        errors.push(
          `${c.concept_key}: English guidance drift; review source and localization together`,
        );
      if (
        locale === 'fr' &&
        fields.filter((k) => k.endsWith('mode')).some((k) => value[k] !== entry.locales.en[k])
      )
        errors.push(`${c.concept_key}: localized modes must agree`);
    }
  }
  return errors;
}
export function buildGuidancePlan(
  manifest,
  approval,
  guidance,
  catalog,
  { allowDraftLocal = false } = {},
) {
  validateMeaningApproval(manifest, approval);
  const errors = validateGuidance(manifest, guidance);
  if (errors.length) throw new Error(errors.join('\n'));
  const rows = [],
    blockers = [];
  const keys = new Set(),
    ids = new Set();
  for (const c of catalog) {
    if (
      !c ||
      typeof c.concept_key !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c.id) ||
      keys.has(c.concept_key) ||
      ids.has(c.id)
    )
      throw new Error('Ambiguous/invalid existing catalog identities.');
    keys.add(c.concept_key);
    ids.add(c.id);
  }
  for (const c of guidance.concepts) {
    const existing = catalog.find((row) => row.concept_key === c.concept_key);
    if (!existing) {
      blockers.push(
        `${c.concept_key}: existing catalog identity required; no concept or term will be created`,
      );
      continue;
    }
    for (const [locale, value] of Object.entries(c.locales)) {
      if (value.review.status !== 'approved' && !allowDraftLocal)
        blockers.push(`${c.concept_key}/${locale}: guidance copy review pending`);
      rows.push({
        concept_id: existing.id,
        concept_key: c.concept_key,
        locale,
        ...Object.fromEntries(fields.map((k) => [k, value[k]])),
      });
    }
  }
  return { rows, blockers };
}
const sqlText = (value) => (value === null ? 'null' : "'" + value.replaceAll("'", "''") + "'");
// Call only after plan validation, in a transaction holding a catalog lock.
export function guidanceUpsertSql(plan) {
  if (plan.blockers.length) throw new Error('Guidance import is blocked.');
  return plan.rows
    .map((r) => {
      const values = [r.concept_id, r.locale, ...fields.map((k) => r[k])];
      return `insert into public.vocabulary_photo_guidance(concept_id,locale,${fields.join(',')}) values(${values.map(sqlText).join(',')}) on conflict(concept_id,locale) do update set ${fields.map((k) => `${k}=excluded.${k}`).join(',')} where (${fields.map((k) => `vocabulary_photo_guidance.${k}`).join(',')}) is distinct from (${fields.map((k) => `excluded.${k}`).join(',')});`;
    })
    .join('\n');
}
