import type * as ReactTypes from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { useServerQuery } from '@/hooks/use-server-query';
import { LONG_BACKGROUND_MS, useResumeRevalidation } from '@/hooks/use-resume-revalidation';
import { createServerCache, invalidateServerData } from '@/lib/server-cache';

const listeners = new Set<(state: AppStateStatus) => void>();
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
  listeners.clear();
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    writable: true,
    value: 'active',
  });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => {
    listeners.add(listener);
    return { remove: () => listeners.delete(listener) };
  });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});
function change(state: AppStateStatus) {
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: state });
  listeners.forEach((listener) => listener(state));
}

it('keeps loaded metadata through stale timestamps, tab returns and rerenders; only explicit refresh or relevant mutation rereads', async () => {
  const entry = createServerCache<string>().entry('viewer:session:profile', ['public-profile']);
  const load = jest.fn(async () => 'saved profile');
  const { result, rerender } = renderHook(() => useServerQuery(entry, load, { staleTime: 30000 }));
  await act(async () => {});
  await act(async () => jest.advanceTimersByTime(30 * 60000));
  act(() => mockBlur?.());
  await act(async () => mockFocus?.());
  rerender({});
  expect(result.current.data).toBe('saved profile');
  expect(load).toHaveBeenCalledTimes(1);
  await act(async () => invalidateServerData(['unrelated']));
  expect(load).toHaveBeenCalledTimes(1);
  await act(async () => result.current.refresh());
  expect(load).toHaveBeenCalledTimes(2);
  await act(async () => invalidateServerData(['public-profile']));
  expect(load).toHaveBeenCalledTimes(3);
});

it('reconciles after an actual long background, not brief inactive/native-sheet or foreground time', async () => {
  const entry = createServerCache<string>().entry('viewer:session:profile', ['public-profile']);
  const load = jest.fn(async () => 'profile');
  renderHook(() => {
    useResumeRevalidation();
    return useServerQuery(entry, load, { staleTime: 30000 });
  });
  await act(async () => {});
  act(() => change('inactive'));
  await act(async () => jest.advanceTimersByTime(LONG_BACKGROUND_MS + 1));
  await act(async () => change('active'));
  expect(load).toHaveBeenCalledTimes(1);
  act(() => change('background'));
  await act(async () => jest.advanceTimersByTime(1000));
  await act(async () => change('active'));
  expect(load).toHaveBeenCalledTimes(1);
  act(() => change('background'));
  await act(async () => jest.advanceTimersByTime(LONG_BACKGROUND_MS));
  await act(async () => change('active'));
  expect(load).toHaveBeenCalledTimes(2);
});
