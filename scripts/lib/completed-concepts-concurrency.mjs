// Local SQL lifecycle fixtures, complementing the real-byte photo integration suite.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execute, query } from './local-db.mjs';

export async function testCompletedConceptConcurrency() {
  for (const mode of ['generation', 'replacement', 'repeatable-read']) {
    const user = randomUUID(),
      language = randomUUID();
    const concepts = Array.from({ length: 4 }, () => randomUUID());
    const terms = concepts.map(() => randomUUID());
    const prior = randomUUID(),
      today = randomUUID(),
      word = randomUUID();
    const claim = `set local role authenticated; select set_config('request.jwt.claim.sub','${user}',true);`;
    try {
      await execute(`begin;
        insert into auth.users(id,email) values('${user}','${user}@example.test');
        insert into public.languages(id,code,name,native_name) values('${language}','zz-${user.slice(0, 23)}','Fixture','Fixture');
        select set_config('request.jwt.claim.sub','${user}',true);
        select public.complete_onboarding('cc_${user.replaceAll('-', '').slice(0, 20)}','00000000-0000-4000-8000-000000000001','${language}','A1','UTC');
        ${concepts
          .map(
            (
              id,
              i,
            ) => `insert into public.vocabulary_concepts(id,concept_key,category,is_photographable) values('${id}','CONCURRENT_${id.replaceAll('-', '').toUpperCase()}','test',true);
          insert into public.vocabulary_terms(id,concept_id,language_id,term,cefr_level,part_of_speech) values('${terms[i]}','${id}','${language}','Fixture','${i === 3 ? 'A2' : 'A1'}','noun');
          insert into public.vocabulary_terms(concept_id,language_id,term,cefr_level,part_of_speech) values('${id}','00000000-0000-4000-8000-000000000001','Fixture','A1','noun');`,
          )
          .join('\n')}
        insert into public.daily_challenges(id,user_id,user_language_profile_id,created_at)
          select '${prior}',user_id,id,clock_timestamp()-interval '2 days' from public.user_language_profiles where user_id='${user}';
        insert into public.daily_challenge_words(id,daily_challenge_id,slot,cefr_level,vocabulary_term_id) values
          ('${word}','${prior}','review','A1','${terms[0]}'),
          (gen_random_uuid(),'${prior}','target','A1','${terms[1]}'),
          (gen_random_uuid(),'${prior}','stretch','A2','${terms[3]}');
        ${
          mode === 'replacement'
            ? `insert into public.daily_challenges(id,user_id,user_language_profile_id)
          select '${today}',user_id,id from public.user_language_profiles where user_id='${user}';
          insert into public.daily_challenge_words(daily_challenge_id,slot,cefr_level,vocabulary_term_id) values
            ('${today}','review','A1','${terms[1]}'),('${today}','target','A1','${terms[2]}'),('${today}','stretch','A2','${terms[3]}');`
            : `update public.vocabulary_terms set is_active=false where id='${terms[2]}';`
        }
        select public.reserve_historical_submission('${word}');
        insert into storage.objects(bucket_id,name,owner_id,version,metadata)
          select 'challenge-submissions',storage_path,user_id::text,'concurrent-fixture','{"mimetype":"image/jpeg","size":100}' from public.submissions where daily_challenge_word_id='${word}';
        select public.attest_submission_photo(s.id,s.user_id,o.id,o.version,repeat('a',64),16,16)
          from public.submissions s join storage.objects o on o.name=s.storage_path where s.daily_challenge_word_id='${word}';
        commit;`);
      const submission = await execute(
        `select id from public.submissions where daily_challenge_word_id='${word}';`,
      );
      const replace =
        mode === 'replacement'
          ? await execute(
              `select id from public.daily_challenge_words where daily_challenge_id='${today}' and slot='review';`,
            )
          : null;
      const writer = query(
        `begin; ${claim} select public.finalize_submission('${submission}'); select 'AUDIT_LOCKED'; select pg_sleep(1); commit;`,
      );
      assert.equal(await writer.ready, true, 'Finalization must hold its owner lock');
      const reader =
        query(`begin ${mode === 'repeatable-read' ? 'isolation level repeatable read' : ''}; ${claim}
        select count(*) from public.daily_challenges;
        select ${replace ? `public.replace_daily_challenge_word('${replace}')` : 'public.get_or_create_today_challenge()'}; commit;`);
      const [finalized, selection] = await Promise.all([writer.result, reader.result]);
      assert.equal(finalized.code, 0, finalized.error);
      assert.notEqual(
        selection.code,
        0,
        'Selection must never reuse the concurrently completed concept',
      );
      assert.match(
        selection.error,
        mode === 'repeatable-read' ? /40001/ : /insufficient_vocabulary/,
      );
      assert.equal(
        await execute(
          `select count(*) from private.completed_concepts where user_id='${user}' and concept_id='${concepts[0]}';`,
        ),
        '1',
      );
      assert.equal(
        await execute(`select count(*) from public.daily_challenges where user_id='${user}';`),
        mode === 'replacement' ? '2' : '1',
        'Exhaustion/serialization failure must roll back partial generation',
      );
      if (replace)
        assert.equal(
          await execute(
            `select replaced_at is null from public.daily_challenge_words where id='${replace}';`,
          ),
          't',
        );
      console.log(
        `PASS: ${mode} cannot select a concurrently finalized concept; failure is atomic`,
      );
    } finally {
      await execute(`begin; select set_config('request.jwt.claim.sub','${user}',true);
        select public.begin_submission_deletion(id) from public.submissions where user_id='${user}' and status<>'deleted';
        set local storage.allow_delete_query='true';
        delete from storage.objects where owner_id='${user}';
        select public.finish_submission_deletion(id) from public.submissions where user_id='${user}' and status='deleting';
        delete from auth.users where id='${user}';
        delete from public.vocabulary_terms where concept_id in(${concepts.map((id) => `'${id}'`).join(',')});
        delete from public.vocabulary_concepts where id in(${concepts.map((id) => `'${id}'`).join(',')});
        delete from public.languages where id='${language}';commit;`);
    }
  }
}
