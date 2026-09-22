import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import type * as ReactTypes from 'react';
import {
  createServerCache,
  discardServerData,
  invalidateServerData,
  serverScope,
  setServerScope,
} from '@/lib/server-cache';
import { useServerQuery } from '@/hooks/use-server-query';

let mockFocus: (() => void) | null = null;
let mockBlur: (() => void) | null = null;
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => () => void) => {
    const React = jest.requireActual<typeof ReactTypes>('react');
    React.useEffect(() => {
      mockFocus = () => {
        mockBlur = callback();
      };
      mockFocus();
      return () => mockBlur?.();
    }, [callback]);
  },
}));

beforeEach(() => {
  jest.useFakeTimers();
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    writable: true,
    value: 'active',
  });
});
afterEach(() => jest.useRealTimers());

it('does not let a late previous-session mutation invalidate the current account', () => {
  const cache = createServerCache<string>();
  const previousScope = serverScope('previous', 'old-token');
  const currentScope = serverScope('current', 'new-token');
  const previous = cache.entry(`${previousScope}:discover`, ['discover']);
  const current = cache.entry(`${currentScope}:discover`, ['discover']);
  previous.set('previous data');
  current.set('current data');
  invalidateServerData(['discover'], { discard: true, scope: previousScope });
  expect(previous.getSnapshot().data).toBeNull();
  expect(current.getSnapshot().data).toBe('current data');
  expect(current.getSnapshot().invalidation).toBe(0);
});
it('discards denied public data without a refetch loop or clearing a different session', async () => {
  const cache = createServerCache<string>();
  const denied = cache.entry('first:profile', ['public-profile']);
  const other = cache.entry('second:profile', ['public-profile']);
  other.set('other account');
  const load = jest.fn(async () => 'formerly eligible');
  const { result } = renderHook(() => useServerQuery(denied, load, { staleTime: 60000 }));
  await act(async () => {});
  await act(async () => discardServerData(['public-profile'], { scope: 'first' }));
  expect(result.current.data).toBeNull();
  expect(result.current.loading).toBe(false);
  expect(load).toHaveBeenCalledTimes(1);
  expect(other.getSnapshot().data).toBe('other account');
  await act(async () => result.current.refresh());
  expect(load).toHaveBeenCalledTimes(2);
});

it('deduplicates reads, retains a fresh result, and refreshes after its stale time', async () => {
  const entry = createServerCache<number>().entry('profile', ['profile']);
  const load = jest.fn(async () => 12);
  await Promise.all([
    entry.read(load, { staleTime: 60000 }),
    entry.read(load, { staleTime: 60000 }),
  ]);
  expect(load).toHaveBeenCalledTimes(1);
  await entry.read(load, { staleTime: 60000 });
  expect(load).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(60001);
  await entry.read(load, { staleTime: 60000 });
  expect(load).toHaveBeenCalledTimes(2);
});

it('does not let a partial receipt erase a pending resource invalidation', async () => {
  const cache = createServerCache<{ username: string; score: number }>();
  const entry = cache.entry('viewer:feed', ['discover']);
  entry.set({ username: 'old_name', score: 1 });
  entry.invalidate();
  cache.update((key, value) => ({ ...value, score: key === 'viewer:feed' ? 4 : value.score }));
  expect(entry.getSnapshot().data).toEqual({ username: 'old_name', score: 4 });
  expect(entry.getSnapshot().updatedAt).toBe(-Infinity);
  const load = jest.fn(async () => ({ username: 'new_name', score: 4 }));
  const { result } = renderHook(() => useServerQuery(entry, load, { staleTime: 60000 }));
  await act(async () => {});
  expect(load).toHaveBeenCalledTimes(1);
  expect(result.current.data?.username).toBe('new_name');
});

it('preserves a cached page across blur/refocus and short background without another read', async () => {
  const entry = createServerCache<string[]>().entry('vocabulary', ['vocabulary']);
  const load = jest.fn(async () => ['page-two']);
  const listeners = jest.mocked(AppState.addEventListener);
  const { result } = renderHook(() => useServerQuery(entry, load, { staleTime: 60000 }));
  await act(async () => {});
  const listener = listeners.mock.calls.at(-1)?.[1];
  act(() => mockBlur?.());
  expect(result.current.data).toEqual(['page-two']);
  await act(async () => mockFocus?.());
  await act(async () => {
    listener?.('background');
    listener?.('active');
  });
  expect(load).toHaveBeenCalledTimes(1);
  expect(result.current.data).toEqual(['page-two']);
});

it('invalidates only related resources and updates the visible query without full-screen loading', async () => {
  const cache = createServerCache<number>();
  const profile = cache.entry('profile', ['profile']);
  const comments = cache.entry('comments', ['comments:post']);
  const load = jest.fn(async () => 1);
  const unrelated = jest.fn(async () => 8);
  await comments.read(unrelated, { staleTime: 30000 });
  const { result } = renderHook(() => useServerQuery(profile, load, { staleTime: 60000 }));
  await act(async () => {});
  load.mockResolvedValueOnce(2);
  await act(async () => invalidateServerData(['profile']));
  expect(result.current.data).toBe(2);
  expect(load).toHaveBeenCalledTimes(2);
  expect(unrelated).toHaveBeenCalledTimes(1);
});

it('discards old account data and never installs or restarts an obsolete session response', async () => {
  setServerScope('first');
  const cache = createServerCache<number>();
  const entry = cache.entry('first:profile', ['profile']);
  let finish: (value: number) => void = () => {};
  const load = jest.fn(
    () =>
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
  );
  const pending = entry.read(load, { staleTime: 60000 });
  await Promise.resolve();
  setServerScope('second');
  finish(99);
  await pending;
  await entry.read(load, { staleTime: 60000, force: true });
  expect(entry.getSnapshot().data).toBeNull();
  expect(entry.getSnapshot().retired).toBe(true);
  expect(load).toHaveBeenCalledTimes(1);
});

it('keeps one session cache scope across ordinary JWT rotation', () => {
  const token = (suffix: string) =>
    `header.${btoa(JSON.stringify({ session_id: 'session' }))}.${suffix}`;
  expect(serverScope('owner', token('one'))).toBe(serverScope('owner', token('two')));
  expect(serverScope('another', token('two'))).not.toBe(serverScope('owner', token('one')));
});

it('keeps metadata after network failure but removes it after an eligibility rejection', async () => {
  const entry = createServerCache<number>().entry('public-profile', ['profile']);
  entry.set(1);
  await entry.read(
    async () => {
      throw new Error('offline');
    },
    { staleTime: 0 },
  );
  expect(entry.getSnapshot().data).toBe(1);
  await entry.read(
    async () => {
      throw new Error('denied');
    },
    { staleTime: 0, discardOnError: () => true },
  );
  expect(entry.getSnapshot().data).toBeNull();
});

it('bounds retained resource keys and discards an evicted pending response', async () => {
  const cache = createServerCache<number>({ maxEntries: 2 });
  const first = cache.entry('one', []);
  let finish: (value: number) => void = () => {};
  const pending = first.read(
    () =>
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
    { staleTime: 0 },
  );
  await Promise.resolve();
  cache.entry('two', []).set(2);
  cache.entry('three', []).set(3);
  finish(1);
  await pending;
  expect(cache.entry('one', []).getSnapshot().data).toBeNull();
});

it('keeps a deduplicated request alive while another reader remains focused', async () => {
  const entry = createServerCache<number>().entry('profile', ['profile']);
  const releaseOne = entry.retain();
  const releaseTwo = entry.retain();
  let finish: (value: number) => void = () => {};
  let signal: AbortSignal | null = null;
  const pending = entry.read(
    (nextSignal) => {
      signal = nextSignal;
      return new Promise<number>((resolve) => {
        finish = resolve;
      });
    },
    { staleTime: 60000 },
  );
  await Promise.resolve();
  releaseOne();
  expect(signal).toHaveProperty('aborted', false);
  finish(42);
  await pending;
  expect(entry.getSnapshot().data).toBe(42);
  releaseTwo();
});

it('does not start queued transport work after its account is cleared', async () => {
  const entry = createServerCache<number>().entry('old:profile', ['profile']);
  const load = jest.fn(async () => 1);
  const request = entry.read(load, { staleTime: 60000 });
  entry.cancel();
  await request;
  expect(load).not.toHaveBeenCalled();
});
