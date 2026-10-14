// Local Docker only. This importer never creates/renames concepts or touches terms.
import { pathToFileURL } from 'node:url';
import { execute } from './lib/local-db.mjs';
import { loadPilot, jsonFile } from './validate-vocabulary.mjs';
import { validateManifest } from './lib/vocabulary-manifest.mjs';
import { buildGuidancePlan, guidanceUpsertSql } from './lib/vocabulary-guidance.mjs';

export function localImportSql(plan) {
  // A dry-run identity cannot silently resolve to a different concept at apply time.
  const expected = JSON.stringify(plan.rows.map((r) => ({ id: r.concept_id, key: r.concept_key })));
  const literal = "'" + expected.replaceAll("'", "''") + "'";
  return `begin; lock table public.vocabulary_concepts in share mode;
    do $$begin if exists(select 1 from jsonb_to_recordset(${literal}::jsonb) as e(id uuid,key text)
      where not exists(select 1 from public.vocabulary_concepts c where c.id=e.id and c.concept_key=e.key))
      then raise exception 'catalog_identity_drift'; end if; end$$;
    ${guidanceUpsertSql(plan)} commit;`;
}
async function main(args) {
  if (args.some((a) => !['--apply-local', '--allow-draft-local'].includes(a)))
    throw new Error('Only local import flags are supported; no hosted target is accepted.');
  const { manifest, options } = loadPilot();
  const validation = validateManifest(manifest, options);
  if (validation.errors.length) throw new Error('Invalid vocabulary manifest.');
  const catalog = JSON.parse(
    await execute(
      "select coalesce(jsonb_agg(jsonb_build_object('id',id,'concept_key',concept_key)),'[]') from public.vocabulary_concepts;",
    ),
  );
  const plan = buildGuidancePlan(
    manifest,
    jsonFile('data/vocabulary/meaning-approval.v0.2.0.json'),
    jsonFile('data/vocabulary/photo-guidance.v0.2.0.json'),
    catalog,
    { allowDraftLocal: args.includes('--allow-draft-local') },
  );
  console.log(
    JSON.stringify(
      {
        target: 'local Docker supabase_db_langtify',
        mode: args.includes('--apply-local') ? 'apply' : 'dry-run',
        rows: plan.rows.length,
        blockers: plan.blockers,
      },
      null,
      2,
    ),
  );
  if (plan.blockers.length) {
    process.exitCode = 1;
    return;
  }
  if (args.includes('--apply-local')) await execute(localImportSql(plan));
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)
  main(process.argv.slice(2)).catch(() => {
    console.error('Local guidance import failed; no credentials or provider details are logged.');
    process.exitCode = 1;
  });
