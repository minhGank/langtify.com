import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useSessionState, type SessionGateway } from '@/features/auth/use-session-state';
import type { Account } from '@/services/account';
import { makeAccount, makeSession } from './fixtures';

function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error('Not initialized');
  };
  let reject: (error: Error) => void = () => {
    throw new Error('Not initialized');
  };
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function gatewayFixture() {
  let listener: (session: Session | null, event: AuthChangeEvent) => void = () => {};
  const unsubscribe = jest.fn();
  const restore = jest.fn<Promise<Session | null>, []>().mockResolvedValue(makeSession());
  const load = jest
    .fn<Promise<Account>, [string]>()
    .mockImplementation(async (id) => makeAccount(id));
  const gateway: SessionGateway = {
    restore,
    loadAccount: load,
    subscribe: (callback) => {
      listener = callback;
      return unsubscribe;
    },
  };
  return {
    gateway,
    restore,
    load,
    unsubscribe,
    emit: (
      session: Session | null,
      event: AuthChangeEvent = session ? 'SIGNED_IN' : 'SIGNED_OUT',
    ) => listener(session, event),
  };
}
it('blocks navigation while restoring and validates the restored account', async () => {
  const fixture = gatewayFixture();
  const pending = deferred<Session | null>();
  fixture.restore.mockReturnValue(pending.promise);
  const { result } = renderHook(() => useSessionState(fixture.gateway));
  expect(result.current.status).toBe('loading');
  await act(async () => pending.resolve(makeSession()));
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(fixture.load).toHaveBeenCalledWith(makeSession().user.id);
});
it('restores a signed-out state without loading account data', async () => {
  const fixture = gatewayFixture();
  fixture.restore.mockResolvedValue(null);
  const { result } = renderHook(() => useSessionState(fixture.gateway));
  await waitFor(() => expect(result.current.status).toBe('signed-out'));
  expect(fixture.load).not.toHaveBeenCalled();
});
it('routes missing or partial onboarding back to setup', async () => {
  const fixture = gatewayFixture();
  fixture.load.mockResolvedValue({ profile: null, learning: null, languages: [] });
  const { result } = renderHook(() => useSessionState(fixture.gateway));
  await waitFor(() => expect(result.current.status).toBe('onboarding'));
});
it('does not interpret a network failure as completed onboarding and supports retry', async () => {
  const fixture = gatewayFixture();
  fixture.load.mockRejectedValueOnce(new Error('network'));
  const { result } = renderHook(() => useSessionState(fixture.gateway));
  await waitFor(() => expect(result.current.status).toBe('error'));
  act(() => result.current.reload());
  await waitFor(() => expect(result.current.status).toBe('ready'));
});
it('supports retry after session storage/restore errors', async () => {
  const fixture = gatewayFixture();
  fixture.restore.mockRejectedValueOnce(new Error('storage'));
  const { result } = renderHook(() => useSessionState(fixture.gateway));
  await waitFor(() => expect(result.current.status).toBe('error'));
  act(() => result.current.reload());
  await waitFor(() => expect(result.current.status).toBe('ready'));
});
it('sign-out wins over a slow startup session read', async () => {
  const fixture = gatewayFixture();
  const pending = deferred<Session | null>();
  fixture.restore.mockReturnValue(pending.promise);
  const { result } = renderHook(() => useSessionState(fixture.gateway));
  act(() => fixture.emit(null));
  await act(async () => pending.resolve(makeSession()));
  expect(result.current.status).toBe('signed-out');
  expect(result.current.account).toBeNull();
});
it('sign-out invalidates an in-flight profile load', async () => {
  const fixture = gatewayFixture();
  const pending = deferred<Account>();
  fixture.load.mockReturnValue(pending.promise);
  const { result } = renderHook(() => useSessionState(fixture.gateway));
  await waitFor(() => expect(fixture.load).toHaveBeenCalled());
  act(() => fixture.emit(null));
  await act(async () => pending.resolve(makeAccount()));
  expect(result.current.status).toBe('signed-out');
  expect(result.current.account).toBeNull();
});
it('cannot restore stale account data after switching users', async () => {
  const fixture = gatewayFixture();
  const pending = deferred<Account>();
  fixture.load.mockReturnValueOnce(pending.promise);
  const { result, unmount } = renderHook(() => useSessionState(fixture.gateway));
  await waitFor(() => expect(fixture.load).toHaveBeenCalledTimes(1));
  act(() => fixture.emit(makeSession('second-user')));
  await waitFor(() => expect(result.current.status).toBe('ready'));
  await act(async () => pending.resolve(makeAccount()));
  expect(result.current.account?.profile?.id).toBe('second-user');
  unmount();
  expect(fixture.unsubscribe).toHaveBeenCalled();
});
it('shows configuration state without creating a fake session', () => {
  const { result } = renderHook(() => useSessionState(null));
  expect(result.current.status).toBe('unconfigured');
  expect(result.current.session).toBeNull();
});

it('does not treat INITIAL_SESSION(null) from a restore error as a sign-out', async () => {
  const fixture = gatewayFixture();
  const pending = deferred<Session | null>();
  fixture.restore.mockReturnValue(pending.promise);
  const { result } = renderHook(() => useSessionState(fixture.gateway));
  act(() => fixture.emit(null, 'INITIAL_SESSION'));
  await act(async () => pending.reject(new Error('Offline during restoration')));
  expect(result.current.status).toBe('error');
});
it('does not reset the onboarding screen while refreshing the same account', async () => {
  const fixture = gatewayFixture();
  const account = { ...makeAccount(), learning: null };
  fixture.load.mockResolvedValueOnce(account);
  const { result } = renderHook(() => useSessionState(fixture.gateway));
  await waitFor(() => expect(result.current.status).toBe('onboarding'));
  const pending = deferred<Account>();
  fixture.load.mockReturnValueOnce(pending.promise);
  act(() =>
    fixture.emit({ ...makeSession(), access_token: 'refreshed-test-token' }, 'TOKEN_REFRESHED'),
  );
  expect(result.current.status).toBe('onboarding');
  expect(result.current.account).toEqual(account);
  await act(async () => pending.resolve(account));
});
it('gives a synchronous auth event precedence over stale restoration', async () => {
  const fixture = gatewayFixture();
  fixture.gateway.subscribe = (listener) => {
    listener(null, 'SIGNED_OUT');
    return jest.fn();
  };
  const { result } = renderHook(() => useSessionState(fixture.gateway));
  await act(async () => {});
  expect(result.current.status).toBe('signed-out');
  expect(fixture.load).not.toHaveBeenCalled();
});
