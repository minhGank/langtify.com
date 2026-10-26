// Offline artifact preparation only. No connection or execution capability.
import { createHash } from 'node:crypto';
import { PROJECTS, validateSnapshot } from './vocabulary-catalog.mjs';
const quote = (v) => `'${v.replaceAll("'", "''")}'`;
export const migrationScope = {
  [PROJECTS[0]]: ['20261005000000', '20261005010000', '20261013000000', '20261020000000'],
  [PROJECTS[1]]: ['20261013000000', '20261020000000'],
};
export function prepareMigrations(snapshot, sources) {
  validateSnapshot(snapshot, snapshot.project_ref);
  const baseline = sources.filter((s) => s.version <= '20260928010000');
  if (
    baseline.some((s) => !snapshot.migrations.includes(s.version)) ||
    snapshot.migrations.some((v) => !sources.some((s) => s.version === v))
  )
    throw new Error('Unexpected migration baseline; inspect before preparing execution.');
  if (
    snapshot.project_ref === PROJECTS[1] &&
    ['20261005000000', '20261005010000'].some((v) => !snapshot.migrations.includes(v))
  )
    throw new Error('Production explicit service grants are missing.');
  let expected = [...snapshot.migrations].sort();
  return migrationScope[snapshot.project_ref]
    .filter((v) => !expected.includes(v))
    .map((version) => {
      const source = sources.find((s) => s.version === version);
      if (
        !source ||
        !/^\s*(?:--[^\n]*\n\s*)*begin;/i.test(source.sql) ||
        !/commit;\s*$/i.test(source.sql)
      )
        throw new Error('Expected a single transactional migration source.');
      const body = source.sql.replace(/\bbegin;/i, '').replace(/commit;\s*$/i, '');
      const before = expected;
      expected = [...expected, version].sort();
      const sql = `-- Target ${snapshot.project_ref}. Operator must verify the authenticated connection.\nbegin;\nset local lock_timeout='5s';\nset local statement_timeout='60s';\nlock table supabase_migrations.schema_migrations in exclusive mode;\ndo $history_guard$ begin\n if (select coalesce(array_agg(version::text order by version),'{}'::text[]) from supabase_migrations.schema_migrations) is distinct from array[${before.map(quote).join(',')}]::text[] then\n raise exception 'migration_history_drift'; end if;\nend $history_guard$;\n${body}\ninsert into supabase_migrations.schema_migrations(version,name,statements) values(${quote(version)},${quote(source.name)},array[${quote(body)}]::text[]);\ncommit;\n`;
      return {
        version,
        name: source.name,
        source_sha256: createHash('sha256').update(source.sql).digest('hex'),
        expected_before: before,
        expected_after: expected,
        sql,
      };
    });
}
// Separate from vocabulary and from supabase/seed.sql. Never renames/reactivates an existing row.
export function prepareLanguages(snapshot) {
  validateSnapshot(snapshot, snapshot.project_ref);
  const rows = [
    ['en', 'English', 'English'],
    ['fr', 'French', 'Français'],
  ];
  if (snapshot.languages.some((l) => ['en', 'fr'].includes(l.code) && !l.is_active))
    throw new Error('Existing language is inactive; do not reactivate implicitly.');
  const missing = rows.filter(([code]) => !snapshot.languages.some((l) => l.code === code));
  if (!missing.length) return null;
  if (snapshot.project_ref !== PROJECTS[1] || snapshot.languages.length)
    throw new Error('Expected the confirmed empty Production language catalog.');
  return `-- Target ${snapshot.project_ref}; separate minimal language provisioning.\nbegin;\nset local lock_timeout='5s';\nlock table public.languages in share row exclusive mode;\ndo $languages_guard$ begin\n if exists(select 1 from public.languages) then raise exception 'language_catalog_drift'; end if;\nend $languages_guard$;\ninsert into public.languages(code,name,native_name,is_active) values\n${missing.map((r) => `(${r.map(quote).join(',')},true)`).join(',\n')};\nselect id,code,name,native_name,is_active from public.languages order by code;\ncommit;\n`;
}
