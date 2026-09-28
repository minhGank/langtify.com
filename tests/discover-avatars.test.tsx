import type * as ReactTypes from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, FlatList } from 'react-native';
import { DiscoverScreen } from '@/features/discover/discover-screen';
import { PostDetail } from '@/features/discover/post-detail';
import { socialChanged } from '@/features/social/cache';
import { serverScope } from '@/lib/server-cache';
import { parseFeedPage, parseFeedPhotos, type FeedItem } from '@/services/discover';
import { makeAccount, makeSession } from './fixtures';

const mockLoad = jest.fn(),
  mockPreviews = jest.fn(),
  mockAvatars = jest.fn();
let mockSession = makeSession(),
  mockAccount = makeAccount(),
  mockFocused = true;
const mockPixels: Record<string, string> = {};
jest.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({ status: 'ready', session: mockSession, account: mockAccount }),
}));
jest.mock('@/features/inbox/notification-bell', () => ({ NotificationBell: () => null }));
jest.mock('@/services/discover', () => ({
  ...jest.requireActual('@/services/discover'),
  feedGateway: () => ({ load: mockLoad, previews: mockPreviews, rate: jest.fn() }),
}));
jest.mock('@/services/avatars', () => ({ avatarGateway: () => ({ previews: mockAvatars }) }));
jest.mock('@/services/social', () => ({
  socialGateway: () => ({ comments: jest.fn().mockResolvedValue({ items: [], hasMore: false }) }),
}));
jest.mock('@/features/social/public-profile', () => ({ PublicProfileSheet: () => null }));
jest.mock('@/lib/image-memory', () => ({
  imageMemory: (scope: string) => ({
    cached: (ids: string[]) =>
      Object.fromEntries(
        ids.flatMap((id) =>
          mockPixels[`${scope}:${id}`] ? [[id, mockPixels[`${scope}:${id}`]]] : [],
        ),
      ),
    resolve: async (urls: Record<string, string | null>, signal: AbortSignal) => {
      if (signal.aborted) throw new Error('Cancelled');
      return Object.fromEntries(
        Object.entries(urls).map(([id, uri]) => {
          if (uri) mockPixels[`${scope}:${id}`] = `data:image/jpeg;base64,${id}`;
          return [id, uri ? mockPixels[`${scope}:${id}`] : null];
        }),
      );
    },
  }),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  Stack: { Screen: () => null },
  useFocusEffect: (effect: () => () => void) => {
    const React = jest.requireActual<typeof ReactTypes>('react');
    const focused = mockFocused;
    React.useEffect(() => (focused ? effect() : undefined), [effect, focused]);
  },
}));
const id = (n: number) => `82000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const row = (n: number, avatarId: string | null = id(90)): FeedItem => ({
  id: id(n),
  targetTerm: `word${n}`,
  referenceTerm: 'translation',
  cefrLevel: 'A1',
  username: `learner${n}`,
  avatarId,
  submittedAt: '2026-09-26T12:00:00.123456Z',
  averageRating: null,
  ratingCount: 0,
  viewerRating: null,
  canRate: true,
});
let catalog: FeedItem[];
const avatar = (n: number) =>
  screen.getByLabelText(`learner${n}'s profile photo`, { includeHiddenElements: true });
beforeEach(() => {
  jest.clearAllMocks();
  mockSession = makeSession();
  mockAccount = makeAccount();
  mockFocused = true;
  Object.keys(mockPixels).forEach((key) => delete mockPixels[key]);
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  catalog = [row(1), row(2), row(3, null)];
  mockLoad.mockReset().mockImplementation(async () => ({ items: catalog, hasMore: false }));
  mockPreviews.mockReset().mockImplementation(async (ids: string[]) => ({
    items: catalog.filter((r) => ids.includes(r.id)),
    photos: Object.fromEntries(ids.map((id) => [id, 'data:image/jpeg;base64,photo'])),
  }));
  mockAvatars
    .mockReset()
    .mockImplementation(async (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, 'https://controlled.test/sign'])),
    );
});

it('batches distinct author references once, displays pixels and keeps no-avatar initials', async () => {
  render(<DiscoverScreen />);
  await waitFor(() =>
    expect(avatar(1)).toHaveProp('source', {
      uri: `data:image/jpeg;base64,${id(90)}`,
      cache: 'reload',
    }),
  );
  expect(avatar(2)).toHaveProp('source');
  expect(avatar(3)).not.toHaveProp('source');
  expect(mockAvatars).toHaveBeenCalledTimes(1);
  expect(mockAvatars).toHaveBeenCalledWith([id(90)], expect.any(AbortSignal));
  expect(mockLoad).toHaveBeenCalledTimes(1);
});
it('reuses downloaded pixels and loaded feed on navigation return without elapsed-time polling', async () => {
  const view = render(<DiscoverScreen />);
  await waitFor(() => expect(avatar(1)).toHaveProp('source'));
  view.unmount();
  const clock = jest.spyOn(performance, 'now').mockReturnValue(36000000);
  render(<DiscoverScreen />);
  await waitFor(() => expect(avatar(1)).toHaveProp('source'));
  expect(mockLoad).toHaveBeenCalledTimes(1);
  expect(mockAvatars).toHaveBeenCalledTimes(1);
  clock.mockRestore();
});
it('paginates without resigning cached authors and updates replaced/removed references on refresh', async () => {
  catalog = [row(1), row(2, id(91))];
  mockLoad.mockResolvedValueOnce({ items: [catalog[0]], hasMore: true });
  const view = render(<DiscoverScreen />);
  await waitFor(() => expect(avatar(1)).toHaveProp('source'));
  fireEvent.press(screen.getByText('Load more'));
  await waitFor(() => expect(avatar(2)).toHaveProp('source'));
  expect(mockAvatars.mock.calls.map(([ids]) => ids)).toEqual([[id(90)], [id(91)]]);
  catalog = [row(1, id(92)), row(2, null)];
  fireEvent(view.UNSAFE_getByType(FlatList), 'refresh');
  await waitFor(() =>
    expect(avatar(1)).toHaveProp('source', {
      uri: `data:image/jpeg;base64,${id(92)}`,
      cache: 'reload',
    }),
  );
  expect(avatar(2)).not.toHaveProp('source');
  expect(mockAvatars).toHaveBeenCalledTimes(3);
});
it('uses initials after denied or failed signing and retries only on explicit refresh', async () => {
  mockAvatars.mockRejectedValueOnce(new Error('Offline'));
  const view = render(<DiscoverScreen />);
  await waitFor(() => expect(mockAvatars).toHaveBeenCalledTimes(1));
  expect(avatar(1)).not.toHaveProp('source');
  fireEvent(view.UNSAFE_getByType(FlatList), 'refresh');
  await waitFor(() => expect(avatar(1)).toHaveProp('source'));
  expect(mockAvatars).toHaveBeenCalledTimes(2);
  fireEvent(avatar(1), 'error');
  expect(avatar(1)).not.toHaveProp('source');
});
it('aborts late avatar results across accounts and never installs old pixels', async () => {
  let finish = (_: Record<string, string>) => {};
  mockAvatars.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const view = render(<DiscoverScreen />);
  await waitFor(() => expect(mockAvatars).toHaveBeenCalledTimes(1));
  const signal: AbortSignal = mockAvatars.mock.calls[0][1];
  mockSession = makeSession('other-account');
  catalog = [row(4, null)];
  view.rerender(<DiscoverScreen />);
  await screen.findByText('@learner4');
  await act(async () => finish({ [id(90)]: 'https://controlled.test/old' }));
  expect(signal.aborted).toBe(true);
  expect(screen.queryByText('@learner1')).toBeNull();
  expect(avatar(4)).not.toHaveProp('source');
  expect(
    mockPixels[`${serverScope(mockSession.user.id, mockSession.access_token)}:${id(90)}`],
  ).toBeUndefined();
});
it('never displays obsolete authors after safety invalidation or target changes', async () => {
  const view = render(<DiscoverScreen />);
  await waitFor(() => expect(avatar(1)).toHaveProp('source'));
  catalog = [];
  act(() => socialChanged('block'));
  await screen.findByText('No photos yet');
  expect(screen.queryByText('@learner1')).toBeNull();
  mockAccount = {
    ...mockAccount,
    learning: { ...mockAccount.learning!, target_language_id: id(98) },
  };
  view.rerender(<DiscoverScreen />);
  await screen.findByText('No photos yet');
  expect(screen.queryByText('@learner1')).toBeNull();
});
it('shares avatar pixels with canonical post detail and does not read for private posts', async () => {
  const feed = render(<DiscoverScreen />);
  await waitFor(() => expect(avatar(1)).toHaveProp('source'));
  feed.unmount();
  const props = {
    item: row(1),
    language: 'French',
    userId: mockSession.user.id,
    token: mockSession.access_token,
    photoRevision: 0,
    reload: jest.fn(),
    rate: jest.fn(),
    ratingAction: null,
    ratingDisabled: false,
    blocked: jest.fn(),
  };
  const post = render(<PostDetail {...props} />);
  await waitFor(() => expect(avatar(1)).toHaveProp('source'));
  expect(mockAvatars).toHaveBeenCalledTimes(1);
  post.rerender(<PostDetail {...props} socialAvailable={false} />);
  await waitFor(() => expect(avatar(1)).not.toHaveProp('source'));
  expect(mockAvatars).toHaveBeenCalledTimes(1);
});
it('does not start avatar reads offscreen or install results after backgrounding', async () => {
  mockFocused = false;
  const view = render(<DiscoverScreen />);
  expect(mockLoad).not.toHaveBeenCalled();
  expect(mockAvatars).not.toHaveBeenCalled();
  mockFocused = true;
  let finish = (_: Record<string, string>) => {};
  mockAvatars.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const listeners = jest.spyOn(AppState, 'addEventListener');
  view.rerender(<DiscoverScreen />);
  await waitFor(() => expect(mockAvatars).toHaveBeenCalledTimes(1));
  const signal: AbortSignal = mockAvatars.mock.calls[0][1];
  act(() => {
    Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'background' });
    for (const [, listener] of listeners.mock.calls) listener('background');
  });
  await act(async () => finish({ [id(90)]: 'https://controlled.test/stale' }));
  expect(signal.aborted).toBe(true);
  expect(
    screen.queryByLabelText("learner1's profile photo", { includeHiddenElements: true }),
  ).not.toHaveProp('source');
});
it('validates the opaque reference, supports staged deployment and preserves it through signing revalidation', () => {
  const identity = { userId: 'viewer', token: 'token', targetLanguageId: 'target' };
  const item = {
    id: id(1),
    target_term: 'dog',
    reference_term: 'chien',
    cefr_level: 'A1',
    username: 'learner',
    submitted_at: row(1).submittedAt,
    average_rating: null,
    rating_count: 0,
    viewer_rating: null,
    can_rate: true,
  };
  const envelope = { viewer_id: 'viewer', target_language_id: 'target', has_more: false };
  for (const value of [undefined, null, id(90)]) {
    const row = { ...item, avatar_id: value };
    expect(parseFeedPage({ ...envelope, items: [row] }, identity).items[0].avatarId).toBe(
      value ?? null,
    );
    const signed_path = `/storage/v1/object/sign/challenge-submissions/${id(2)}/${id(1)}.jpg?token=a.b.c`;
    expect(
      parseFeedPhotos(
        { ...envelope, items: [{ ...row, signed_path }] },
        identity,
        [id(1)],
        'https://api.test',
      ).items[0].avatarId,
    ).toBe(value ?? null);
  }
  for (const avatar_id of ['https://evil.test/avatar', '../private', 42, {}, ''])
    expect(() =>
      parseFeedPage({ ...envelope, items: [{ ...item, avatar_id }] }, identity),
    ).toThrow();
});
