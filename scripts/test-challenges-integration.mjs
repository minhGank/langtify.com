import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { query, execute } from './lib/local-db.mjs';

const user = randomUUID();
const auditLanguage = randomUUID();
const auditConcepts = [randomUUID(), randomUUID(), randomUUID()];
const auditTerms = [randomUUID(), randomUUID(), randomUUID()];
const claim = `set local role authenticated; select set_config('request.jwt.claim.sub','${user}',true);`;
try {
  await execute(`insert into auth.users(id,email) values('${user}','${user}@example.test');
    begin; ${claim}
    select public.complete_onboarding('c_${user.replaceAll('-', '').slice(0, 20)}','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','A1','UTC'); commit;`);
  const first = query(
    `begin; ${claim} select public.get_or_create_today_challenge(); select 'AUDIT_LOCKED'; select pg_sleep(1); commit;`,
  );
  assert.equal(await first.ready, true, 'First creation did not acquire locks');
  const second = query(`begin; ${claim} select public.get_or_create_today_challenge(); commit;`);
  const results = await Promise.all([first.result, second.result]);
  results.forEach((result) => assert.equal(result.code, 0, result.error));
  const challenge = await execute(
    `select id from public.daily_challenges where user_id='${user}';`,
  );
  results.forEach((result) => assert.ok(result.output.includes(challenge)));
  assert.equal(
    await execute(`select count(*) from public.daily_challenges where user_id='${user}';`),
    '1',
  );
  assert.equal(
    await execute(
      `select count(*) from public.daily_challenge_words where daily_challenge_id='${challenge}' and replaced_at is null;`,
    ),
    '3',
  );
  console.log(
    'PASS: simultaneous authenticated creation returns one challenge with three active slots',
  );

  const old = await execute(
    `select id from public.daily_challenge_words where daily_challenge_id='${challenge}' and slot='review' and replaced_at is null;`,
  );
  const replaceOne = query(
    `begin; ${claim} select public.replace_daily_challenge_word('${old}'); select 'AUDIT_LOCKED'; select pg_sleep(1); commit;`,
  );
  assert.equal(await replaceOne.ready, true, 'First replacement did not acquire locks');
  const replaceTwo = query(
    `begin; ${claim} select public.replace_daily_challenge_word('${old}'); commit;`,
  );
  const [winner, loser] = await Promise.all([replaceOne.result, replaceTwo.result]);
  assert.equal(winner.code, 0, winner.error);
  assert.notEqual(loser.code, 0);
  assert.match(loser.error, /assignment_unavailable/);
  assert.equal(
    await execute(
      `select count(*)||':'||count(distinct concept_id)||':'||count(*) filter(where replaced_at is null) from public.daily_challenge_words where daily_challenge_id='${challenge}';`,
    ),
    '4:4:3',
  );
  console.log(
    'PASS: concurrent replacement of the same active ID has one winner and immutable history',
  );

  const target = await execute(
    `select id from public.daily_challenge_words where daily_challenge_id='${challenge}' and slot='target' and replaced_at is null;`,
  );
  const stretch = await execute(
    `select id from public.daily_challenge_words where daily_challenge_id='${challenge}' and slot='stretch' and replaced_at is null;`,
  );
  const targetWrite = query(
    `begin; ${claim} select public.replace_daily_challenge_word('${target}'); select 'AUDIT_LOCKED'; select pg_sleep(1); commit;`,
  );
  assert.equal(await targetWrite.ready, true);
  const stretchWrite = query(
    `begin; ${claim} select public.replace_daily_challenge_word('${stretch}'); commit;`,
  );
  const writes = await Promise.all([targetWrite.result, stretchWrite.result]);
  writes.forEach((result) => assert.equal(result.code, 0, result.error));
  assert.equal(
    await execute(
      `select count(*)||':'||count(distinct concept_id)||':'||count(*) filter(where replaced_at is null) from public.daily_challenge_words where daily_challenge_id='${challenge}';`,
    ),
    '6:6:3',
  );
  console.log(
    'PASS: concurrent different-slot replacements retain three unique active slots and all history',
  );

  // A repeatable-read catalog editor must not miss newly committed references.
  // Isolate fixtures from normal profiles and previously assigned seed vocabulary.
  await execute(`begin;
    insert into public.languages(id,code,name,native_name) values('${auditLanguage}','zz-${user.slice(0, 23)}','Audit fixture','Audit fixture');
    update public.user_language_profiles set target_language_id='${auditLanguage}' where user_id='${user}';
    ${auditConcepts
      .map(
        (
          id,
          index,
        ) => `insert into public.vocabulary_concepts(id,concept_key,category,is_photographable) values('${id}','AUDIT_${id.replaceAll('-', '').toUpperCase()}','test',true);
      insert into public.vocabulary_terms(id,concept_id,language_id,term,cefr_level,part_of_speech) values('${auditTerms[index]}','${id}','${auditLanguage}','test target','${index === 2 ? 'A2' : 'A1'}','noun');
      insert into public.vocabulary_terms(concept_id,language_id,term,cefr_level,part_of_speech) values('${id}','00000000-0000-4000-8000-000000000001','test reference','A1','noun');`,
      )
      .join('\n')}
    update public.languages set is_active=false where id='${auditLanguage}'; commit;`);
  const unused = auditTerms[0];
  const historyWriter = query(`begin; select set_config('request.jwt.claim.sub','${user}',true);
    insert into public.daily_challenges(user_id,user_language_profile_id,created_at)
      select user_id,id,clock_timestamp()-interval '5 days' from public.user_language_profiles where user_id='${user}';
    insert into public.daily_challenge_words(daily_challenge_id,slot,cefr_level,vocabulary_term_id)
      select id,'review','A1','${unused}' from public.daily_challenges where user_id='${user}' and id<>'${challenge}';
    select private.assign_challenge_word(id,'target') from public.daily_challenges where user_id='${user}' and id<>'${challenge}';
    select private.assign_challenge_word(id,'stretch') from public.daily_challenges where user_id='${user}' and id<>'${challenge}';
    select 'AUDIT_LOCKED'; select pg_sleep(2); commit;`);
  assert.equal(await historyWriter.ready, true);
  const catalogEditor = query(`begin isolation level repeatable read;
    select count(*) from public.daily_challenge_words where vocabulary_term_id='${unused}';
    select 'AUDIT_LOCKED';
    update public.vocabulary_terms set language_id='00000000-0000-4000-8000-000000000002' where id='${unused}'; commit;`);
  assert.equal(await catalogEditor.ready, true);
  const [assigned, rejectedEdit] = await Promise.all([historyWriter.result, catalogEditor.result]);
  assert.equal(assigned.code, 0, assigned.error);
  assert.notEqual(rejectedEdit.code, 0);
  assert.match(rejectedEdit.error, /23503|40001/);
  assert.equal(
    await execute(`select language_id from public.vocabulary_terms where id='${unused}';`),
    auditLanguage,
  );
  console.log(
    'PASS: repeatable-read catalog edits cannot invalidate concurrently committed assignment links',
  );
} finally {
  await execute(
    `delete from auth.users where id='${user}';
    delete from public.vocabulary_terms where concept_id in (${auditConcepts.map((id) => `'${id}'`).join(',')});
    delete from public.vocabulary_concepts where id in (${auditConcepts.map((id) => `'${id}'`).join(',')});
    delete from public.languages where id='${auditLanguage}';`,
  );
}
