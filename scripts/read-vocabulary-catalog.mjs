// Explicitly targeted read-only metadata snapshot; no Auth/user/Storage data.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { PROJECTS, stateSql, validateSnapshot } from './lib/vocabulary-catalog.mjs';
try {
  const args = process.argv.slice(2);
  if (
    args.length !== 4 ||
    args[0] !== '--project-ref' ||
    !PROJECTS.includes(args[1]) ||
    args[2] !== '--output'
  )
    throw new Error('Use --project-ref <approved ref> --output <new JSON path>.');
  const projectRef = args[1];
  const cli = new URL('../node_modules/.bin/supabase', import.meta.url).pathname;
  function run(command) {
    try {
      return JSON.parse(
        execFileSync(cli, command, {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 45000,
          maxBuffer: 10 * 1024 * 1024,
        }),
      );
    } catch {
      throw new Error(
        'Read-only CLI request failed; no provider body printed. Check authenticated CLI access and network connectivity.',
      );
    }
  }
  const projects = run(['projects', 'list', '--output', 'json']);
  const identity = projects.find((p) => p.id === projectRef);
  if (!identity) throw new Error('Project identity not found.');
  const query = (sql) =>
    run([
      'db',
      'query',
      '--linked',
      '--project-ref',
      projectRef,
      `begin read only; ${sql}; rollback;`,
    ]).rows;
  const available = query(
    "select to_regclass('public.vocabulary_photo_guidance') is not null as available",
  )[0].available;
  const state = stateSql({ includeGuidance: available });
  const s = query(
    `select ${state} || jsonb_build_object('project_ref','${projectRef}','read_only',current_setting('transaction_read_only'),'captured_at',now(),'guidance_available',${available ? 'true' : 'false'},'migrations',(select coalesce(jsonb_agg(version order by version),'[]') from supabase_migrations.schema_migrations)) as catalog`,
  )[0].catalog;
  validateSnapshot(s, projectRef);
  writeFileSync(args[3], JSON.stringify(s, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(
    JSON.stringify({
      project_ref: projectRef,
      name: identity.name,
      concepts: s.concepts.length,
      terms: s.terms.length,
      guidance: s.guidance.length,
      read_only: s.read_only,
    }),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Snapshot failed.');
  process.exitCode = 1;
}
