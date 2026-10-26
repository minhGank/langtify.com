// Offline only: dry-run by default, optional guarded SQL artifact. Never opens a database connection.
import { readFileSync, writeFileSync } from 'node:fs';
import { loadPilot, jsonFile } from './validate-vocabulary.mjs';
import { buildCatalogPlan, catalogImportSql } from './lib/vocabulary-catalog.mjs';
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
try {
  const args = process.argv.slice(2),
    flags = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (
      ![
        '--mode',
        '--snapshot',
        '--project-ref',
        '--reconciliation',
        '--write-sql',
        '--approve-plan',
      ].includes(key) ||
      flags[key] ||
      !args[i + 1] ||
      args[i + 1].startsWith('--')
    )
      throw new Error('Invalid options.');
    flags[key] = args[i + 1];
  }
  if (!flags['--snapshot'] || !flags['--project-ref'])
    throw new Error('Explicit --snapshot and --project-ref are required.');
  if (Boolean(flags['--write-sql']) !== Boolean(flags['--approve-plan']))
    throw new Error('SQL output requires the reviewed plan hash.');
  const plan = buildCatalogPlan({
    ...loadPilot(),
    mode: flags['--mode'] ?? 'release-reviewed',
    approval: jsonFile('data/vocabulary/meaning-approval.v0.2.0.json'),
    guidance: jsonFile('data/vocabulary/photo-guidance.v0.2.0.json'),
    editorialReview: jsonFile('data/vocabulary/editorial-review.v0.2.0.json'),
    snapshot: read(flags['--snapshot']),
    projectRef: flags['--project-ref'],
    reconciliation: flags['--reconciliation'] ? read(flags['--reconciliation']) : null,
  });
  if (flags['--write-sql'])
    writeFileSync(flags['--write-sql'], catalogImportSql(plan, flags['--approve-plan']), {
      flag: 'wx',
      mode: 0o600,
    });
  console.log(JSON.stringify(plan, null, 2));
  if (plan.blockers.length || plan.conflicts.length) process.exitCode = 1;
} catch (error) {
  console.error(
    'Catalog planning failed:',
    error instanceof Error ? error.message : 'Unknown failure',
  );
  process.exitCode = 1;
}
