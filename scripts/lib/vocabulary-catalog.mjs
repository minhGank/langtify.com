// Offline, fail-closed catalog planner. SQL is an operator artifact, never executed here.
import { createHash } from 'node:crypto';
import { validateManifest, normalize } from './vocabulary-manifest.mjs';
import { validateMeaningApproval, validateGuidance, meaningHash } from './vocabulary-guidance.mjs';
import { LEVELS, measureCoverage } from './vocabulary-coverage.mjs';
export const PROJECTS = ['ssuyyrfncvyqsgkirvpq', 'lfdgjewypbhukjrtwsef'];
export const canonical = (v) => JSON.stringify(sort(v));
function sort(v) {
  if (Array.isArray(v)) return v.map(sort);
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, sort(v[k])]),
    );
  return v;
}
export const digest = (v) => createHash('sha256').update(canonical(v)).digest('hex');
const uuid = (v) => typeof v === 'string' && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const text = (v) => typeof v === 'string' && v.trim().length > 0;
export const guidanceFields = [
  'primary_idea',
  'representation_mode',
  'alternative_idea',
  'alternative_mode',
  'accessibility_guidance',
  'safety_guidance',
];
export const projectGuidance = (g) => Object.fromEntries(guidanceFields.map((k) => [k, g[k]]));
export function reviewHash(c, guidance) {
  return digest({ concept: c, guidance });
}
export function validateEditorialReview(manifest, guidance, review) {
  if (
    review?.schema_version !== 1 ||
    review.manifest_version !== manifest.version ||
    review.reviewer_kind !== 'ai_assisted_editorial_review' ||
    review.independent_human_approval !== false ||
    !Array.isArray(review.concepts) ||
    review.concepts.length !== manifest.concepts.length ||
    new Set(review.concepts.map((c) => c.concept_key)).size !== manifest.concepts.length
  )
    return ['Invalid model editorial review provenance.'];
  return manifest.concepts.flatMap((c) => {
    const r = review.concepts.find((r) => r.concept_key === c.concept_key);
    return !r ||
      !text(r.translation_note) ||
      !text(r.decision) ||
      !Array.isArray(r.sources) ||
      r.sources.some((u) => !/^https:\/\//.test(u)) ||
      r.content_sha256 !==
        reviewHash(
          c,
          guidance.concepts.find((g) => g.concept_key === c.concept_key),
        )
      ? [`${c.concept_key}: missing or stale editorial evidence`]
      : [];
  });
}
// Only public catalog fields; never Auth users, credentials or Storage paths.
export function catalogState(s) {
  return Object.fromEntries(
    ['languages', 'concepts', 'terms', 'guidance'].map((k) => [
      k,
      [...s[k]].sort((a, b) => canonical(a).localeCompare(canonical(b))),
    ]),
  );
}
export function validateSnapshot(s, projectRef) {
  if (
    !PROJECTS.includes(projectRef) ||
    s?.project_ref !== projectRef ||
    s.read_only !== 'on' ||
    !Number.isFinite(Date.parse(s.captured_at)) ||
    !Array.isArray(s.migrations) ||
    typeof s.guidance_available !== 'boolean'
  )
    throw new Error('Invalid target or read-only snapshot.');
  const shapes = {
    languages: ['id', 'code', 'is_active'],
    concepts: ['id', 'concept_key', 'category', 'is_photographable', 'is_active'],
    terms: ['id', 'concept_id', 'language_id', 'term', 'cefr_level', 'part_of_speech', 'is_active'],
    guidance: ['concept_id', 'locale', ...guidanceFields],
  };
  for (const [table, fields] of Object.entries(shapes)) {
    if (!Array.isArray(s[table])) throw new Error('Incomplete catalog snapshot.');
    const ids = new Set(),
      keys = new Set();
    for (const r of s[table]) {
      if (
        !r ||
        Object.keys(r).length !== fields.length ||
        fields.some((f) => !(f in r)) ||
        ('id' in r && !uuid(r.id)) ||
        ('concept_id' in r && !uuid(r.concept_id)) ||
        ('language_id' in r && !uuid(r.language_id)) ||
        ('is_active' in r && typeof r.is_active !== 'boolean') ||
        ('is_photographable' in r && typeof r.is_photographable !== 'boolean')
      )
        throw new Error('Malformed catalog row.');
      const id = r.id ?? `${r.concept_id}/${r.locale}`;
      const key = r.concept_key ?? r.code ?? `${r.concept_id}/${r.language_id ?? r.locale}`;
      if (ids.has(id) || keys.has(key)) throw new Error('Duplicate catalog identity.');
      ids.add(id);
      keys.add(key);
    }
  }
  if (
    s.terms.some(
      (t) =>
        !LEVELS.includes(t.cefr_level) ||
        !text(t.term) ||
        !text(t.part_of_speech) ||
        !s.concepts.some((c) => c.id === t.concept_id) ||
        !s.languages.some((l) => l.id === t.language_id),
    ) ||
    s.guidance.some(
      (g) => !s.concepts.some((c) => c.id === g.concept_id) || !['en', 'fr'].includes(g.locale),
    ) ||
    (!s.guidance_available && s.guidance.length)
  )
    throw new Error('Invalid catalog references.');
}
export function combinedCoverage(manifest, snapshot) {
  const existing = snapshot.concepts
    .filter((c) => c.is_active && c.is_photographable)
    .map((c) => ({
      concept_key: c.concept_key,
      photography: { photographable: true },
      terms: Object.fromEntries(
        ['en', 'fr'].map((code) => {
          const l = snapshot.languages.find((l) => l.code === code && l.is_active);
          const t = snapshot.terms.find(
            (t) => t.concept_id === c.id && t.language_id === l?.id && t.is_active,
          );
          return [code, { lemma: t?.term, cefr: t?.cefr_level }];
        }),
      ),
    }));
  // Do not double count an existing key or assume an inactive existing concept is activated.
  const additions = manifest.concepts.filter(
    (c) => !snapshot.concepts.some((e) => e.concept_key === c.concept_key),
  );
  return {
    assumptions:
      'Hypothetical new pilot activation; existing active paired catalog retained. Fresh user, no completed concepts or replacements. Existing rows are operational inventory, not editorial approval. Conflicts block import. Pilot-only release gates remain unchanged.',
    existing: measureCoverage(existing),
    combined: measureCoverage([...existing, ...additions]),
  };
}
export function buildCatalogPlan({
  manifest,
  options,
  approval,
  guidance,
  snapshot,
  projectRef,
  reconciliation = null,
  editorialReview,
  mode = 'release-reviewed',
}) {
  if (!['release-reviewed', 'inactive-staging'].includes(mode))
    throw new Error('Unknown catalog import mode.');
  validateSnapshot(snapshot, projectRef);
  validateMeaningApproval(manifest, approval);
  const validation = validateManifest(manifest, options);
  const errors = [
    ...validation.errors,
    ...validateGuidance(manifest, guidance),
    ...validateEditorialReview(manifest, guidance, editorialReview),
  ];
  if (errors.length)
    throw new Error('Invalid manifest or localized guidance: ' + errors.join('; '));
  const releaseBlockers = [...validation.blockers];
  const blockers = [],
    conflicts = [],
    concepts = [],
    terms = [],
    copy = [];
  if (!snapshot.guidance_available) blockers.push('Photo guidance migration is not applied.');
  if (!snapshot.migrations.includes('20261020000000'))
    blockers.push('Selection v2 migration is not applied.');
  const languages = ['en', 'fr'].map((code) =>
    snapshot.languages.find((l) => l.code === code && l.is_active),
  );
  if (languages.some((l) => !l))
    blockers.push(
      'Active English and French language identities are required; importer never provisions languages.',
    );
  const reconValid =
    reconciliation?.project_ref === projectRef &&
    reconciliation.snapshot_sha256 === digest(snapshot) &&
    text(reconciliation.reviewer) &&
    /^\d{4}-\d{2}-\d{2}$/.test(reconciliation.reviewed_at ?? '') &&
    Array.isArray(reconciliation.concepts) &&
    reconciliation.concepts.length === manifest.concepts.length &&
    new Set(reconciliation.concepts.map((r) => r.concept_key)).size === manifest.concepts.length;
  if (!reconValid)
    blockers.push(
      'Target-specific semantic identity reconciliation is missing/stale; lexical checks cannot prove absence of synonyms.',
    );
  for (const c of manifest.concepts) {
    const e = snapshot.concepts.find((e) => e.concept_key === c.concept_key);
    if (
      mode === 'inactive-staging' &&
      e &&
      (e.is_active || snapshot.terms.some((t) => t.concept_id === e.id && t.is_active))
    )
      conflicts.push(
        `${c.concept_key}: existing pilot identity is active; staging cannot modify or deactivate it`,
      );
    const identity = reconciliation?.concepts?.find((r) => r.concept_key === c.concept_key);
    if (
      reconValid &&
      (!identity ||
        identity.meaning_sha256 !== meaningHash(c) ||
        identity.existing_id !== (e?.id ?? null))
    )
      conflicts.push(`${c.concept_key}: semantic identity reconciliation mismatch`);
    if (e && (e.category !== c.category || !e.is_photographable))
      conflicts.push(`${c.concept_key}: existing concept metadata differs; no overwrite`);
    if (!e)
      concepts.push({
        concept_key: c.concept_key,
        category: c.category,
        is_photographable: true,
        is_active: false,
      });
    for (const code of ['en', 'fr']) {
      const l = snapshot.languages.find((l) => l.code === code && l.is_active);
      if (!l) continue;
      const t = c.terms[code];
      const spellings = [t.display, t.lemma, ...t.aliases].map(normalize);
      if (
        snapshot.terms.some(
          (r) =>
            r.language_id === l.id &&
            r.concept_id !== e?.id &&
            spellings.includes(normalize(r.term)),
        )
      )
        conflicts.push(`${c.concept_key}/${code}: another identity has a matching term/alias`);
      const old = snapshot.terms.find((r) => r.concept_id === e?.id && r.language_id === l.id);
      if (
        old &&
        (old.term !== t.display ||
          old.cefr_level !== t.cefr ||
          old.part_of_speech !== c.part_of_speech)
      )
        conflicts.push(`${c.concept_key}/${code}: existing term differs; no overwrite`);
      if (!old)
        terms.push({
          concept_key: c.concept_key,
          language_id: l.id,
          term: t.display,
          cefr_level: t.cefr,
          part_of_speech: c.part_of_speech,
          is_active: false,
        });
    }
    const localized = guidance.concepts.find((g) => g.concept_key === c.concept_key);
    for (const locale of ['en', 'fr']) {
      const value = localized.locales[locale];
      if (!value) {
        blockers.push(`${c.concept_key}/${locale}: missing localized guidance`);
        continue;
      }
      if (value.review.status !== 'approved')
        releaseBlockers.push(`${c.concept_key}/${locale}: copy approval pending`);
      const old = snapshot.guidance.find((g) => g.concept_id === e?.id && g.locale === locale);
      if (old && canonical(projectGuidance(old)) !== canonical(projectGuidance(value)))
        conflicts.push(`${c.concept_key}/${locale}: existing guidance differs; no overwrite`);
      if (!old) copy.push({ concept_key: c.concept_key, locale, ...projectGuidance(value) });
    }
  }
  if (mode === 'release-reviewed') blockers.push(...releaseBlockers);
  const plan = {
    schema_version: 1,
    mode,
    release_blockers: releaseBlockers,
    project_ref: projectRef,
    snapshot_sha256: digest(snapshot),
    artifact_sha256: digest({ manifest, approval, guidance, reconciliation, editorialReview }),
    expected: catalogState(snapshot),
    blockers,
    conflicts,
    inserts: { concepts, terms, guidance: copy },
    coverage: combinedCoverage(manifest, snapshot),
  };
  return { ...plan, plan_sha256: digest(plan) };
}
const literal = (v) => (v === null ? 'null' : `'${String(v).replaceAll("'", "''")}'`);
export function stateSql({ includeGuidance = true } = {}) {
  const projections = {
    languages: 'id,code,is_active',
    concepts: 'id,concept_key,category,is_photographable,is_active',
    terms: 'id,concept_id,language_id,term,cefr_level,part_of_speech,is_active',
    guidance: `concept_id,locale,${guidanceFields.join(',')}`,
  };
  return `jsonb_build_object(${Object.entries(projections)
    .map(([k, cols]) =>
      k === 'guidance' && !includeGuidance
        ? "'guidance','[]'::jsonb"
        : `${literal(k)},(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from (select ${cols} from public.${k === 'languages' ? k : 'vocabulary_' + (k === 'guidance' ? 'photo_guidance' : k)}) r)`,
    )
    .join(',')})`;
}
export function catalogImportSql(plan, expectedPlanHash) {
  const { plan_sha256, ...body } = plan;
  if (
    plan_sha256 !== expectedPlanHash ||
    digest(body) !== plan_sha256 ||
    !PROJECTS.includes(plan.project_ref)
  )
    throw new Error('Plan integrity/target check failed.');
  if (
    !['release-reviewed', 'inactive-staging'].includes(plan.mode) ||
    (plan.mode === 'release-reviewed' && plan.release_blockers.length) ||
    plan.inserts.concepts.some((r) => r.is_active !== false) ||
    plan.inserts.terms.some((r) => r.is_active !== false)
  )
    throw new Error('Catalog import blocked: invalid inactive import policy.');
  if (plan.blockers.length || plan.conflicts.length)
    throw new Error('Catalog import blocked; approvals, prerequisites or conflicts unresolved.');
  // Compare JSONB sets, not order-dependent JSON encodings; lock all input tables to fence drift.
  const expected = literal(JSON.stringify(plan.expected));
  let tag = '$catalog_import$';
  while (expected.includes(tag)) tag = '$' + tag.slice(1, -1) + '_x$';
  const statements = [];
  for (const c of plan.inserts.concepts)
    statements.push(
      `insert into public.vocabulary_concepts(concept_key,category,is_photographable,is_active) values(${literal(c.concept_key)},${literal(c.category)},true,false);`,
    );
  for (const t of plan.inserts.terms)
    statements.push(
      `insert into public.vocabulary_terms(concept_id,language_id,term,cefr_level,part_of_speech,is_active) select id,${literal(t.language_id)}::uuid,${literal(t.term)},${literal(t.cefr_level)},${literal(t.part_of_speech)},false from public.vocabulary_concepts where concept_key=${literal(t.concept_key)};`,
    );
  for (const g of plan.inserts.guidance)
    statements.push(
      `insert into public.vocabulary_photo_guidance(concept_id,locale,${guidanceFields.join(',')}) select id,${literal(g.locale)},${guidanceFields.map((k) => literal(g[k])).join(',')} from public.vocabulary_concepts where concept_key=${literal(g.concept_key)};`,
    );
  return `-- Target: ${plan.project_ref}; plan: ${plan_sha256}. Verify target through the authenticated operator connection.
-- New catalog rows remain inactive. No existing rows or learning history are updated.
begin;
set local standard_conforming_strings=on;
set local lock_timeout='5s'; set local statement_timeout='30s';
lock table public.languages,public.vocabulary_concepts,public.vocabulary_terms,public.vocabulary_photo_guidance in share row exclusive mode;
do ${tag} declare actual jsonb; expected jsonb := ${expected}::jsonb; k text; begin
 actual := ${stateSql()};
 foreach k in array array['languages','concepts','terms','guidance'] loop
 if not ((actual->k) @> (expected->k) and (expected->k) @> (actual->k)) then raise exception 'catalog_snapshot_drift'; end if;
 end loop;
end ${tag};
${statements.join('\n')}
-- Export this identity receipt with the reviewed plan after a successful commit.
select c.id,c.concept_key,t.id as term_id,l.code,t.is_active as term_active,c.is_active as concept_active
from public.vocabulary_concepts c join public.vocabulary_terms t on t.concept_id=c.id join public.languages l on l.id=t.language_id
where c.concept_key in (${[...new Set([...plan.inserts.concepts, ...plan.inserts.terms, ...plan.inserts.guidance].map((r) => r.concept_key))].map(literal).join(',') || 'null'}) order by c.concept_key,l.code;
commit;
`;
}
