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
import { RatingUnavailable, type RatingScore, type RatingSummary } from '@/features/ratings/rating';
import { feedback } from '@/lib/haptics';
jest.mock('@/lib/haptics', () => ({ feedback: { selection: jest.fn() } }));
jest.mock('@/features/inbox/notification-bell', () => ({ NotificationBell: () => null }));
let mockSession = makeSession(),
  mockAccount = makeAccount(),
  mockStatus = 'ready';
let mockFocused = true;
const mockRate = jest.fn();
const mockPush = jest.fn();
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
  feedGateway: () => ({ load: mockLoad, previews: mockPreviews, rate: mockRate }),
}));
jest.mock('@/services/social', () => ({
  socialGateway: () => ({ comments: jest.fn().mockResolvedValue({ items: [], hasMore: false }) }),
}));
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  useFocusEffect: (callback: () => () => void) => {
    const React = jest.requireActual<typeof ReactTypes>('react');
    const focused = mockFocused;
    React.useEffect(() => (focused ? callback() : undefined), [callback, focused]);
  },
}));
const item: FeedItem = {
  averageRating: null,
  ratingCount: 0,
  viewerRating: null,
  canRate: true,
  id: '77000000-0000-4000-8000-000000000001',
  targetTerm: 'le chien',
  referenceTerm: 'dog',
  cefrLevel: 'A1',
  username: 'learner',
  submittedAt: '2026-09-13T12:00:00.123456Z',
};
const page: FeedPage = { items: [item], hasMore: false };
const gateway: FeedGateway = { load: mockLoad, previews: mockPreviews, rate: mockRate };
let catalog: FeedItem[] = [];
beforeEach(() => {
  jest.clearAllMocks();
  mockLoad.mockReset();
  mockPreviews.mockReset();
  mockRate.mockReset();
  mockRate.mockImplementation(async (id: string, score: RatingScore) => {
    const summary = rated(score);
    catalog = catalog.map((row) => (row.id === id ? { ...row, ...summary } : row));
    return summary;
  });
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
  // Control FlatList's delayed cell batching while asserting successive image
  // recovery and refresh states; real timers can fire between async assertions.
  jest.useFakeTimers();
  const rendered = render(<DiscoverScreen />);
  expect(await screen.findByText('Le chien')).toBeVisible();
  expect(screen.getByText('Dog')).toBeVisible();
  expect(screen.getByText('Photo by @learner')).toBeVisible();
  fireEvent(screen.getByLabelText('Photo of Le chien'), 'error');
  fireEvent.press(screen.getByText('Reload photos'));
  expect(await screen.findByLabelText('Photo of Le chien')).toBeVisible();
  mockLoad.mockResolvedValue({ items: [], hasMore: false });
  fireEvent(rendered.UNSAFE_getByType(FlatList), 'refresh');
  expect(await screen.findByText(/No photos yet/)).toBeVisible();
  expect(screen.queryByText('Le chien')).toBeNull();
  expect(mockLoad).toHaveBeenLastCalledWith(null, expect.any(AbortSignal));
  await act(async () => jest.advanceTimersByTime(100));
});
it('offers network retry and reloads account when backend target differs', async () => {
  mockLoad.mockRejectedValueOnce(new Error('offline'));
  render(<DiscoverScreen />);
  expect(await screen.findByText(/couldn’t load Discover/)).toBeVisible();
  mockLoad.mockRejectedValueOnce(new FeedSettingsChanged('Learning settings changed.'));
  fireEvent.press(screen.getByText('Try again'));
  fireEvent.press(await screen.findByText('Refresh account'));
  expect(mockReload).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByText('Try again'));
  expect(await screen.findByText('Le chien')).toBeVisible();
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
    expect(screen.queryByText('Le chien')).toBeNull();
    expect(screen.queryByLabelText('Photo of Le chien')).toBeNull();
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
it('does not read in background; retains cached metadata on suspension and resumes safely', async () => {
  AppState.currentState = 'background';
  const listeners = jest.spyOn(AppState, 'addEventListener');
  const { result } = renderHook(() => useDiscover(gateway));
  await act(async () => {});
  expect(mockLoad).not.toHaveBeenCalled();
  await act(async () => listeners.mock.calls.at(-1)?.[1]('active'));
  expect(result.current.items).toHaveLength(1);
  act(() => listeners.mock.calls.at(-1)?.[1]('background'));
  expect(result.current.items).toEqual([item]);
  expect(result.current.photos).toEqual({});
  await act(async () => listeners.mock.calls.at(-1)?.[1]('active'));
  expect(result.current.items).toHaveLength(1);
});
it('keeps downloaded photos visible without periodic signing and explicitly refreshes on request', async () => {
  jest.useFakeTimers();
  const { result } = renderHook(() => useDiscover(gateway));
  await act(async () => {});
  const photo = result.current.photos[item.id];
  await act(async () => jest.advanceTimersByTime(20 * 60000));
  expect(result.current.photos[item.id]).toBe(photo);
  expect(mockLoad).toHaveBeenCalledTimes(1);
  expect(mockPreviews).toHaveBeenCalledTimes(1);
  await act(async () => {
    await result.current.refresh();
  });
  expect(mockLoad).toHaveBeenCalledTimes(2);
  expect(mockPreviews).toHaveBeenCalledTimes(2);
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
    average_rating: null,
    rating_count: 0,
    viewer_rating: null,
    can_rate: true,
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
  expect(result.current.items).toEqual([item]);
  mockFocused = true;
  rerender({});
  await waitFor(() => expect(result.current.loading).toBe(false));
  const calls = mockLoad.mock.calls.length;
  act(() => stale?.('background'));
  await act(async () => stale?.('active'));
  expect(result.current.items).toEqual([item]);
  expect(mockLoad).toHaveBeenCalledTimes(calls);
});

it('retains prior metadata but clears photos after signing failure, then retries from newest', async () => {
  mockLoad.mockResolvedValue({ ...page, hasMore: true });
  const { result } = renderHook(() => useDiscover(gateway));
  await waitFor(() => expect(result.current.loading).toBe(false));
  mockPreviews.mockRejectedValueOnce(new Error('service_unavailable'));
  await act(async () => {
    await result.current.loadMore();
  });
  expect(result.current.error).toBeTruthy();
  expect(result.current.items).toEqual([item]);
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

function rated(score: RatingScore): RatingSummary {
  return { averageRating: score, ratingCount: 1, viewerRating: score, canRate: true };
}
it('keeps the picker transient, prevents double votes and installs confirmed edits', async () => {
  let finish: (value: RatingSummary) => void = () => {};
  mockRate.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(<DiscoverScreen />);
  fireEvent.press(await screen.findByLabelText('Rate photo: Le chien'));
  expect(feedback.selection).not.toHaveBeenCalled();
  fireEvent.press(screen.getByLabelText('5 — Perfect match for Le chien'));
  expect(screen.queryByLabelText('3 — Understandable for Le chien')).toBeNull();
  expect(screen.getByLabelText('Rate photo: Le chien')).toBeDisabled();
  expect(screen.getByText('No ratings yet')).toBeVisible();
  fireEvent.press(screen.getByLabelText('Rate photo: Le chien'));
  await waitFor(() => expect(mockRate).toHaveBeenCalledTimes(1));
  expect(feedback.selection).not.toHaveBeenCalled();
  await act(async () => finish(rated(5)));
  expect(feedback.selection).toHaveBeenCalledTimes(1);
  expect(screen.getByText('5.0 / 5 · 1 rating')).toBeVisible();
  fireEvent.press(
    screen.getByLabelText('Your rating: 5 — Perfect match. Edit rating for Le chien'),
  );
  fireEvent.press(screen.getByLabelText('3 — Understandable for Le chien'));
  expect(
    await screen.findByLabelText('Your rating: 3 — Understandable. Edit rating for Le chien'),
  ).toBeVisible();
  expect(feedback.selection).toHaveBeenCalledTimes(2);
});
it('shows owners their aggregate without allowing a self-rating', async () => {
  catalog = [{ ...item, canRate: false, averageRating: 4, ratingCount: 3 }];
  mockLoad.mockResolvedValue({ items: catalog, hasMore: false });
  render(<DiscoverScreen />);
  expect(await screen.findByText('Your photo')).toBeVisible();
  expect(screen.getByText('4.0 / 5 · 3 ratings')).toBeVisible();
  expect(screen.queryByLabelText('Rate photo: Le chien')).toBeNull();
  const { result } = renderHook(() => useDiscover(gateway));
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => {
    await result.current.rate(item.id, 5);
  });
  expect(mockRate).not.toHaveBeenCalled();
  expect(feedback.selection).not.toHaveBeenCalled();
});
it('does not replay feedback for an already confirmed score or a later cache read', async () => {
  const { result } = renderHook(() => useDiscover(gateway));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(feedback.selection).not.toHaveBeenCalled();
  await act(async () => {
    await result.current.rate(item.id, 4);
  });
  expect(feedback.selection).toHaveBeenCalledTimes(1);
  await act(async () => {
    await result.current.rate(item.id, 4);
  });
  await act(async () => {
    await result.current.renew();
  });
  expect(result.current.items[0].viewerRating).toBe(4);
  expect(feedback.selection).toHaveBeenCalledTimes(1);
});
it('supersedes an older renewal response when a vote is saved', async () => {
  const { result } = renderHook(() => useDiscover(gateway));
  await waitFor(() => expect(result.current.loading).toBe(false));
  let finish: (value: FeedPhotos) => void = () => {};
  mockPreviews.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  act(() => {
    void result.current.renew();
  });
  const signal: AbortSignal = mockPreviews.mock.calls.at(-1)?.[1];
  await act(async () => {
    await result.current.rate(item.id, 5);
  });
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ items: [item], photos: { [item.id]: 'old' } }));
  expect(result.current.items[0].viewerRating).toBe(5);
  expect(result.current.photos[item.id]).not.toBe('old');
});
it('queues explicit refresh behind a mutation and never automatically replays an uncertain committed vote', async () => {
  const { result } = renderHook(() => useDiscover(gateway));
  await waitFor(() => expect(result.current.loading).toBe(false));
  let finish: (value: RatingSummary) => void = () => {};
  mockRate.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  act(() => {
    void result.current.rate(item.id, 5);
    void result.current.refresh();
  });
  expect(mockLoad).toHaveBeenCalledTimes(1);
  catalog = [{ ...item, ...rated(5) }];
  mockLoad.mockResolvedValue({ items: catalog, hasMore: false });
  await act(async () => finish(rated(5)));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(mockLoad).toHaveBeenCalledTimes(2);
  mockRate.mockImplementationOnce(async () => {
    catalog = [{ ...item, ...rated(3) }];
    throw new Error('response lost');
  });
  await act(async () => {
    await result.current.rate(item.id, 3);
  });
  await waitFor(() => expect(result.current.items[0].viewerRating).toBe(3));
  expect(result.current.ratingAction).toBeNull();
  expect(mockRate).toHaveBeenCalledTimes(2);
  // Reconciliation of a lost acknowledgement does not replay tactile rewards.
  expect(feedback.selection).toHaveBeenCalledTimes(1);
});
it('keeps failed votes unconfirmed, accepts an explicit new choice and hides denied photos', async () => {
  mockRate.mockRejectedValueOnce(new Error('offline'));
  render(<DiscoverScreen />);
  fireEvent.press(await screen.findByLabelText('Rate photo: Le chien'));
  fireEvent.press(screen.getByLabelText('4 — Clear match for Le chien'));
  await screen.findByText('We couldn’t confirm your rating. Open it to check or try again.');
  expect(mockRate).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByLabelText('Rate photo: Le chien'));
  fireEvent.press(screen.getByLabelText('4 — Clear match for Le chien'));
  await screen.findByLabelText('Your rating: 4 — Clear match. Edit rating for Le chien');
  mockRate.mockRejectedValueOnce(new RatingUnavailable());
  fireEvent.press(screen.getByLabelText('Your rating: 4 — Clear match. Edit rating for Le chien'));
  fireEvent.press(screen.getByLabelText('5 — Perfect match for Le chien'));
  expect(
    await screen.findByText('This photo or your language settings have changed. Refresh Discover.'),
  ).toBeVisible();
  expect(screen.queryByText('Le chien')).toBeNull();
});
it.each(['account', 'target', 'signout'])(
  'drops pending rating results after %s changes',
  async (change) => {
    let finish: (value: RatingSummary) => void = () => {};
    mockRate.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { rerender } = render(<DiscoverScreen />);
    await screen.findByText('Le chien');
    fireEvent.press(screen.getByLabelText('Rate photo: Le chien'));
    fireEvent.press(screen.getByLabelText('5 — Perfect match for Le chien'));
    await waitFor(() => expect(mockRate).toHaveBeenCalled());
    const signal: AbortSignal = mockRate.mock.calls[0][2];
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
    await act(async () => finish(rated(5)));
    expect(signal.aborted).toBe(true);
    expect(screen.queryByText(/Your rating:/)).toBeNull();
    expect(feedback.selection).not.toHaveBeenCalled();
  },
);
it('keeps downloaded pixels during uncertain vote recovery and discards a backgrounded mutation', async () => {
  jest.useFakeTimers();
  const listeners = jest.spyOn(AppState, 'addEventListener');
  const { result } = renderHook(() => useDiscover(gateway));
  await act(async () => {});
  let finish: (value: RatingSummary) => void = () => {};
  mockRate.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  act(() => {
    void result.current.rate(item.id, 5);
  });
  const signal: AbortSignal = mockRate.mock.calls[0][2];
  mockPreviews.mockReturnValueOnce(new Promise(() => {}));
  await act(async () => {
    jest.advanceTimersByTime(60000);
  });
  expect(result.current.photos[item.id]).toBeTruthy();
  act(() => listeners.mock.calls.at(-1)?.[1]('background'));
  expect(signal.aborted).toBe(true);
  expect(result.current.ratingAction).toBeNull();
  await act(async () => finish(rated(5)));
  expect(result.current.items).toEqual([item]);
  await act(async () => listeners.mock.calls.at(-1)?.[1]('active'));
  expect(result.current.items[0].viewerRating).toBeNull();
});

it('times out a stalled vote, releases queued refresh and ignores its late response after a newer vote', async () => {
  jest.useFakeTimers();
  const { result } = renderHook(() => useDiscover(gateway));
  await act(async () => {});
  let finish: (value: RatingSummary) => void = () => {};
  mockRate.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  act(() => {
    void result.current.rate(item.id, 1);
    void result.current.refresh();
  });
  const signal: AbortSignal = mockRate.mock.calls[0][2];
  await act(async () => {
    jest.advanceTimersByTime(20000);
  });
  expect(signal.aborted).toBe(true);
  expect(result.current.ratingAction?.status).not.toBe('saving');
  expect(mockLoad).toHaveBeenCalledTimes(2);
  expect(mockRate).toHaveBeenCalledTimes(1);
  await act(async () => {
    await result.current.rate(item.id, 5);
  });
  await act(async () => finish(rated(1)));
  expect(result.current.items[0].viewerRating).toBe(5);
  expect(result.current.ratingAction).toBeNull();
});

it('reconciles a timed-out committed vote without replaying it', async () => {
  jest.useFakeTimers();
  const { result } = renderHook(() => useDiscover(gateway));
  await act(async () => {});
  mockRate.mockImplementationOnce(() => {
    catalog = [{ ...item, ...rated(4) }];
    return new Promise(() => {});
  });
  act(() => {
    void result.current.rate(item.id, 4);
  });
  await act(async () => {
    jest.advanceTimersByTime(20000);
  });
  expect(result.current.items[0].viewerRating).toBe(4);
  expect(result.current.ratingAction).toBeNull();
  expect(mockRate).toHaveBeenCalledTimes(1);
});

it('keeps the new account own score on the same public photo after an old mutation settles', async () => {
  let finish: (value: RatingSummary) => void = () => {};
  mockRate.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { rerender } = render(<DiscoverScreen />);
  await screen.findByText('Le chien');
  fireEvent.press(screen.getByLabelText('Rate photo: Le chien'));
  fireEvent.press(screen.getByLabelText('5 — Perfect match for Le chien'));
  await waitFor(() => expect(mockRate).toHaveBeenCalledTimes(1));
  mockSession = makeSession('different');
  mockAccount = makeAccount('different');
  catalog = [{ ...item, ...rated(2) }];
  rerender(<DiscoverScreen />);
  await screen.findByLabelText('Your rating: 2 — Poor match. Edit rating for Le chien');
  await act(async () => finish(rated(5)));
  expect(
    screen.getByLabelText('Your rating: 2 — Poor match. Edit rating for Le chien'),
  ).toBeVisible();
  expect(screen.queryByText('Your rating: Perfect match')).toBeNull();
});

it('opens a native post using only its ID and offers organized search from Discover', async () => {
  render(<DiscoverScreen />);
  await screen.findByText('Le chien');
  fireEvent.press(screen.getByLabelText('Open photo: Le chien'));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/post', params: { submissionId: item.id } });
  expect(mockLoad).toHaveBeenCalledTimes(1);
  expect(mockPreviews).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByLabelText('Search words and people'));
  expect(mockPush).toHaveBeenLastCalledWith('/explore');
});
// Native detail, back navigation, cross-window ratings and background behavior
// now run against real Router stacks in post-navigation.test.tsx.
