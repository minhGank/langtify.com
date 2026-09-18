// Local-only deterministic contention fixture. Pauses the real scheduler after
// its first candidate so registration and send admission overlap the second.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execute, query } from './local-db.mjs';
import { setTimeout as delay } from 'node:timers/promises';
export async function notificationLockAudit(first, second, attempt) {
  const session = (await first.client.auth.getSession()).data.session;
  const claims = JSON.parse(Buffer.from(session.access_token.split('.')[1], 'base64url'));
  await execute(`
    update public.notification_preferences set next_check_at='2000-01-01' where user_id='${second.id}';
    update public.notification_preferences set next_check_at='2000-01-02' where user_id='${first.id}';
    create function private.notification_audit_pause() returns trigger language plpgsql set search_path='' as $$
    begin
      if new.user_id='${second.id}' and current_setting('application_name')='notification_audit_claim' then
        perform pg_advisory_xact_lock(101018099);
      end if;
      return new;
    end;$$;
    create trigger notification_audit_pause after update of next_check_at on public.notification_preferences for each row execute function private.notification_audit_pause();
  `);
  const pending = [];
  async function waiting(name) {
    for (let i = 0; i < 100; i++) {
      if (
        (await execute(
          `select exists(select 1 from pg_stat_activity where application_name='${name}' and wait_event_type='Lock');`,
        )) === 't'
      )
        return;
      await delay(20);
    }
    throw new Error(`Contention fixture failed to pause ${name}`);
  }
  try {
    const gate = query(
      `begin; set local application_name='notification_audit_gate'; select pg_advisory_xact_lock(101018099); select 'AUDIT_LOCKED'; select pg_sleep(15); commit;`,
    );
    pending.push(gate.result);
    assert(await gate.ready);
    const claim = query(
      `begin; set local application_name='notification_audit_claim'; select public.claim_notification_attempts(2)->>'failed'; commit;`,
    );
    pending.push(claim.result);
    await waiting('notification_audit_claim');
    // Move the second candidate's installation into the first processed user.
    const registration = query(`begin; set local application_name='notification_audit_registration';
      select set_config('request.jwt.claim.sub','${second.id}',true);
      select set_config('request.jwt.claims','${JSON.stringify({ sub: second.id, session_id: JSON.parse(Buffer.from((await second.client.auth.getSession()).data.session.access_token.split('.')[1], 'base64url')).session_id })}',true);
      set local role authenticated;
      select public.sync_push_installation('${first.binding.installation_id}','${first.binding.installation_secret}',2,'${first.binding.push_token}','ios'); commit;`);
    pending.push(registration.result);
    await waiting('notification_audit_registration');
    assert.equal(claims.sub, first.id);
    const authorize = query(
      `begin; set local application_name='notification_audit_authorize'; select public.authorize_notification_attempt('${attempt.id}'); commit;`,
    );
    pending.push(authorize.result);
    await waiting('notification_audit_authorize');
    await execute(
      `select pg_cancel_backend(pid) from pg_stat_activity where application_name='notification_audit_gate';`,
    );
    const results = await Promise.all([claim.result, registration.result, authorize.result]);
    for (const result of results) assert.equal(result.code, 0, result.error);
    assert(
      results[0].output.split('\n').includes('0'),
      'Scheduler must not swallow a deadlock as a preparation failure',
    );
  } finally {
    await execute(
      `select pg_cancel_backend(pid) from pg_stat_activity where application_name='notification_audit_gate';`,
    );
    await Promise.allSettled(pending);
    await execute(
      `drop trigger notification_audit_pause on public.notification_preferences; drop function private.notification_audit_pause();`,
    );
  }
}
