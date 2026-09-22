import assert from 'node:assert/strict';
import { execute } from './local-db.mjs';

// Model an upload reserved when its assignment was current, then recovered later.
// This is exclusively a local test fixture: the real reservation/date guard runs
// under that earlier database clock, and the exact production clock definition is
// restored BEFORE commit. Other sessions cannot observe the temporary definition.
// ON_ERROR_STOP and connection teardown roll the entire transaction back on error.
// Never disable authority triggers, mutate assignment snapshots or commit a clock.
export async function reservePriorDailyFixture(ownerId, assignmentId) {
  for (const id of [ownerId, assignmentId]) assert.match(id, /^[0-9a-f-]{36}$/);
  await execute(`begin;
    select set_config('request.jwt.claim.sub','${ownerId}',true);
    do $fixture$
    declare original text; stamp timestamptz;
    begin
      select pg_get_functiondef('private.progress_time()'::regprocedure) into strict original;
      select (c.local_challenge_date+time '12:00') at time zone l.timezone into strict stamp
        from public.daily_challenge_words w
        join public.daily_challenges c on c.id=w.daily_challenge_id
        join public.user_language_profiles l on l.user_id=c.user_id
        where w.id='${assignmentId}' and c.user_id='${ownerId}';
      begin
        execute format('create or replace function private.progress_time() returns timestamptz language sql volatile set search_path='''' as %L',
          format('select %L::timestamptz',stamp));
        perform public.reserve_submission('${assignmentId}');
        execute original;
      exception when others then
        execute original;
        raise;
      end;
      if pg_get_functiondef('private.progress_time()'::regprocedure)<>original then
        raise exception 'Fixture did not restore the production clock';
      end if;
    end;
    $fixture$;
    commit;`);
}
