// Local-only Auth fixture. Codes/tokens stay in memory and never enter output.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export async function testEmailCodes(api) {
  assert.equal(api.url, 'http://127.0.0.1:54321');
  const owned = new Set();
  const clients = [];
  const client = () => {
    const value = api.client();
    clients.push(value);
    return value;
  };
  function sql(userId, statement) {
    assert.ok(owned.has(userId) && /^[a-f0-9-]{36}$/.test(userId));
    execFileSync(
      'docker',
      [
        'exec',
        '-i',
        'supabase_db_langtify',
        'psql',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        statement,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
  }
  try {
    const address = `email-code-${randomUUID()}@example.test`;
    const password = randomUUID();
    const pending = await client().auth.signUp({ email: address, password });
    assert.ifError(pending.error);
    assert.equal(pending.data.session, null);
    const userId = pending.data.user.id;
    owned.add(userId);
    assert.equal(pending.data.user.email_confirmed_at, undefined);
    const unconfirmed = await client().auth.signInWithPassword({ email: address, password });
    assert.equal(unconfirmed.error?.code, 'email_not_confirmed');
    // Use real Auth's token generator, not a bypass or a known test OTP. This is
    // a local fixture API only; the app never has administrative authority.
    const issued = await api.admin.auth.admin.generateLink({
      type: 'signup',
      email: address,
      password,
    });
    assert.ifError(issued.error);
    const token = issued.data.properties.email_otp;
    assert.ok(/^[0-9]{6,10}$/.test(token), 'Auth must supply its configured numeric code');
    const wrong = token.slice(0, -1) + String((Number(token.at(-1)) + 1) % 10);
    const invalid = await client().auth.verifyOtp({ email: address, token: wrong, type: 'signup' });
    assert.equal(invalid.error?.code, 'otp_expired');
    const verified = await client().auth.verifyOtp({ email: address, token, type: 'signup' });
    assert.ifError(verified.error);
    assert.ok(verified.data.session && verified.data.user.email_confirmed_at);
    assert.equal(verified.data.user.id, userId);
    const replay = await client().auth.verifyOtp({ email: address, token, type: 'signup' });
    assert.equal(replay.error?.code, 'otp_expired');
    const login = await client().auth.signInWithPassword({ email: address, password });
    assert.ifError(login.error);
    assert.equal(login.data.user.id, userId);
    const profile = await api.admin
      .from('profiles')
      .select('id,onboarding_completed_at')
      .eq('id', userId);
    assert.ifError(profile.error);
    assert.equal(profile.data.length, 1);
    assert.equal(profile.data[0].onboarding_completed_at, null);
    console.log(
      'PASS: email signup code, wrong/replayed code denial, one incomplete profile and password sign-in',
    );

    const expiredAddress = `expired-code-${randomUUID()}@example.test`;
    const expired = await api.admin.auth.admin.generateLink({
      type: 'signup',
      email: expiredAddress,
      password,
    });
    assert.ifError(expired.error);
    const expiredId = expired.data.user.id;
    owned.add(expiredId);
    sql(
      expiredId,
      `update auth.users set confirmation_sent_at = now() - interval '2 days' where id = '${expiredId}'`,
    );
    const expiredAttempt = await client().auth.verifyOtp({
      email: expiredAddress,
      token: expired.data.properties.email_otp,
      type: 'signup',
    });
    assert.equal(expiredAttempt.error?.code, 'otp_expired');
    assert.ifError((await client().auth.resend({ type: 'signup', email: expiredAddress })).error);
    console.log('PASS: server-expired code denial and supported signup resend');

    // A confirmed Google-origin fixture has one Google identity and no password.
    const googleEmail = `google-code-${randomUUID()}@example.test`;
    const google = await api.admin.auth.admin.createUser({
      email: googleEmail,
      email_confirm: true,
      app_metadata: { provider: 'google', providers: ['google'] },
    });
    assert.ifError(google.error);
    const googleId = google.data.user.id;
    owned.add(googleId);
    sql(
      googleId,
      `begin;
      delete from auth.identities where user_id = '${googleId}';
      insert into auth.identities (id,user_id,provider_id,provider,identity_data,created_at,updated_at)
      values (gen_random_uuid(),'${googleId}','qa25-${googleId}','google',jsonb_build_object('sub','qa25-${googleId}','email','${googleEmail}','email_verified',true),now(),now());
      commit;`,
    );
    const obscured = await client().auth.signUp({ email: googleEmail, password });
    // Confirm-phone/autoconfirm configuration changes Supabase's response shape.
    // Both documented shapes must be normalized to the same app confirmation UI.
    if (obscured.error) assert.equal(obscured.error.code, 'user_already_exists');
    else assert.equal(obscured.data.user.identities.length, 0);
    assert.equal(obscured.data.session, null);
    const after = await api.admin.auth.admin.getUserById(googleId);
    assert.ifError(after.error);
    assert.deepEqual(
      after.data.user.identities.map((identity) => identity.provider),
      ['google'],
    );
    const profiles = await api.admin.from('profiles').select('id').eq('id', googleId);
    assert.ifError(profiles.error);
    assert.equal(profiles.data.length, 1);
    const fakePassword = await client().auth.signInWithPassword({ email: googleEmail, password });
    assert.equal(fakePassword.error?.code, 'invalid_credentials');
    console.log(
      'PASS: Google-origin signup is obscured and cannot attach a caller password or another identity',
    );
  } finally {
    for (const id of owned) assert.ifError((await api.admin.auth.admin.deleteUser(id)).error);
    await Promise.all(clients.map((value) => value.auth.dispose()));
  }
}
