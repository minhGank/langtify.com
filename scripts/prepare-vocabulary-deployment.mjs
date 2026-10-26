// Writes reviewable local artifacts; never applies them or connects to Supabase.
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareLanguages, prepareMigrations } from './lib/vocabulary-deployment.mjs';
try {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--snapshot' || args[2] !== '--output-dir')
    throw new Error('Use --snapshot <read-only snapshot> --output-dir <new directory>.');
  const snapshot = JSON.parse(readFileSync(args[1], 'utf8'));
  const sources = readdirSync('supabase/migrations')
    .filter((n) => n.endsWith('.sql'))
    .sort()
    .map((n) => ({
      version: n.split('_')[0],
      name: n.slice(15, -4),
      sql: readFileSync(join('supabase/migrations', n), 'utf8'),
    }));
  const migrations = prepareMigrations(snapshot, sources),
    languages = prepareLanguages(snapshot);
  mkdirSync(args[3], { mode: 0o700 });
  const write = (n, s) => writeFileSync(join(args[3], n), s, { mode: 0o600, flag: 'wx' });
  migrations.forEach((m) => write(`${m.version}_${m.name}.sql`, m.sql));
  if (languages) write('languages.sql', languages);
  write(
    'plan.json',
    JSON.stringify(
      {
        project_ref: snapshot.project_ref,
        captured_at: snapshot.captured_at,
        migrations: migrations.map(({ sql: _sql, ...m }) => m),
        languages_required: Boolean(languages),
        executable_only_after_verified_backup_and_target_check: true,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    JSON.stringify({
      project_ref: snapshot.project_ref,
      migrations: migrations.map((m) => m.version),
      languages_required: Boolean(languages),
      executed: false,
    }),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Preparation failed.');
  process.exitCode = 1;
}
