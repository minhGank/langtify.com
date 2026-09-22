import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localApi } from './lib/local-api.mjs';
import { authSessionId } from '../src/lib/auth-session-storage.ts';
import { validateSignupPassword } from '../src/features/auth/password-policy.ts';

const api = localApi();
const email = `oauth-audit-${randomUUID()}@example.test`;
const password = randomUUID() + randomUUID();
const first = api.client(),
  second = api.client();
let userId;
try {
  const created = await api.admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ifError(created.error);
  userId = created.data.user.id;
  const login = await first.auth.signInWithPassword({ email, password });
  assert.ifError(login.error);
  const sessionId = authSessionId(login.data.session.access_token);
  assert.ok(sessionId, 'Local Supabase must issue an Auth session_id');
  const refreshed = await first.auth.refreshSession();
  assert.ifError(refreshed.error);
  assert.equal(authSessionId(refreshed.data.session.access_token), sessionId);
  const again = await second.auth.signInWithPassword({ email, password });
  assert.ifError(again.error);
  assert.equal(again.data.user.id, userId);
  assert.notEqual(authSessionId(again.data.session.access_token), sessionId);
  console.log(
    'PASS: real Auth session identity survives refresh and distinguishes repeated login to the same user',
  );

  const profile = await second
    .from('profiles')
    .select('id,username,onboarding_completed_at')
    .eq('id', userId);
  assert.ifError(profile.error);
  assert.equal(profile.data.length, 1);
  assert.equal(profile.data[0].username, null);
  assert.equal(profile.data[0].onboarding_completed_at, null);
  assert.ifError((await first.auth.signOut({ scope: 'local' })).error);
  const other = await second.auth.refreshSession();
  assert.ifError(other.error);
  assert.equal(other.data.user.id, userId);
  console.log(
    'PASS: repeated password login retains one incomplete profile; signing out an older session preserves the newer session',
  );

  // Exercise real Auth's shared password-strength check without creating extra
  // signup emails. This is the fixture's own current authenticated session.
  for (const candidate of ['abcde', 'a'.repeat(73), '📷'.repeat(19)]) {
    assert.ok(validateSignupPassword(candidate));
    const rejected = await second.auth.updateUser({ password: candidate });
    assert.ok(rejected.error, 'Auth must reject a password outside its byte bounds');
    assert.ok(['weak_password', 'validation_failed'].includes(rejected.error.code));
  }
  for (const candidate of ['abcdef', '語語', '📷'.repeat(18)]) {
    assert.equal(validateSignupPassword(candidate), undefined);
    assert.ifError((await second.auth.updateUser({ password: candidate })).error);
  }
  console.log(
    'PASS: actual Auth policy matches signup guidance at the 6/72 UTF-8 byte boundaries without invented character classes',
  );
} finally {
  if (userId) assert.ifError((await api.admin.auth.admin.deleteUser(userId)).error);
  await Promise.all([first.auth.dispose(), second.auth.dispose(), api.admin.auth.dispose()]);
}
