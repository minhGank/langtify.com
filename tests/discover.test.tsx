import type * as ReactTypes from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { AppState, FlatList } from 'react-native';
import { DiscoverScreen } from '@/features/discover/discover-screen';
import { useDiscover } from '@/features/discover/use-discover';
import {
  FeedSettingsChanged,
  parseFeedPage,
  parseFeedPhotos,
  type FeedGateway,
  type FeedItem,
  type FeedPage,
  type FeedPhotos,
} from '@/services/discover';
import { makeAccount, makeSession } from './fixtures';
let mockSession = makeSession(),
  mockAccount = makeAccount(),
  mockStatus = 'ready';
let mockFocused = true;
const mockLoad = jest.fn(),
  mockPreviews = jest.fn(),
  mockReload = jest.fn();
jest.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({
    session: mockSession,
    account: mockAccount,
    status: mockStatus,
    reload: mockReload,
  }),
}));
jest.mock('@/services/discover', () => ({
  ...jest.requireActual('@/services/discover'),
  feedGateway: () => ({ load: mockLoad, previews: mockPreviews }),
}));
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => () => void) => {
    const React = jest.requireActual<typeof ReactTypes>('react');
    const focused = mockFocused;
    React.useEffect(() => (focused ? callback() : undefined), [callback, focused]);
  },
}));
const item: FeedItem = {
  id: '77000000-0000-4000-8000-000000000001',
  targetTerm: 'le chien',
  referenceTerm: 'dog',
  cefrLevel: 'A1',
  username: 'learner',
  submittedAt: '2026-09-13T12:00:00.123456Z',
};
const page: FeedPage = { items: [item], hasMore: false };
const gateway: FeedGateway = { load: mockLoad, previews: mockPreviews };
let catalog: FeedItem[] = [];
beforeEach(() => {
  jest.clearAllMocks();
  mockLoad.mockReset();
  mockPreviews.mockReset();
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    writable: true,
    value: 'active',
  });
  mockSession = makeSession();
  mockAccount = makeAccount();
  mockStatus = 'ready';
  mockFocused = true;
  catalog = [item];
  mockLoad.mockResolvedValue(page);
  mockPreviews.mockImplementation(async (ids: string[]) => ({
    items: catalog.filter((r) => ids.includes(r.id)),
    photos: Object.fromEntries(ids.map((id) => [id, `https://api.test/${id}`])),
  }));
});
afterEach(() => jest.useRealTimers());
it('shows vocabulary, username, photo; retries failed images with fresh instances and refreshes to empty', async () => {
  const rendered = render(<DiscoverScreen />);
  expect(await screen.findByText('le chien')).toBeVisible();
  expect(screen.getByText('dog · A1')).toBeVisible();
  expect(screen.getByText('@learner')).toBeVisible();
  fireEvent(screen.getByLabelText('Photo of le chien'), 'error');
  fireEvent.press(screen.getByText('Reload photos'));
  expect(await screen.findByLabelText('Photo of le chien')).toBeVisible();
  mockLoad.mockResolvedValue({ items: [], hasMore: false });
  fireEvent(rendered.UNSAFE_getByType(FlatList), 'refresh');
  expect(await screen.findByText(/No public photos/)).toBeVisible();
  expect(screen.queryByText('le chien')).toBeNull();
  expect(mockLoad).toHaveBeenLastCalledWith(null, expect.any(AbortSignal));
});
it('offers network retry and reloads account when backend target differs', async () => {
  mockLoad.mockRejectedValueOnce(new Error('offline'));
  render(<DiscoverScreen />);
  expect(await screen.findByText(/Discover could not/)).toBeVisible();
  mockLoad.mockRejectedValueOnce(new FeedSettingsChanged('Learning settings changed.'));
  fireEvent.press(screen.getByText('Retry feed'));
  fireEvent.press(await screen.findByText('Reload account'));
  expect(mockReload).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByText('Retry feed'));
  expect(await screen.findByText('le chien')).toBeVisible();
});
it('bounds the retained window and each signing request, preserves exact cursor, deduplicates and refreshes newest', async () => {
  catalog = Array.from({ length: 36 }, (_, n) => ({ ...item, id: String(n) }));
  mockLoad
    .mockResolvedValueOnce({ items: catalog.slice(0, 12), hasMore: true })
    .mockResolvedValueOnce({ items: catalog.slice(11, 24), hasMore: true })
    .mockResolvedValueOnce({ items: catalog.slice(24), hasMore: false });
  const { result } = renderHook(() => useDiscover(gateway));
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => {
    await result.current.loadMore();
  });
  expect(mockLoad).toHaveBeenLastCalledWith(
    { time: item.submittedAt, id: '11' },
    expect.any(AbortSignal),
  );
  expect(result.current.items).toHaveLength(24);
  await act(async () => {
    await result.current.loadMore();
  });
  expect(result.current.items).toHaveLength(24);
  expect(new Set(result.current.items.map((r) => r.id)).size).toBe(24);
  expect(result.current.items[0].id).toBe('12');
  expect(result.current.hasMore).toBe(false);
  expect(mockPreviews.mock.calls.every(([ids]: [string[]]) => ids.length <= 24)).toBe(true);
  await act(async () => {
    await result.current.refresh();
  });
  expect(mockLoad).toHaveBeenLastCalledWith(null, expect.any(AbortSignal));
});
it('revalidates retained photos in one batch and drops newly private or deleted items', async () => {
  const { result } = renderHook(() => useDiscover(gateway));
  await waitFor(() => expect(result.current.loading).toBe(false));
  mockPreviews.mockResolvedValue({ items: [], photos: {} });
  await act(async () => {
    await result.current.renew();
  });
  expect(result.current.items).toEqual([]);
  expect(result.current.photos).toEqual({});
  expect(mockLoad).toHaveBeenCalledTimes(1);
});
it.each(['account', 'target', 'signout'])(
  'rejects late photo responses after %s changes',
  async (change) => {
    let finish: (value: FeedPhotos) => void = () => {};
    mockPreviews.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { rerender } = render(<DiscoverScreen />);
    await waitFor(() => expect(mockPreviews).toHaveBeenCalled());
    const signal: AbortSignal = mockPreviews.mock.calls[0][1];
    if (change === 'account') {
      mockSession = makeSession('different');
      mockAccount = makeAccount('different');
    }
    if (change === 'target' && mockAccount.learning)
      mockAccount = {
        ...mockAccount,
        learning: { ...mockAccount.learning, target_language_id: 'de' },
      };
    if (change === 'signout') mockStatus = 'signed-out';
    mockLoad.mockResolvedValue({ items: [], hasMore: false });
    rerender(<DiscoverScreen />);
    await act(async () => finish({ items: [item], photos: { [item.id]: 'stale' } }));
    expect(signal.aborted).toBe(true);
    expect(screen.queryByText('le chien')).toBeNull();
    expect(screen.queryByLabelText('Photo of le chien')).toBeNull();
  },
);
it('aborts obsolete reads and does not invoke retained callbacks after a gateway change or unmount', async () => {
  let finish: (value: FeedPage) => void = () => {};
  mockLoad.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { result, rerender, unmount } = renderHook(
    ({ gateway }: { gateway: FeedGateway }) => useDiscover(gateway),
    { initialProps: { gateway } },
  );
  const signal: AbortSignal = mockLoad.mock.calls[0][1],
    oldRefresh = result.current.refresh;
  rerender({ gateway: { ...gateway, load: async () => ({ items: [], hasMore: false }) } });
  await act(async () => finish(page));
  expect(signal.aborted).toBe(true);
  expect(result.current.items).toEqual([]);
  const calls = mockLoad.mock.calls.length;
  await act(async () => {
    await oldRefresh();
  });
  expect(mockLoad).toHaveBeenCalledTimes(calls);
  const refresh = result.current.refresh;
  unmount();
  await act(async () => {
    await refresh();
  });
  expect(mockLoad).toHaveBeenCalledTimes(calls);
});
it('does not read in background; clears data on suspension and reloads on resume', async () => {
  AppState.currentState = 'background';
  const listeners = jest.spyOn(AppState, 'addEventListener');
  const { result } = renderHook(() => useDiscover(gateway));
  await act(async () => {});
  expect(mockLoad).not.toHaveBeenCalled();
  await act(async () => listeners.mock.calls.at(-1)?.[1]('active'));
  expect(result.current.items).toHaveLength(1);
  act(() => listeners.mock.calls.at(-1)?.[1]('background'));
  expect(result.current.items).toEqual([]);
  expect(result.current.photos).toEqual({});
  await act(async () => listeners.mock.calls.at(-1)?.[1]('active'));
  expect(result.current.items).toHaveLength(1);
});
it('expires URLs during a stalled renewal and restores them on retry', async () => {
  jest.useFakeTimers();
  const { result } = renderHook(() => useDiscover(gateway));
  await act(async () => {});
  expect(result.current.photos[item.id]).toBeTruthy();
  mockPreviews.mockReturnValueOnce(new Promise(() => {}));
  await act(async () => {
    jest.advanceTimersByTime(55000);
  });
  expect(result.current.photos).toEqual({});
  await act(async () => {
    await result.current.refresh();
  });
  expect(result.current.photos[item.id]).toBeTruthy();
});
it('rejects a late expired signature even if the wall clock moved backwards', async () => {
  jest.useFakeTimers();
  let finish: (value: FeedPhotos) => void = () => {};
  mockPreviews.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { result } = renderHook(() => useDiscover(gateway));
  await act(async () => {});
  act(() => {
    jest.advanceTimersByTime(61000);
    jest.setSystemTime(Date.now() - 3600000);
  });
  await act(async () => finish({ items: [item], photos: { [item.id]: 'expired' } }));
  expect(result.current.photos).toEqual({});
  expect(result.current.error).toBeTruthy();
});
it('rejects wrong account/target, duplicate or malformed rows, arbitrary origins, paths and URL options', () => {
  const identity = { userId: 'viewer', targetLanguageId: 'fr', token: 'token' };
  const row = {
    id: item.id,
    target_term: 'chien',
    reference_term: 'dog',
    cefr_level: 'A1',
    username: 'learner',
    submitted_at: item.submittedAt,
  };
  const payload = { viewer_id: 'viewer', target_language_id: 'fr', items: [row], has_more: false };
  expect(parseFeedPage(payload, identity).items[0].submittedAt).toBe(item.submittedAt);
  for (const change of [
    { viewer_id: 'other' },
    { target_language_id: 'de' },
    { items: [row, row] },
    { items: [{ ...row, cefr_level: 'D1' }] },
    { items: [], has_more: true },
  ])
    expect(() => parseFeedPage({ ...payload, ...change }, identity)).toThrow();
  const path = `/storage/v1/object/sign/challenge-submissions/77000000-0000-4000-8000-000000000099/${item.id}.jpg?token=a.b.c`;
  const signed = (signed_path: string) => ({ ...payload, items: [{ ...row, signed_path }] });
  expect(
    parseFeedPhotos(signed(path), identity, [item.id], 'https://api.test').photos[item.id],
  ).toBe('https://api.test' + path);
  for (const bad of [
    'https://evil.test/photo',
    path + '&download=1',
    path.replace(item.id, '77000000-0000-4000-8000-000000000088'),
    path.replace('challenge-submissions', 'other'),
  ])
    expect(() => parseFeedPhotos(signed(bad), identity, [item.id], 'https://api.test')).toThrow();
  expect(() => parseFeedPhotos(signed(path), identity, [], 'https://api.test')).toThrow();
});

it('ignores a delayed listener from the previous focus/gateway lifetime', async () => {
  const listeners = jest.spyOn(AppState, 'addEventListener');
  const { result, rerender } = renderHook(
    ({ gateway }: { gateway: FeedGateway }) => useDiscover(gateway),
    { initialProps: { gateway } },
  );
  await waitFor(() => expect(result.current.loading).toBe(false));
  const staleListener = listeners.mock.calls.at(-1)?.[1];
  rerender({ gateway: { ...gateway } });
  await waitFor(() => expect(result.current.loading).toBe(false));
  const calls = mockLoad.mock.calls.length;
  act(() => staleListener?.('background'));
  expect(result.current.items).toEqual([item]);
  await act(async () => staleListener?.('active'));
  expect(mockLoad).toHaveBeenCalledTimes(calls);
  expect(result.current.photos[item.id]).toBeTruthy();
});

it('ignores queued lifecycle callbacks after blur and refocus with the same gateway', async () => {
  const listeners = jest.spyOn(AppState, 'addEventListener');
  const { result, rerender } = renderHook(() => useDiscover(gateway));
  await waitFor(() => expect(result.current.loading).toBe(false));
  const stale = listeners.mock.calls.at(-1)?.[1];
  mockFocused = false;
  rerender({});
  expect(result.current.items).toEqual([]);
  mockFocused = true;
  rerender({});
  await waitFor(() => expect(result.current.loading).toBe(false));
  const calls = mockLoad.mock.calls.length;
  act(() => stale?.('background'));
  await act(async () => stale?.('active'));
  expect(result.current.items).toEqual([item]);
  expect(mockLoad).toHaveBeenCalledTimes(calls);
});

it('reports a signing failure and retries from newest instead of accepting a partially signed page', async () => {
  mockLoad.mockResolvedValue({ ...page, hasMore: true });
  const { result } = renderHook(() => useDiscover(gateway));
  await waitFor(() => expect(result.current.loading).toBe(false));
  mockPreviews.mockRejectedValueOnce(new Error('service_unavailable'));
  await act(async () => {
    await result.current.loadMore();
  });
  expect(result.current.error).toBeTruthy();
  expect(result.current.items).toEqual([]);
  expect(result.current.photos).toEqual({});
  await act(async () => {
    await result.current.refresh();
  });
  expect(mockLoad).toHaveBeenLastCalledWith(null, expect.any(AbortSignal));
  expect(result.current.items).toEqual([item]);
});
it('serializes repeated Load more taps and does not let renewal change an in-flight cursor', async () => {
  jest.useFakeTimers();
  mockLoad.mockResolvedValueOnce({ ...page, hasMore: true });
  const { result } = renderHook(() => useDiscover(gateway));
  await act(async () => {});
  let finish: (value: FeedPage) => void = () => {};
  mockLoad.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  act(() => {
    void result.current.loadMore();
    void result.current.loadMore();
  });
  await act(async () => {
    jest.advanceTimersByTime(45000);
  });
  expect(mockLoad).toHaveBeenCalledTimes(2);
  expect(mockLoad).toHaveBeenLastCalledWith(
    { time: item.submittedAt, id: item.id },
    expect.any(AbortSignal),
  );
  await act(async () => finish({ items: [], hasMore: false }));
  expect(result.current.items).toEqual([item]);
  expect(result.current.hasMore).toBe(false);
});

it('keeps its cursor when renewal removes the entire window instead of replaying earlier pages', async () => {
  mockLoad.mockResolvedValue({ ...page, hasMore: true });
  const { result } = renderHook(() => useDiscover(gateway));
  await waitFor(() => expect(result.current.loading).toBe(false));
  mockPreviews.mockResolvedValue({ items: [], photos: {} });
  await act(async () => {
    await result.current.renew();
    await result.current.renew();
  });
  expect(result.current.items).toEqual([]);
  expect(result.current.hasMore).toBe(true);
  expect(mockLoad).toHaveBeenCalledTimes(1);
  await act(async () => {
    await result.current.loadMore();
  });
  expect(mockLoad).toHaveBeenLastCalledWith(
    { time: item.submittedAt, id: item.id },
    expect.any(AbortSignal),
  );
});
