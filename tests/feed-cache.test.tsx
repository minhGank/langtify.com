import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import type * as ReactTypes from 'react';
import { useDiscover } from '@/features/discover/use-discover';
import { useVocabulary } from '@/features/vocabulary/use-vocabulary';
import { FeedSettingsChanged, type FeedGateway, type FeedItem } from '@/services/discover';
import { RatingUnavailable } from '@/features/ratings/rating';
import type { Capture, VocabularyGateway } from '@/services/vocabulary';
import { discardServerData, invalidateServerData } from '@/lib/server-cache';

let mockFocus: (() => void) | null = null;
let mockBlur: (() => void) | null = null;
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => () => void) => {
    const React = jest.requireActual<typeof ReactTypes>('react');
    React.useEffect(() => {
      let cleanup: (() => void) | null = null;
      mockFocus = () => {
        cleanup = callback();
        mockBlur = cleanup;
      };
      mockFocus();
      return () => cleanup?.();
    }, [callback]);
  },
}));
const item: FeedItem = {
  id: 'one',
  targetTerm: 'le chien',
  referenceTerm: 'dog',
  cefrLevel: 'A1',
  username: 'friend',
  submittedAt: '2026-09-20T12:00:00.123456Z',
  averageRating: null,
  ratingCount: 0,
  viewerRating: null,
  canRate: true,
};
const capture: Capture = {
  ...item,
  conceptId: 'concept',
  assignmentId: 'assignment',
  cefrLevel: 'A1',
  visibility: 'private',
  captureCount: 1,
};
beforeEach(() => {
  jest.useFakeTimers();
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    writable: true,
    value: 'active',
  });
});
afterEach(() => jest.useRealTimers());

it('shares an authoritative rating between Discover and public-profile windows only in the same session', async () => {
  const load = jest.fn(async () => ({ items: [item], hasMore: false }));
  const previews = jest.fn(async () => ({
    items: [item],
    photos: { [item.id]: 'downloaded-photo' },
  }));
  const rate = jest.fn(async () => ({
    viewerRating: 4 as const,
    averageRating: 4,
    ratingCount: 1,
    canRate: true,
  }));
  const gateway = { load, previews, rate };
  const feed = renderHook(() =>
    useDiscover(gateway, 'viewer:session:discover:fr', 'viewer:session'),
  );
  const profile = renderHook(() =>
    useDiscover(gateway, 'viewer:session:public-posts:person:fr', 'viewer:session'),
  );
  const other = renderHook(() =>
    useDiscover(gateway, 'other:session:discover:fr', 'other:session'),
  );
  await act(async () => {});
  await act(async () => feed.result.current.rate(item.id, 4));
  expect(profile.result.current.items[0].viewerRating).toBe(4);
  expect(other.result.current.items[0].viewerRating).toBeNull();
  expect(load).toHaveBeenCalledTimes(3);
  expect(previews).toHaveBeenCalledTimes(3);
});

it('restarts interrupted pagination when a sibling window receives a rating receipt', async () => {
  let voted = false;
  let finishOlder: (value: { items: FeedItem[]; hasMore: boolean }) => void = () => {};
  const previews = jest.fn(async (ids: string[]) => ({
    items: ids.map((id) => ({
      ...item,
      id,
      viewerRating: voted ? (4 as const) : null,
      ratingCount: voted ? 1 : 0,
      averageRating: voted ? 4 : null,
    })),
    photos: Object.fromEntries(ids.map((id) => [id, 'downloaded-photo'])),
  }));
  const rate = jest.fn(async () => {
    voted = true;
    return { viewerRating: 4 as const, averageRating: 4, ratingCount: 1, canRate: true };
  });
  const feedGateway = {
    load: jest.fn(async () => ({ items: [item], hasMore: false })),
    previews,
    rate,
  };
  const profileLoad = jest
    .fn()
    .mockResolvedValueOnce({ items: [item], hasMore: true })
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finishOlder = resolve;
      }),
    )
    .mockResolvedValueOnce({ items: [{ ...item, id: 'two' }], hasMore: false });
  const profileGateway = { load: profileLoad, previews, rate };
  const feed = renderHook(() =>
    useDiscover(feedGateway, 'viewer:session:discover:fr', 'viewer:session'),
  );
  const profile = renderHook(() =>
    useDiscover(profileGateway, 'viewer:session:public-posts:person:fr', 'viewer:session'),
  );
  await act(async () => {});
  const photoRevision = profile.result.current.photoRevision;
  await act(async () => {
    void profile.result.current.loadMore();
  });
  expect(profile.result.current.loading).toBe(true);
  await act(async () => feed.result.current.rate(item.id, 4));
  expect(profileLoad.mock.calls[1][1].aborted).toBe(true);
  expect(profileLoad).toHaveBeenCalledTimes(3);
  expect(profileLoad.mock.calls[2][0]).toEqual({ time: item.submittedAt, id: item.id });
  expect(profile.result.current.loading).toBe(false);
  expect(profile.result.current.items.map((row) => row.id)).toEqual(['one', 'two']);
  expect(profile.result.current.items[0].viewerRating).toBe(4);
  expect(profile.result.current.photoRevision).toBe(photoRevision);
  await act(async () => finishOlder({ items: [{ ...item, id: 'obsolete' }], hasMore: false }));
  expect(profile.result.current.items.map((row) => row.id)).toEqual(['one', 'two']);
});

it('reconciles a rating cancelled on blur on next visit, including cached sibling windows, without replay', async () => {
  let committed = false;
  let acknowledge: (value: {
    viewerRating: 4;
    averageRating: number;
    ratingCount: number;
    canRate: boolean;
  }) => void = () => {};
  const load = jest.fn(async () => ({ items: [item], hasMore: false }));
  const previews = jest.fn(async () => ({
    items: [
      {
        ...item,
        viewerRating: committed ? (4 as const) : null,
        averageRating: committed ? 4 : null,
        ratingCount: committed ? 1 : 0,
      },
    ],
    photos: { [item.id]: 'downloaded-photo' },
  }));
  const rate = jest.fn(
    () =>
      new Promise<{
        viewerRating: 4;
        averageRating: number;
        ratingCount: number;
        canRate: boolean;
      }>((resolve) => {
        acknowledge = resolve;
      }),
  );
  const gateway = { load, previews, rate };
  const sibling = renderHook(() =>
    useDiscover(gateway, 'viewer:session:public-posts:person:fr', 'viewer:session'),
  );
  await act(async () => {});
  sibling.unmount();
  const feed = renderHook(() =>
    useDiscover(gateway, 'viewer:session:discover:fr', 'viewer:session'),
  );
  await act(async () => {});
  await act(async () => {
    void feed.result.current.rate(item.id, 4);
  });
  act(() => mockBlur?.());
  expect(load).toHaveBeenCalledTimes(2);
  committed = true;
  await act(async () => mockFocus?.());
  expect(load).toHaveBeenCalledTimes(3);
  expect(feed.result.current.items[0].viewerRating).toBe(4);
  const revisit = renderHook(() =>
    useDiscover(gateway, 'viewer:session:public-posts:person:fr', 'viewer:session'),
  );
  await act(async () => {});
  expect(load).toHaveBeenCalledTimes(4);
  expect(revisit.result.current.items[0].viewerRating).toBe(4);
  await act(async () =>
    acknowledge({ viewerRating: 4, averageRating: 4, ratingCount: 1, canRate: true }),
  );
  expect(rate).toHaveBeenCalledTimes(1);
  expect(load).toHaveBeenCalledTimes(4);
});

it('removes newly unavailable signed-photo rows from sibling windows without resetting their paging cursor', async () => {
  const load = jest.fn(async () => ({ items: [item], hasMore: true }));
  const previews = jest.fn(async () => ({
    items: [item],
    photos: { [item.id]: 'downloaded-photo' },
  }));
  const gateway = { load, previews, rate: jest.fn() };
  const feed = renderHook(() =>
    useDiscover(gateway, 'viewer:session:discover:fr', 'viewer:session'),
  );
  const profile = renderHook(() =>
    useDiscover(gateway, 'viewer:session:public-posts:person:fr', 'viewer:session'),
  );
  const other = renderHook(() =>
    useDiscover(gateway, 'other:session:discover:fr', 'other:session'),
  );
  await act(async () => {});
  previews.mockResolvedValueOnce({ items: [], photos: {} });
  await act(async () => feed.result.current.renew());
  expect(profile.result.current.items).toEqual([]);
  expect(profile.result.current.photos).toEqual({});
  expect(profile.result.current.hasMore).toBe(true);
  expect(other.result.current.items).toHaveLength(1);
  expect(load).toHaveBeenCalledTimes(3);
  await act(async () => profile.result.current.loadMore());
  expect(load).toHaveBeenLastCalledWith(
    { time: item.submittedAt, id: item.id },
    expect.any(AbortSignal),
  );
});

it('removes a visible Discover window and capabilities after a related permission denial without rereading', async () => {
  const load = jest.fn(async () => ({ items: [item], hasMore: false }));
  const previews = jest.fn(async () => ({ items: [item], photos: { [item.id]: 'photo' } }));
  const gateway = { load, previews, rate: jest.fn() };
  const { result } = renderHook(() => useDiscover(gateway, 'viewer:session:discover:fr'));
  await act(async () => {});
  expect(result.current.items).toEqual([item]);
  await act(async () => discardServerData(['discover'], { scope: 'viewer:session' }));
  expect(result.current.items).toEqual([]);
  expect(result.current.photos).toEqual({});
  expect(result.current.loading).toBe(false);
  await act(async () => jest.advanceTimersByTime(20 * 60000));
  expect(load).toHaveBeenCalledTimes(1);
  expect(previews).toHaveBeenCalledTimes(1);
});

it('returns to the same Discover page after twenty minutes without reading or signing again', async () => {
  const load = jest
    .fn<ReturnType<FeedGateway['load']>, Parameters<FeedGateway['load']>>()
    .mockResolvedValueOnce({ items: [item], hasMore: true })
    .mockResolvedValueOnce({ items: [{ ...item, id: 'two' }], hasMore: false });
  const previews = jest
    .fn<ReturnType<FeedGateway['previews']>, Parameters<FeedGateway['previews']>>()
    .mockImplementation(async (ids) => ({
      items: ids.map((id) => ({ ...item, id })),
      photos: Object.fromEntries(ids.map((id) => [id, `https://example.test/${id}`])),
    }));
  const gateway: FeedGateway = { load, previews, rate: jest.fn() };
  const { result } = renderHook(() => useDiscover(gateway, 'viewer:session:fr'));
  await act(async () => {});
  await act(async () => {
    await result.current.loadMore();
  });
  expect(result.current.items.map(({ id }) => id)).toEqual(['one', 'two']);
  act(() => mockBlur?.());
  await act(async () => mockFocus?.());
  expect(load).toHaveBeenCalledTimes(2);
  expect(previews).toHaveBeenCalledTimes(2);
  expect(result.current.items.map(({ id }) => id)).toEqual(['one', 'two']);
  act(() => mockBlur?.());
  await act(async () => jest.advanceTimersByTime(20 * 60000));
  expect(previews).toHaveBeenCalledTimes(2);
  expect(result.current.photos).toEqual({});
  await act(async () => mockFocus?.());
  expect(load).toHaveBeenCalledTimes(2);
  expect(previews).toHaveBeenCalledTimes(2);
  expect(previews).toHaveBeenLastCalledWith(['one', 'two'], expect.any(AbortSignal));
});

it('retains the exact Vocabulary cursor across navigation and targets mutation invalidation', async () => {
  const page = { items: [capture], totalConcepts: 2, concept: null, hasMore: true };
  const load = jest
    .fn<ReturnType<VocabularyGateway['load']>, Parameters<VocabularyGateway['load']>>()
    .mockResolvedValueOnce(page)
    .mockResolvedValueOnce({ ...page, items: [{ ...capture, id: 'older' }], hasMore: false });
  const previews = jest
    .fn<ReturnType<VocabularyGateway['previews']>, Parameters<VocabularyGateway['previews']>>()
    .mockImplementation(async (ids) =>
      Object.fromEntries(ids.map((id) => [id, `https://example.test/${id}`])),
    );
  const gateway = { load, previews };
  const { result } = renderHook(() => useVocabulary(gateway, 'viewer:session:all'));
  await act(async () => {});
  await act(async () => {
    await result.current.next();
  });
  act(() => mockBlur?.());
  await act(async () => mockFocus?.());
  expect(result.current.data?.items[0].id).toBe('older');
  expect(result.current.hasPrevious).toBe(true);
  expect(load).toHaveBeenCalledTimes(2);
  expect(previews).toHaveBeenCalledTimes(2);
  await act(async () => invalidateServerData(['unrelated']));
  expect(load).toHaveBeenCalledTimes(2);
  load.mockResolvedValueOnce({ ...page, items: [], hasMore: false });
  await act(async () => invalidateServerData(['vocabulary'], { discard: true }));
  expect(load).toHaveBeenLastCalledWith(
    { time: capture.submittedAt, id: capture.id },
    expect.any(AbortSignal),
  );
  expect(result.current.data?.items).toEqual([]);
});

it('does not automatically retry a denied feed or restore a denied rating from cache', async () => {
  const load = jest
    .fn<ReturnType<FeedGateway['load']>, Parameters<FeedGateway['load']>>()
    .mockRejectedValueOnce(new FeedSettingsChanged());
  const previews = jest
    .fn<ReturnType<FeedGateway['previews']>, Parameters<FeedGateway['previews']>>()
    .mockResolvedValue({ items: [item], photos: { [item.id]: 'photo' } });
  const rate = jest
    .fn<ReturnType<FeedGateway['rate']>, Parameters<FeedGateway['rate']>>()
    .mockRejectedValueOnce(new RatingUnavailable());
  const gateway = { load, previews, rate };
  const { result } = renderHook(() => useDiscover(gateway, 'denial-session:fr'));
  await act(async () => {});
  expect(load).toHaveBeenCalledTimes(1);
  expect(result.current.settingsChanged).toBe(true);
  load.mockResolvedValue({ items: [item], hasMore: false });
  await act(async () => {
    await result.current.refresh();
  });
  await act(async () => {
    await result.current.rate(item.id, 4);
  });
  expect(result.current.items).toEqual([]);
  load.mockReturnValueOnce(new Promise(() => {}));
  act(() => mockBlur?.());
  await act(async () => mockFocus?.());
  expect(result.current.items).toEqual([]);
});
