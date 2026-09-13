import {
  OAuthCoordinator,
  type OAuthPorts,
  type PendingLogin,
} from '@/features/auth/oauth/coordinator';
import { callbackCode, validateAuthorizeUrl } from '@/features/auth/oauth/callback';
import { makeOAuthSession as makeSession } from './fixtures';

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const redirect = 'langtify://auth/callback';
const callback = `${redirect}?code=valid-code-12345`;
const apiUrl = 'https://auth.example.test';
const authorization = `${apiUrl}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirect)}&code_challenge_method=s256&code_challenge=${'a'.repeat(43)}`;
async function flush() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}
function fixture() {
  let saved: PendingLogin | null = null;
  let nextId = 0;
  const browser = deferred<{ type: string; url?: string }>();
  const exchange = jest.fn().mockResolvedValue(makeSession());
  const authorize = jest.fn().mockResolvedValue({ url: authorization, flowId: 'flow-12345' });
  const clear = jest.fn().mockResolvedValue(undefined);
  const install = jest
    .fn<ReturnType<OAuthPorts['install']>, Parameters<OAuthPorts['install']>>()
    .mockImplementation(async (_session, current, finish) => {
      if (current()) await finish();
    });
  const ports: OAuthPorts = {
    apiUrl,
    redirect: () => redirect,
    randomId: () => `attempt-${++nextId}`,
    now: () => 1000000,
    read: jest.fn(async () => saved),
    write: jest.fn(async (pending) => {
      saved = pending;
    }),
    remove: jest.fn(async (id) => {
      if (saved?.id === id) saved = null;
    }),
    attempt: () => ({ authorize, exchange, clear }),
    session: jest.fn().mockResolvedValue(null),
    install,
    browser: jest.fn(() => browser.promise),
    dismiss: jest.fn(),
  };
  const coordinator = new OAuthCoordinator(ports);
  return { coordinator, ports, browser, authorize, exchange, install, clear, saved: () => saved };
}
it('launches one Google authorization for repeated taps, admits success, and rejects replay', async () => {
  const f = fixture();
  const start = f.coordinator.start();
  await f.coordinator.start();
  await flush();
  expect(f.authorize).toHaveBeenCalledTimes(1);
  expect(f.ports.browser).toHaveBeenCalledWith(authorization, redirect);
  f.browser.resolve({ type: 'success', url: callback });
  await start;
  expect(f.exchange).toHaveBeenCalledWith('valid-code-12345', 'flow-12345');
  expect(f.install).toHaveBeenCalledTimes(1);
  expect(f.saved()).toBeNull();
  await f.coordinator.receive(callback);
  expect(f.exchange).toHaveBeenCalledTimes(1);
});
it('restores a pending cold-start callback and deduplicates simultaneous link/browser delivery', async () => {
  const f = fixture();
  void f.coordinator.start();
  await flush();
  const cold = new OAuthCoordinator(f.ports);
  await Promise.all([cold.receive(callback), cold.receive(callback)]);
  expect(f.exchange).toHaveBeenCalledTimes(1);
  expect(f.install).toHaveBeenCalledTimes(1);
});
it.each(['cancel', 'dismiss'])(
  'handles browser %s without a session and supports retry',
  async (type) => {
    const f = fixture();
    const start = f.coordinator.start();
    await flush();
    f.browser.resolve({ type });
    await start;
    expect(f.install).not.toHaveBeenCalled();
    expect(f.saved()).toBeNull();
    expect(f.coordinator.snapshot().message).toMatch(/cancelled/);
    await f.coordinator.start();
    expect(f.authorize).toHaveBeenCalledTimes(2);
  },
);
it.each([
  `${redirect}?error=access_denied&error_description=secret-provider-details`,
  `${redirect}?code=short`,
  `${redirect}?code=valid-code-12345&code=another-code`,
  `${redirect}#access_token=private-token`,
  `${redirect}?access_token=private-token`,
  redirect,
  `${redirect}?code=valid-code-12345&redirect_to=https://evil.test`,
])('safely rejects invalid/provider-error callback %s', async (url) => {
  const f = fixture();
  void f.coordinator.start();
  await flush();
  await f.coordinator.receive(url);
  expect(f.exchange).not.toHaveBeenCalled();
  expect(f.install).not.toHaveBeenCalled();
  expect(f.coordinator.snapshot().message).toBe(
    'Google sign-in could not be completed. Please try again.',
  );
});
it.each(['https://evil.test/auth/callback', 'langtify://evil/callback', 'langtify://auth/other'])(
  'ignores injected links %s without consuming a valid attempt',
  async (url) => {
    const f = fixture();
    void f.coordinator.start();
    await flush();
    await f.coordinator.receive(url);
    expect(f.saved()?.phase).toBe('waiting');
    expect(f.exchange).not.toHaveBeenCalled();
    await f.coordinator.receive(callback);
    expect(f.install).toHaveBeenCalledTimes(1);
  },
);
it('rejects an unexpected browser return without leaving controls stuck', async () => {
  const f = fixture();
  const start = f.coordinator.start();
  await flush();
  f.browser.resolve({ type: 'success', url: 'https://evil.test/?code=valid-code-12345' });
  await start;
  expect(f.coordinator.snapshot().busy).toBe(false);
  expect(f.install).not.toHaveBeenCalled();
});
it.each([1000000 + 600001, 999999])('rejects expired/future pending records at %s', async (now) => {
  const f = fixture();
  void f.coordinator.start();
  await flush();
  f.ports.now = () => now;
  await f.coordinator.receive(callback);
  expect(f.exchange).not.toHaveBeenCalled();
});
it.each(['cancel', 'accountChanged', 'releaseScreen'] as const)(
  '%s before callback invalidates the attempt',
  async (action) => {
    const f = fixture();
    void f.coordinator.start();
    await flush();
    await f.coordinator[action]();
    await flush();
    await f.coordinator.receive(callback);
    expect(f.install).not.toHaveBeenCalled();
    expect(f.exchange).not.toHaveBeenCalled();
  },
);
it('allows the auth screen to unmount for its legitimate callback route', async () => {
  const f = fixture();
  void f.coordinator.start();
  await flush();
  const result = f.coordinator.receive(callback);
  f.coordinator.releaseScreen();
  await result;
  expect(f.install).toHaveBeenCalledTimes(1);
});
it('rejects a session exchanged after account switching', async () => {
  const f = fixture();
  const exchange = deferred<ReturnType<typeof makeSession>>();
  f.exchange.mockReturnValue(exchange.promise);
  void f.coordinator.start();
  await flush();
  const done = f.coordinator.receive(callback);
  await flush();
  f.coordinator.accountChanged();
  exchange.resolve(makeSession());
  await done;
  expect(f.install).not.toHaveBeenCalled();
});
it('invalidates installation already waiting in the auth mutation queue', async () => {
  const f = fixture();
  const gate = deferred<void>();
  let accepted = false;
  f.install.mockImplementation(async (_session, current, finish) => {
    await gate.promise;
    accepted = current();
    await finish();
  });
  void f.coordinator.start();
  await flush();
  const done = f.coordinator.receive(callback);
  await flush();
  await f.coordinator.cancel();
  gate.resolve();
  await done;
  expect(accepted).toBe(false);
});
it('does not let a callback override an existing account', async () => {
  const f = fixture();
  void f.coordinator.start();
  await flush();
  f.ports.session = async () => makeSession('second-user');
  await f.coordinator.receive(callback);
  expect(f.exchange).not.toHaveBeenCalled();
  expect(f.install).not.toHaveBeenCalled();
});
it('cancels cold-start records before receiving any callback', async () => {
  const f = fixture();
  void f.coordinator.start();
  await flush();
  const cold = new OAuthCoordinator(f.ports);
  await cold.cancel();
  await cold.receive(callback);
  expect(f.exchange).not.toHaveBeenCalled();
  expect(f.saved()).toBeNull();
});
it('does not exchange a callback whose durable claim survived a terminated process', async () => {
  const f = fixture();
  void f.coordinator.start();
  await flush();
  const pending = f.saved();
  if (!pending) throw new Error('Expected pending login');
  await f.ports.write({ ...pending, phase: 'exchanging' });
  await new OAuthCoordinator(f.ports).receive(callback);
  expect(f.exchange).not.toHaveBeenCalled();
});
it('does not launch after cancellation during authorization or leak the old verifier', async () => {
  const f = fixture();
  const auth = deferred<{ url: string; flowId: string }>();
  f.authorize.mockReturnValue(auth.promise);
  const start = f.coordinator.start();
  await flush();
  await f.coordinator.cancel();
  auth.resolve({ url: authorization, flowId: 'old-flow-123' });
  await start;
  expect(f.ports.browser).not.toHaveBeenCalled();
  expect(f.saved()).toBeNull();
});
it('requires a Google S256 authorization URL on the configured Supabase origin', () => {
  expect(validateAuthorizeUrl(authorization, apiUrl, redirect)).toBe(authorization);
  for (const url of [
    authorization.replace('s256', 'plain'),
    authorization.replace(apiUrl, 'https://evil.test'),
    authorization.replace('provider=google', 'provider=facebook'),
  ])
    expect(() => validateAuthorizeUrl(url, apiUrl, redirect)).toThrow();
  expect(() => callbackCode(`${redirect}?code=valid-code-12345#x`, redirect)).toThrow();
});
it('does not let a cancelled slow exchange swallow the callback for a newer login', async () => {
  const f = fixture();
  const old = deferred<ReturnType<typeof makeSession>>();
  f.exchange.mockReturnValueOnce(old.promise).mockResolvedValueOnce(makeSession('user-b'));
  void f.coordinator.start();
  await flush();
  const first = f.coordinator.receive(callback);
  await flush();
  await f.coordinator.cancel();
  void f.coordinator.start();
  await flush();
  await f.coordinator.receive(`${redirect}?code=second-valid-code`);
  expect(f.install).toHaveBeenCalledTimes(1);
  expect(f.install.mock.calls[0][0].user.id).toBe('user-b');
  old.resolve(makeSession());
  await first;
  expect(f.install).toHaveBeenCalledTimes(1);
  expect(f.saved()).toBeNull();
});
it('rejects server-invalid codes without exposing SDK details and allows a fresh attempt', async () => {
  const f = fixture();
  f.exchange.mockRejectedValueOnce(new Error('private token exchange details'));
  void f.coordinator.start();
  await flush();
  await f.coordinator.receive(callback);
  expect(f.install).not.toHaveBeenCalled();
  expect(f.coordinator.snapshot().message).toBe(
    'Google sign-in could not be completed. Please try again.',
  );
  void f.coordinator.start();
  await flush();
  await f.coordinator.receive(callback);
  expect(f.install).toHaveBeenCalledTimes(1);
});
it('does not create an attempt after cancellation while its initial record read is pending', async () => {
  const f = fixture();
  const read = deferred<PendingLogin | null>();
  f.ports.read = jest.fn().mockReturnValueOnce(read.promise).mockResolvedValue(null);
  const start = f.coordinator.start();
  await flush();
  await f.coordinator.cancel();
  read.resolve(null);
  await start;
  expect(f.authorize).not.toHaveBeenCalled();
  expect(f.ports.write).not.toHaveBeenCalled();
});
it('a failed pending-record deletion cannot resurrect a cancelled login after restart', async () => {
  const f = fixture();
  void f.coordinator.start();
  await flush();
  f.ports.remove = jest.fn().mockRejectedValue(new Error('Storage deletion failed'));
  await expect(f.coordinator.cancel()).rejects.toThrow();
  expect(f.saved()?.phase).toBe('cancelled');
  await new OAuthCoordinator(f.ports).receive(callback);
  expect(f.exchange).not.toHaveBeenCalled();
  expect(f.install).not.toHaveBeenCalled();
});
it('still removes a pending login when writing its cancellation tombstone fails', async () => {
  const f = fixture();
  void f.coordinator.start();
  await flush();
  f.ports.write = jest.fn().mockRejectedValue(new Error('Storage full'));
  await f.coordinator.cancel();
  expect(f.saved()).toBeNull();
  await new OAuthCoordinator(f.ports).receive(callback);
  expect(f.exchange).not.toHaveBeenCalled();
});
