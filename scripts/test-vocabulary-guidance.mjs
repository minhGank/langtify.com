// Rollback-only local Docker fixture: import idempotency and migration replay.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execute } from './lib/local-db.mjs';
import { localImportSql } from './import-vocabulary-guidance.mjs';
const migration = readFileSync(
  'supabase/migrations/20261013000000_vocabulary_photo_guidance.sql',
  'utf8',
)
  .replace(/^begin;\s*/, '')
  .replace(/commit;\s*$/, '');
const row = {
  concept_id: '79000000-0000-4000-8000-000000000001',
  concept_key: 'GUIDANCE_REPLAY_FIXTURE',
  locale: 'en',
  primary_idea: "A user's staged model.",
  representation_mode: 'interpretive',
  alternative_idea: null,
  alternative_mode: null,
  accessibility_guidance: 'A seated setup works.',
  safety_guidance: 'No strangers or identifying details.',
};
const sql = localImportSql({ rows: [row], blockers: [] })
  .replace(/^begin;/, '')
  .replace(/commit;\s*$/, '');
const output = await execute(`begin;
create temporary table guidance_other_functions as select p.oid,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f' and p.proname not in ('concept_photo_guidance','challenge_payload');
insert into public.vocabulary_concepts(id,concept_key,category) values('${row.concept_id}','${row.concept_key}','fixture');
${sql}
create temporary table guidance_before as select *,ctid::text version from public.vocabulary_photo_guidance where concept_id='${row.concept_id}';
${sql}
do $$begin
 if (select count(*) from public.vocabulary_photo_guidance where concept_id='${row.concept_id}')<>1 then raise exception 'duplicate import';end if;
 if exists(select 1 from guidance_before b join public.vocabulary_photo_guidance g using(concept_id,locale) where g.ctid::text<>b.version or g.primary_idea<>b.primary_idea) then raise exception 'replay rewrote data';end if;
end$$;
${migration}
do $$begin
 if exists(select 1 from guidance_other_functions f where pg_get_functiondef(f.oid) is distinct from f.definition) then raise exception 'unrelated function changed';end if;
 if not exists(select 1 from public.vocabulary_photo_guidance where concept_id='${row.concept_id}' and primary_idea='A user''s staged model.') then raise exception 'migration lost guidance';end if;
end$$;
select 'GUIDANCE_REPLAY_OK'; rollback;`);
assert.ok(output.includes('GUIDANCE_REPLAY_OK'));
// Changed key/UUID must abort the whole importer transaction before inserting guidance.
await assert.rejects(
  () => execute(localImportSql({ rows: [row], blockers: [] })),
  /catalog_identity_drift/,
);
assert.equal(
  await execute(`select count(*) from public.vocabulary_concepts where id='${row.concept_id}';`),
  '0',
);
console.log(
  'PASS: local rollback-only import, no-op replay, migration preservation, unchanged selection/functions, catalog drift rejection.',
);
