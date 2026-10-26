// Disposable local database only: no hosted credentials, no real catalog import.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { execute, query } from './lib/local-db.mjs';
import { buildCatalogPlan, catalogImportSql, stateSql } from './lib/vocabulary-catalog.mjs';
import { fixture, reconcile } from './tests/helpers/vocabulary-catalog.mjs';
import { loadPilot, jsonFile } from './validate-vocabulary.mjs';
import { prepareLanguages } from './lib/vocabulary-deployment.mjs';
export async function testCatalogImport() {
  const database = `langtify_catalog_${randomUUID().replaceAll('-', '')}`;
  await execute(`create database ${database};`);
  try {
    const schema = readFileSync(
      'supabase/migrations/20260912020000_phase3_challenges.sql',
      'utf8',
    ).split('create table public.daily_challenges')[0];
    const languages = readFileSync('supabase/migrations/20260912000000_phase2_identity.sql', 'utf8')
      .split('create table public.languages (')[1]
      .split('create table public.user_language_profiles')[0];
    const guidance = readFileSync(
      'supabase/migrations/20261013000000_vocabulary_photo_guidance.sql',
      'utf8',
    )
      .split('alter table public.vocabulary_photo_guidance')[0]
      .replace(/^begin;/, '');
    await execute(`create table public.languages (${languages}\n${schema}\n${guidance}`, database);
    const input = fixture();
    Object.assign(input, loadPilot(), {
      mode: 'inactive-staging',
      guidance: jsonFile('data/vocabulary/photo-guidance.v0.2.0.json'),
      editorialReview: jsonFile('data/vocabulary/editorial-review.v0.2.0.json'),
    });
    const emptyProduction = {
      ...input.snapshot,
      project_ref: 'lfdgjewypbhukjrtwsef',
      languages: [],
    };
    const languagesSql = prepareLanguages(emptyProduction);
    await execute(languagesSql, database);
    assert.equal(await execute('select count(*) from public.languages;', database), '2');
    const staleLanguages = await query(languagesSql, database).result;
    assert.notEqual(staleLanguages.code, 0);
    // Disposable fixture only: keep deterministic IDs for the remaining assertions.
    await execute('delete from public.languages;', database);
    await execute(
      input.snapshot.languages
        .map(
          (l) =>
            `insert into public.languages(id,code,name,native_name) values('${l.id}','${l.code}','fixture','fixture');`,
        )
        .join('\n'),
      database,
    );
    const refresh = async () => {
      Object.assign(input.snapshot, JSON.parse(await execute(`select ${stateSql()};`, database)));
      return buildCatalogPlan(reconcile(input));
    };
    const first = await refresh(),
      sql = catalogImportSql(first, first.plan_sha256);
    // Inject a failure after inserts: the entire transaction must roll back.
    const failed = await query(sql.replace('commit;', 'select 1/0; commit;'), database).result;
    assert.notEqual(failed.code, 0);
    assert.equal(await execute('select count(*) from public.vocabulary_concepts;', database), '0');
    const holder = query(
      "begin; lock table public.vocabulary_concepts in share row exclusive mode; select 'AUDIT_LOCKED'; select pg_sleep(1); rollback;",
      database,
    );
    await holder.ready;
    const started = Date.now();
    await execute(sql, database);
    assert.ok(Date.now() - started >= 500, 'writer waits for competing catalog lock');
    assert.equal((await holder.result).code, 0);
    assert.equal(
      await execute(
        'select count(*) from public.vocabulary_concepts where not is_active;',
        database,
      ),
      '60',
    );
    assert.equal(
      await execute('select count(*) from public.vocabulary_terms where not is_active;', database),
      '120',
    );
    assert.equal(
      await execute('select count(*) from public.vocabulary_photo_guidance;', database),
      '120',
    );
    // A lost acknowledgement is reconciled by a fresh snapshot, not by blind retries.
    const stale = await query(sql, database).result;
    assert.notEqual(stale.code, 0);
    assert.match(stale.error, /catalog_snapshot_drift/);
    const before = await execute(`select ${stateSql()};`, database);
    const repeated = await refresh();
    assert.ok(Object.values(repeated.inserts).every((r) => r.length === 0));
    await execute(catalogImportSql(repeated, repeated.plan_sha256), database);
    assert.equal(await execute(`select ${stateSql()};`, database), before);
    // Staging must never enrich an active pilot identity or deactivate it implicitly.
    await execute(
      "update public.vocabulary_concepts set is_active=true where concept_key='BED'; update public.vocabulary_terms set is_active=true where concept_id=(select id from public.vocabulary_concepts where concept_key='BED');",
      database,
    );
    const activeBefore = await execute(`select ${stateSql()};`, database),
      activePlan = await refresh();
    assert.ok(activePlan.conflicts.some((c) => c.includes('active')));
    assert.throws(() => catalogImportSql(activePlan, activePlan.plan_sha256), /blocked/);
    assert.equal(await execute(`select ${stateSql()};`, database), activeBefore);
    console.log(
      'PASS: isolated catalog import, 60/120/120 linkage, inactive staging, atomic rollback, lock serialization, stale-plan rejection and UUID-preserving no-op replay.',
    );
  } finally {
    await execute(`drop database ${database} with (force);`);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await testCatalogImport();
