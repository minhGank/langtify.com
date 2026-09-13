import { Platform } from 'react-native';
import { processLock } from '@supabase/supabase-js';
import { browserCoordination, type AuthLocks } from '@/features/auth/oauth/browser-coordination';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react-native';
import {
  coordinator,
  authMutation,
  restoreAuthSession,
  subscribeAuth,
} from '@/features/auth/oauth/runtime';
import { GoogleButton } from '@/features/auth/oauth/google-button';
import { useSessionState } from '@/features/auth/use-session-state';
import { makeAccount, makeSession, makeOAuthSession } from './fixtures';

let mockSession: Session | null = null;
let mockListener: (event: AuthChangeEvent, session: Session | null) => void = () => {};
const mockSetSession = jest.fn();
const mockSignOut = jest.fn();
const mockBrowser = jest.fn();
const mockExchange = jest.fn();
const mockAuthorize = jest.fn();
const mockClear = jest.fn();
const mockDismiss = jest.fn();
jest.mock('@/lib/env', () => ({
  publicConfig: { config: { url: 'https://auth.example.test', key: 'test-public-key' } },
}));
jest.mock('@/lib/supabase', () => ({
  requireSupabase: () => ({
    auth: {
      getSession: async () => ({ data: { session: mockSession }, error: null }),
      setSession: (...args: unknown[]) => mockSetSession(...args),
      signOut: (...args: unknown[]) => mockSignOut(...args),
      onAuthStateChange: (listener: typeof mockListener) => {
        mockListener = listener;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      },
    },
  }),
}));
jest.mock('expo-auth-session', () => ({ makeRedirectUri: () => 'langtify://auth/callback' }));
jest.mock('expo-crypto', () => ({ randomUUID: () => '10000000-0000-4000-8000-000000000001' }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { executionEnvironment: 'bare' },
  ExecutionEnvironment: { StoreClient: 'storeClient' },
}));
jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: (...args: unknown[]) => mockBrowser(...args),
  dismissAuthSession: () => mockDismiss(),
}));
jest.mock('@/features/auth/oauth/pkce-attempt', () => ({
  createOAuthAttempt: () => ({
    authorize: (...args: unknown[]) => mockAuthorize(...args),
    exchange: (...args: unknown[]) => mockExchange(...args),
    clear: () => mockClear(),
  }),
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const callback = 'langtify://auth/callback?code=valid-code-12345';
const google = () => ({
  ...makeOAuthSession(),
  user: {
    ...makeSession().user,
    app_metadata: { provider: 'google', providers: ['email', 'google'] },
    user_metadata: {
      full_name: 'Provider Name',
      username: 'untrusted-name',
      onboarding_completed_at: 'untrusted',
    },
  },
});
beforeEach(async () => {
  mockSession = null;
  await coordinator.cancel('');
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockAuthorize.mockResolvedValue({
    url:
      'https://auth.example.test/auth/v1/authorize?provider=google&redirect_to=langtify%3A%2F%2Fauth%2Fcallback&code_challenge_method=s256&code_challenge=' +
      'a'.repeat(43),
    flowId: 'flow-12345',
  });
  mockBrowser.mockReturnValue(new Promise(() => {}));
  mockExchange.mockResolvedValue(google());
  mockSetSession.mockImplementation(async () => {
    mockSession = google();
    mockListener('SIGNED_IN', mockSession);
    return { data: { session: mockSession }, error: null };
  });
  mockSignOut.mockImplementation(async () => {
    mockSession = null;
    mockListener('SIGNED_OUT', null);
    return { error: null };
  });
});
async function begin() {
  void coordinator.start();
  await waitFor(() => expect(mockBrowser).toHaveBeenCalledTimes(1));
}
it('holds foreground refresh behind interrupted-commit recovery on cold restoration', async () => {
  mockSession = google();
  await AsyncStorage.setItem(
    'langtify-oauth:https://auth.example.test:pending',
    JSON.stringify({
      id: '10000000-0000-4000-8000-000000000001',
      createdAt: Date.now(),
      redirect: 'langtify://auth/callback',
      phase: 'committing',
      candidateUserId: google().user.id,
    }),
  );
  const listener = jest.fn();
  const stop = subscribeAuth(listener);
  mockListener('TOKEN_REFRESHED', mockSession);
  expect(listener).not.toHaveBeenCalled();
  expect(await restoreAuthSession()).toBeNull();
  expect(listener.mock.calls.map(([event]) => event)).toEqual(['SIGNED_OUT']);
  stop();
});
it('renders a working Google button, disables repeated taps and cancels safely', async () => {
  const app = render(<GoogleButton />);
  fireEvent.press(app.getByRole('button', { name: 'Continue with Google' }));
  fireEvent.press(app.getByRole('button', { name: 'Continue with Google' }));
  await waitFor(() => expect(mockBrowser).toHaveBeenCalledTimes(1));
  expect(app.getByRole('button', { name: 'Continue with Google' })).toBeDisabled();
  fireEvent.press(app.getByRole('button', { name: 'Cancel Google sign-in' }));
  await app.findByText('Google sign-in cancelled.');
  expect(mockSetSession).not.toHaveBeenCalled();
  expect(app.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
});
it('unmounting the login screen rejects its later browser response', async () => {
  const browser = deferred<{ type: string; url: string }>();
  mockBrowser.mockReturnValue(browser.promise);
  const app = render(<GoogleButton />);
  fireEvent.press(app.getByRole('button', { name: 'Continue with Google' }));
  await waitFor(() => expect(mockBrowser).toHaveBeenCalled());
  app.unmount();
  await act(async () => {
    browser.resolve({ type: 'success', url: callback });
  });
  expect(mockSetSession).not.toHaveBeenCalled();
});
it.each([false, true])(
  'uses the existing authoritative onboarding gate (completed=%s), ignoring Google metadata',
  async (completed) => {
    const account = completed
      ? makeAccount()
      : {
          profile: { ...makeAccount().profile!, username: null, onboarding_completed_at: null },
          learning: null,
          languages: [],
        };
    const loadAccount = jest.fn().mockResolvedValue(account);
    const gateway = {
      restore: restoreAuthSession,
      subscribe: (listener: (session: Session | null, event: AuthChangeEvent) => void) =>
        subscribeAuth((event, session) => listener(session, event)),
      loadAccount,
    };
    const app = renderHook(() => useSessionState(gateway));
    await waitFor(() => expect(app.result.current.status).toBe('signed-out'));
    await begin();
    await act(async () => {
      await coordinator.receive(callback);
    });
    await waitFor(() => expect(app.result.current.status).toBe(completed ? 'ready' : 'onboarding'));
    expect(app.result.current.account).toBe(account);
    expect(loadAccount).toHaveBeenCalledWith(google().user.id);
    // Same UUID after another provider sign-in reads the same records; there is no creation/merge API.
    act(() => mockListener('SIGNED_IN', google()));
    await waitFor(() => expect(loadAccount).toHaveBeenCalledTimes(2));
    expect(app.result.current.account).toBe(account);
    await act(async () => {
      await authMutation(() => mockSignOut({ scope: 'local' }));
    });
    await waitFor(() => expect(app.result.current.status).toBe('signed-out'));
    expect(app.result.current.account).toBeNull();
  },
);
it('suppresses setSession events until admission and rolls back cancellation during setSession', async () => {
  const gate = deferred<void>();
  mockSetSession.mockImplementation(async () => {
    await gate.promise;
    mockSession = google();
    mockListener('SIGNED_IN', mockSession);
    return { data: { session: mockSession }, error: null };
  });
  const listener = jest.fn();
  const stop = subscribeAuth(listener);
  await begin();
  const done = coordinator.receive(callback);
  await waitFor(() => expect(mockSetSession).toHaveBeenCalled());
  await coordinator.cancel();
  gate.resolve();
  await done;
  expect(listener.mock.calls.some(([event]) => event === 'SIGNED_IN')).toBe(false);
  expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(mockSession).toBeNull();
  stop();
});
it('serializes a password account switch after an obsolete Google installation', async () => {
  const gate = deferred<void>();
  mockSetSession.mockImplementation(async () => {
    await gate.promise;
    mockSession = google();
    mockListener('SIGNED_IN', mockSession);
    return { data: { session: mockSession }, error: null };
  });
  const listener = jest.fn();
  const stop = subscribeAuth(listener);
  await begin();
  const done = coordinator.receive(callback);
  await waitFor(() => expect(mockSetSession).toHaveBeenCalled());
  const password = authMutation(async () => {
    mockSession = makeSession('user-b');
    mockListener('SIGNED_IN', mockSession);
  });
  gate.resolve();
  await Promise.all([done, password]);
  expect(mockSession?.user.id).toBe('user-b');
  expect(
    listener.mock.calls
      .filter(([event]) => event === 'SIGNED_IN')
      .map(([, session]) => session.user.id),
  ).toEqual(['user-b']);
  stop();
});
it('retains a interrupted-commit marker and quarantines a session when rollback fails, then recovers on restore', async () => {
  const gate = deferred<void>();
  mockSetSession.mockImplementation(async () => {
    await gate.promise;
    mockSession = google();
    mockListener('SIGNED_IN', mockSession);
    return { data: { session: mockSession }, error: null };
  });
  mockSignOut.mockResolvedValueOnce({ error: new Error('Network unavailable') });
  const listener = jest.fn();
  const stop = subscribeAuth(listener);
  await begin();
  const done = coordinator.receive(callback);
  await waitFor(() => expect(mockSetSession).toHaveBeenCalled());
  await coordinator.cancel();
  gate.resolve();
  await done;
  mockListener('TOKEN_REFRESHED', mockSession);
  expect(listener).not.toHaveBeenCalled();
  const key = 'langtify-oauth:https://auth.example.test:pending';
  expect(await AsyncStorage.getItem(key)).toContain('committing');
  expect(await restoreAuthSession()).toBeNull();
  expect(await AsyncStorage.getItem(key)).toBeNull();
  stop();
});
it('does not clear another account when restoring an interrupted Google commit', async () => {
  mockSession = makeSession('user-b');
  await AsyncStorage.setItem(
    'langtify-oauth:https://auth.example.test:pending',
    JSON.stringify({
      id: '10000000-0000-4000-8000-000000000001',
      createdAt: Date.now(),
      redirect: 'langtify://auth/callback',
      phase: 'committing',
      candidateUserId: google().user.id,
    }),
  );
  expect((await restoreAuthSession())?.user.id).toBe('user-b');
  expect(mockSignOut).not.toHaveBeenCalled();
});
it('removes a never-installed commit marker when another session appears before admission', async () => {
  mockExchange.mockImplementation(async () => {
    mockSession = makeSession('user-b');
    return google();
  });
  await begin();
  await coordinator.receive(callback);
  expect(mockSetSession).not.toHaveBeenCalled();
  expect(mockSession?.user.id).toBe('user-b');
  expect(await AsyncStorage.getItem('langtify-oauth:https://auth.example.test:pending')).toBeNull();
});
it('recovers a failed rollback before allowing password login to the same user', async () => {
  const gate = deferred<void>();
  mockSetSession.mockImplementation(async () => {
    await gate.promise;
    mockSession = google();
    mockListener('SIGNED_IN', mockSession);
    return { data: { session: mockSession }, error: null };
  });
  mockSignOut.mockResolvedValueOnce({ error: new Error('Network unavailable') });
  const listener = jest.fn();
  const stop = subscribeAuth(listener);
  await begin();
  const done = coordinator.receive(callback);
  await waitFor(() => expect(mockSetSession).toHaveBeenCalled());
  await coordinator.cancel();
  gate.resolve();
  await done;
  await authMutation(async () => {
    mockSession = makeSession();
    mockListener('SIGNED_IN', mockSession);
  });
  expect(listener.mock.calls.filter(([event]) => event === 'SIGNED_IN')).toHaveLength(1);
  expect((await restoreAuthSession())?.user.id).toBe(makeSession().user.id);
  expect(await AsyncStorage.getItem('langtify-oauth:https://auth.example.test:pending')).toBeNull();
  stop();
});
it('does not sign out a newer password session of the same user when recovering an old Google commit', async () => {
  mockSession = {
    ...google(),
    access_token: makeOAuthSession(undefined, 'new-password-session').access_token,
  };
  await AsyncStorage.setItem(
    'langtify-oauth:https://auth.example.test:pending',
    JSON.stringify({
      id: '10000000-0000-4000-8000-000000000001',
      createdAt: Date.now(),
      redirect: 'langtify://auth/callback',
      phase: 'committing',
      candidateUserId: google().user.id,
      candidateSessionId: 'old-google-session',
    }),
  );
  expect((await restoreAuthSession())?.access_token).toBe(
    makeOAuthSession(undefined, 'new-password-session').access_token,
  );
  expect(mockSignOut).not.toHaveBeenCalled();
});

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    clear: () => values.clear(),
  };
}
async function inBrowser(
  run: (authority: ReturnType<typeof browserCoordination>, assign: jest.Mock) => Promise<void>,
) {
  const local = memoryStorage(),
    tab = memoryStorage(),
    assign = jest.fn();
  const properties = ['localStorage', 'sessionStorage', 'location'] as const;
  const previous = properties.map((key) => Object.getOwnPropertyDescriptor(window, key));
  const oldLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
  const platform = jest.replaceProperty(Platform, 'OS', 'web');
  const locks: AuthLocks = { request: (name, work) => processLock(name, -1, work) };
  Object.defineProperties(window, {
    localStorage: { configurable: true, value: local },
    sessionStorage: { configurable: true, value: tab },
    location: { configurable: true, value: { assign } },
  });
  Object.defineProperty(navigator, 'locks', { configurable: true, value: locks });
  try {
    await run(
      browserCoordination(local, locks, 'langtify-oauth:https://auth.example.test:'),
      assign,
    );
  } finally {
    await coordinator.cancel('');
    await restoreAuthSession();
    platform.restore();
    properties.forEach((key, i) => {
      const descriptor = previous[i];
      if (descriptor) Object.defineProperty(window, key, descriptor);
      else Reflect.deleteProperty(window, key);
    });
    if (oldLocks) Object.defineProperty(navigator, 'locks', oldLocks);
    else Reflect.deleteProperty(navigator, 'locks');
  }
}
it.each([false, true])(
  'defers a cross-tab SDK broadcast until its origin finishes admission (accepted=%s)',
  async (accepted) => {
    await inBrowser(async (other) => {
      const listener = jest.fn();
      const stop = subscribeAuth(listener);
      await other.run(async () => {
        other.commit({ sessionId: 'test-oauth-session', userId: google().user.id });
        mockSession = google();
        mockListener('SIGNED_IN', mockSession);
        await Promise.resolve();
        expect(listener).not.toHaveBeenCalled();
        if (!accepted) mockSession = null;
        other.commit(null);
      });
      await restoreAuthSession();
      expect(listener.mock.calls.filter(([event]) => event === 'SIGNED_IN')).toHaveLength(
        accepted ? 1 : 0,
      );
      stop();
    });
  },
);
it('an intent from another tab invalidates an OAuth exchange before session installation', async () => {
  await inBrowser(async (other, assign) => {
    const exchange = deferred<Session>();
    mockExchange.mockReturnValue(exchange.promise);
    void coordinator.start();
    await waitFor(() => expect(assign).toHaveBeenCalled());
    const done = coordinator.receive(callback);
    await waitFor(() => expect(mockExchange).toHaveBeenCalled());
    other.begin('newer-sign-out');
    exchange.resolve(google());
    await done;
    expect(mockSetSession).not.toHaveBeenCalled();
    expect(mockSession).toBeNull();
  });
});
it('another tab can recover a crashed installation without having its private PKCE storage', async () => {
  await inBrowser(async (other) => {
    other.commit({ sessionId: 'test-oauth-session', userId: google().user.id });
    mockSession = google();
    expect(await restoreAuthSession()).toBeNull();
    expect(mockSignOut).toHaveBeenCalled();
    expect(other.pending()).toBeNull();
  });
});
