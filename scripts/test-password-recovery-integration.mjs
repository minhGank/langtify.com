// Local Auth only. Email contents, codes, tokens and passwords stay in memory.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localApi } from './lib/local-api.mjs';
const api = localApi();
const mailbox = `recovery-${randomUUID()}`;
const email = `${mailbox}@example.test`;
const password = randomUUID();
const replacement = randomUUID();
const storage = new Map();
const client = api.client({
  flowType: 'pkce',
  persistSession: true,
  storageKey: mailbox,
  storage: {
    getItem: async (key) => storage.get(key) ?? null,
    setItem: async (key, value) => {
      storage.set(key, value);
    },
    removeItem: async (key) => {
      storage.delete(key);
    },
  },
  detectSessionInUrl: false,
});
const login = api.client();
let user;
let messageIds = [];
try {
  const created = await api.admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ifError(created.error);
  user = created.data.user.id;
  assert.ifError(
    (await client.auth.resetPasswordForEmail(email, { redirectTo: 'langtify://auth/callback' }))
      .error,
  );
  let messages = [];
  for (let attempt = 0; attempt < 30; attempt++) {
    const response = await fetch(
      `http://127.0.0.1:54324/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    assert.equal(response.status, 200, 'Local mail capture unavailable');
    messages = (await response.json()).messages;
    messageIds = messages.map((message) => message.ID);
    if (messages.length) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(messages.length, 'Local recovery email must arrive');
  const message = await (
    await fetch(`http://127.0.0.1:54324/api/v1/message/${messages.at(-1).ID}`)
  ).json();
  const text = `${message.Text}\n${message.HTML}`;
  const match = text.match(/https?:\/\/[^\s"<>]+\/auth\/v1\/verify\?[^\s"<>]+/);
  assert.ok(match, 'Recovery confirmation URL must be present');
  const verification = new URL(match[0].replaceAll('&amp;', '&'));
  // Local mail may use localhost, never allow a hosted fixture request.
  assert.ok(['localhost', '127.0.0.1'].includes(verification.hostname));
  const response = await fetch(verification, { redirect: 'manual' });
  const location = response.headers.get('location');
  assert.ok(location, 'Recovery verification must redirect');
  const code = new URL(location).searchParams.get('code');
  assert.ok(code, 'PKCE recovery must issue an authorization code');
  let recoveryEvent = false;
  const { data: listener } = client.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') recoveryEvent = true;
  });
  const exchanged = await client.auth.exchangeCodeForSession(code);
  assert.ok(!exchanged.error, 'Recovery code exchange must succeed');
  assert.equal(exchanged.data.redirectType, 'recovery');
  assert.equal(recoveryEvent, true);
  assert.ok(
    (await client.auth.updateUser({ password: 'short' })).error,
    'Existing password policy must hold',
  );
  assert.ifError((await client.auth.updateUser({ password: replacement })).error);
  assert.equal(
    (await login.auth.signInWithPassword({ email, password })).error?.code,
    'invalid_credentials',
  );
  assert.ifError((await login.auth.signInWithPassword({ email, password: replacement })).error);
  assert.ok((await client.auth.exchangeCodeForSession(code)).error, 'Used recovery code must fail');
  listener.subscription.unsubscribe();
  console.log(
    'PASS: real local recovery email, PKCE exchange/event, password policy, password update, new-password login and replay denial',
  );
} finally {
  if (user) assert.ifError((await api.admin.auth.admin.deleteUser(user)).error);
  await client.auth.dispose();
  await login.auth.dispose();
  if (messageIds.length)
    await fetch('http://127.0.0.1:54324/api/v1/messages', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ IDs: messageIds }),
    });
}
