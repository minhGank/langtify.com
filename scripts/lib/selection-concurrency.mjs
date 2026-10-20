import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execute, query } from './local-db.mjs';

export async function testFallbackConcurrency() {
  const user = randomUUID();
  const target = randomUUID();
  const reference = randomUUID();
  const concepts = Array.from({ length: 6 }, () => randomUUID());
  const claim = `set local role authenticated; select set_config('request.jwt.claim.sub','${user}',true);`;
  try {
    await execute(`begin;
      insert into auth.users(id,email) values('${user}','${user}@example.test');
      insert into public.languages(id,code,name,native_name) values
      ('${target}','zz-${target.slice(0, 23)}','Test target','Test target'),
      ('${reference}','zz-${reference.slice(0, 23)}','Test reference','Test reference');
      select set_config('request.jwt.claim.sub','${user}',true);
      select public.complete_onboarding('v2_${user.replaceAll('-', '').slice(0, 20)}','${reference}','${target}','C2','UTC');
      ${concepts
        .map(
          (
            c,
          ) => `insert into public.vocabulary_concepts(id,concept_key,category,is_photographable) values('${c}','V2_${c.replaceAll('-', '').toUpperCase()}','test',true);
      insert into public.vocabulary_terms(concept_id,language_id,term,cefr_level,part_of_speech) values
      ('${c}','${target}','test target','B2','noun'),('${c}','${reference}','test reference','A1','noun');`,
        )
        .join('\n')}
      commit;`);
    const first = query(
      `begin; ${claim} select public.get_or_create_today_challenge(); select 'AUDIT_LOCKED'; select pg_sleep(1); commit;`,
    );
    assert.equal(await first.ready, true);
    const second = query(`begin; ${claim} select public.get_or_create_today_challenge(); commit;`);
    for (const result of await Promise.all([first.result, second.result]))
      assert.equal(result.code, 0, result.error);
    const challenge = await execute(
      `select id from public.daily_challenges where user_id='${user}';`,
    );
    const ids = (
      await execute(
        `select id from public.daily_challenge_words where daily_challenge_id='${challenge}' order by slot;`,
      )
    ).split('\n');
    assert.equal(ids.length, 3);
    const replace = query(
      `begin; ${claim} select public.replace_daily_challenge_word('${ids[0]}'); select 'AUDIT_LOCKED'; select pg_sleep(1); commit;`,
    );
    assert.equal(await replace.ready, true);
    const competing = query(
      `begin; ${claim} select public.replace_daily_challenge_word('${ids[1]}'); commit;`,
    );
    for (const result of await Promise.all([replace.result, competing.result]))
      assert.equal(result.code, 0, result.error);
    assert.equal(
      await execute(
        `select count(*)||':'||count(distinct concept_id)||':'||count(*) filter(where replaced_at is null)||':'||bool_and(cefr_level='B2') from public.daily_challenge_words where daily_challenge_id='${challenge}';`,
      ),
      '5:5:3:true',
    );
    console.log(
      'PASS: concurrent C2 fallback generation/replacement preserves three distinct actual-B2 cards',
    );
  } finally {
    await execute(`delete from auth.users where id='${user}';
      delete from public.vocabulary_terms where concept_id in(${concepts.map((c) => `'${c}'`).join(',')});
      delete from public.vocabulary_concepts where id in(${concepts.map((c) => `'${c}'`).join(',')});
      delete from public.languages where id in('${target}','${reference}');`);
  }
}
