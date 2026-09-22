import type * as ReactTypes from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, FlatList } from 'react-native';
import { router } from 'expo-router';
import { ConnectionsContent, ConnectionsScreen } from '@/features/social/connections-screen';
import { parseConnections, type Connection } from '@/services/connections';
import {
  connectionsCache,
  followChanged,
  profileCache,
  socialChanged,
} from '@/features/social/cache';
import { SafetyUnavailable } from '@/features/safety/model';
import { serverScope } from '@/lib/server-cache';
import { makeSession } from './fixtures';

const mockLoad = jest.fn(),
  mockFollow = jest.fn(),
  mockAvatars = jest.fn();
let mockSession = makeSession();
let mockParams: { profileId?: string; kind?: string } = {};
const mockPixels: Record<string, string> = {};
jest.mock('@/services/connections', () => ({
  ...jest.requireActual('@/services/connections'),
  connectionsGateway: () => ({ load: mockLoad }),
}));
jest.mock('@/services/social', () => ({
  ...jest.requireActual('@/services/social'),
  socialGateway: () => ({ follow: mockFollow }),
}));
jest.mock('@/services/avatars', () => ({ avatarGateway: () => ({ previews: mockAvatars }) }));
jest.mock('@/lib/image-memory', () => ({
  imageMemory: (scope: string) => ({
    cached: (ids: string[]) =>
      Object.fromEntries(
        ids.flatMap((id) =>
          mockPixels[`${scope}:${id}`] ? [[id, mockPixels[`${scope}:${id}`]]] : [],
        ),
      ),
    resolve: async (urls: Record<string, string | null>) =>
      Object.fromEntries(
        Object.entries(urls).map(([id, uri]) => {
          if (uri) mockPixels[`${scope}:${id}`] = 'data:image/jpeg;base64,/9j/2Q==';
          return [id, uri ? mockPixels[`${scope}:${id}`] : null];
        }),
      ),
  }),
}));
jest.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({ status: 'ready', session: mockSession }),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) },
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (callback: () => () => void) => {
    const React = jest.requireActual<typeof ReactTypes>('react');
    React.useEffect(callback, [callback]);
  },
}));
const id = (n: number) => `81000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const profile = {
  id: id(1),
  username: 'parent',
  avatarId: null,
  isSelf: false,
  isFollowing: false,
  followerCount: 4,
  followingCount: 3,
};
const viewer = { ...profile, id: id(2), username: 'myself', isSelf: true };
const row = (n: number): Connection => ({
  id: id(n),
  username: `learner${n}`,
  avatarId: id(n + 100),
  isSelf: false,
  isFollowing: false,
  followedAt: '2026-09-22T10:00:00.123456Z',
});
const identity = () => ({ userId: mockSession.user.id, token: mockSession.access_token });
const content = (kind: 'followers' | 'following' = 'followers') => (
  <ConnectionsContent identity={identity()} profileId={profile.id} kind={kind} />
);
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(performance, 'now').mockImplementation(() => Date.now());
  mockSession = makeSession();
  mockParams = { profileId: profile.id, kind: 'followers' };
  Object.keys(mockPixels).forEach((key) => delete mockPixels[key]);
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  mockLoad.mockReset().mockResolvedValue({ profile, items: [row(3), row(4)], hasMore: false });
  mockAvatars
    .mockReset()
    .mockImplementation(async (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, 'https://controlled.example/sign'])),
    );
  mockFollow.mockReset().mockResolvedValue({
    profile: { ...profile, ...row(3), isFollowing: true, followerCount: 5 },
    viewerProfile: viewer,
    followedAt: '2026-09-22T12:00:00.000000Z',
  });
});

it('shows followers with one avatar batch and opens the opaque public profile target', async () => {
  render(content());
  await screen.findByText('@learner3');
  await waitFor(() => expect(mockAvatars).toHaveBeenCalledTimes(1));
  expect(mockAvatars).toHaveBeenCalledWith([id(103), id(104)], expect.any(AbortSignal));
  fireEvent.press(screen.getByLabelText('View @learner3'));
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/public-profile',
    params: { profileId: id(3) },
  });
  expect(mockLoad).toHaveBeenCalledTimes(1);
});
it('keeps loaded pages and pixels on return regardless of elapsed time; refresh is explicit', async () => {
  const view = render(content());
  await waitFor(() => expect(mockAvatars).toHaveBeenCalledTimes(1));
  await screen.findByLabelText("learner3's avatar");
  view.unmount();
  const now = jest.spyOn(performance, 'now').mockReturnValue(36000000);
  const revisit = render(content());
  await screen.findByText('@learner3');
  expect(mockLoad).toHaveBeenCalledTimes(1);
  expect(mockAvatars).toHaveBeenCalledTimes(1);
  fireEvent(revisit.UNSAFE_getByType(FlatList), 'refresh');
  await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(2));
  now.mockRestore();
});
it('advances using exact server timestamp/ID, deduplicates pages, and retains the cursor on a revisit', async () => {
  mockLoad
    .mockResolvedValueOnce({ profile, items: [row(3)], hasMore: true })
    .mockResolvedValueOnce({ profile, items: [row(3), row(4)], hasMore: false });
  const view = render(content('following'));
  fireEvent.press(await screen.findByText('More learners'));
  await screen.findByText('@learner4');
  expect(screen.getAllByText('@learner3')).toHaveLength(1);
  expect(mockLoad).toHaveBeenCalledTimes(2);
  expect(mockLoad).toHaveBeenLastCalledWith(
    { time: row(3).followedAt, id: id(3) },
    expect.any(AbortSignal),
  );
  view.unmount();
  render(content('following'));
  expect(await screen.findByText('@learner4')).toBeVisible();
  expect(mockLoad).toHaveBeenCalledTimes(2);
});
it('renders empty states and never offers a self-follow action', async () => {
  mockLoad.mockResolvedValueOnce({ profile, items: [], hasMore: false });
  const view = render(content());
  await screen.findByText('No followers yet');
  expect(mockAvatars).not.toHaveBeenCalled();
  view.unmount();
  mockLoad.mockResolvedValueOnce({
    profile,
    items: [{ ...row(2), isSelf: true, avatarId: null }],
    hasMore: false,
  });
  render(content('following'));
  await screen.findByText('You');
  expect(screen.queryByLabelText('Follow @learner2')).toBeNull();
});
it('installs confirmed follow state immediately without rereading the list', async () => {
  render(content());
  fireEvent.press(await screen.findByLabelText('Follow @learner3'));
  await screen.findByLabelText('Unfollow @learner3');
  expect(mockFollow).toHaveBeenCalledWith(id(3), true, expect.any(AbortSignal));
  expect(mockLoad).toHaveBeenCalledTimes(1);
});
it('patches own counts and removes an unfollowed row from cached following while isolating other sessions', () => {
  const scope = serverScope(identity().userId, identity().token);
  const own = profileCache.entry(`${scope}:profile:self`, ['follows']);
  own.set(viewer);
  const target = profileCache.entry(`${scope}:profile:${id(3)}`, ['follows']);
  target.set({ ...profile, id: id(3) });
  const other = profileCache.entry('other:session:profile:self', ['follows']);
  other.set(viewer);
  const cached = connectionsCache.entry(`${scope}:connections:${viewer.id}:following`, [
    'connections',
  ]);
  cached.set({
    profile: viewer,
    items: [{ ...row(3), isFollowing: true }],
    hasMore: false,
    kind: 'following',
    cursor: { time: row(3).followedAt, id: id(3) },
    fromLatest: true,
  });
  followChanged(identity(), {
    profile: { ...profile, id: id(3), followerCount: 3 },
    viewerProfile: { ...viewer, followingCount: 2 },
    followedAt: null,
  });
  expect(own.getSnapshot().data?.followingCount).toBe(2);
  expect(target.getSnapshot().data?.followerCount).toBe(3);
  expect(cached.getSnapshot().data?.items).toEqual([]);
  expect(other.getSnapshot().data?.followingCount).toBe(3);
});
it('requires authoritative refresh before retrying an uncertain follow', async () => {
  mockFollow.mockRejectedValueOnce(new Error('Lost acknowledgement'));
  render(content());
  fireEvent.press(await screen.findByLabelText('Follow @learner3'));
  await screen.findByText(/Request could not be confirmed/);
  expect(screen.queryByLabelText('Follow @learner3')).toBeNull();
  fireEvent.press(screen.getByText('Refresh list'));
  await waitFor(() => expect(screen.getByLabelText('Follow @learner3')).not.toBeDisabled());
  expect(mockLoad).toHaveBeenCalledTimes(2);
  expect(mockFollow).toHaveBeenCalledTimes(1);
});
it('clears rows after a block/restriction denial and does not silently retry', async () => {
  mockFollow.mockRejectedValueOnce(new SafetyUnavailable('List unavailable.'));
  render(content());
  fireEvent.press(await screen.findByLabelText('Follow @learner3'));
  await screen.findByText('List unavailable.');
  expect(screen.queryByText('@learner3')).toBeNull();
  expect(mockLoad).toHaveBeenCalledTimes(1);
});
it('does not install stale rows or send avatar requests after switching accounts', async () => {
  let finish = (_: unknown) => {};
  mockLoad
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    )
    .mockResolvedValue({ profile, items: [], hasMore: false });
  const view = render(<ConnectionsScreen />);
  await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(1));
  const signal: AbortSignal = mockLoad.mock.calls[0][1];
  mockSession = makeSession('other-account');
  view.rerender(<ConnectionsScreen />);
  await act(async () => finish({ profile, items: [row(3)], hasMore: false }));
  expect(signal.aborted).toBe(true);
  expect(screen.queryByText('@learner3')).toBeNull();
  expect(mockAvatars).not.toHaveBeenCalled();
});
it('supports direct-entry back fallback and rejects injected route parameters', async () => {
  jest.mocked(router.canGoBack).mockReturnValueOnce(false);
  const view = render(<ConnectionsScreen />);
  fireEvent.press(screen.getByLabelText('Back'));
  expect(router.replace).toHaveBeenCalledWith('/profile');
  await screen.findByText('@learner3');
  view.unmount();
  mockParams = { profileId: 'https://evil.example', kind: 'following' };
  render(<ConnectionsScreen />);
  expect(screen.getByText('This list is unavailable.')).toBeVisible();
  expect(mockLoad).toHaveBeenCalledTimes(1);
});
it('invalidates connection metadata on block while preserving unrelated private resources', async () => {
  render(content());
  await screen.findByText('@learner3');
  mockLoad.mockRejectedValue(new SafetyUnavailable());
  act(() => socialChanged('block'));
  await waitFor(() => expect(screen.queryByText('@learner3')).toBeNull());
});
it('rejects cross-account/profile envelopes, duplicate and oversized pages and self-follow state', () => {
  const publicProfile = {
    id: profile.id,
    username: profile.username,
    is_self: false,
    is_following: false,
    follower_count: 4,
    following_count: 3,
    avatar_id: null,
  };
  const data = { viewer_id: identity().userId, profile: publicProfile, items: [], has_more: false };
  expect(parseConnections(data, identity(), profile.id).items).toEqual([]);
  expect(() => parseConnections({ ...data, viewer_id: 'other' }, identity(), profile.id)).toThrow();
  expect(() => parseConnections(data, identity(), id(7))).toThrow();
  const item = {
    id: id(3),
    username: 'learner',
    avatar_id: null,
    is_self: true,
    is_following: true,
    followed_at: row(3).followedAt,
  };
  expect(() => parseConnections({ ...data, items: [item] }, identity(), profile.id)).toThrow();
  expect(() =>
    parseConnections(
      { ...data, items: Array(21).fill({ ...item, is_following: false }) },
      identity(),
      profile.id,
    ),
  ).toThrow();
  expect(() =>
    parseConnections({ ...data, items: [item, item] }, identity(), profile.id),
  ).toThrow();
});

it('uses initials after a failed avatar batch and retries that batch only on explicit refresh', async () => {
  mockAvatars.mockRejectedValueOnce(new Error('Transport unavailable'));
  const view = render(content());
  await screen.findByText('@learner3');
  await waitFor(() => expect(mockAvatars).toHaveBeenCalledTimes(1));
  expect(screen.getByLabelText("learner3's avatar")).not.toHaveProp('source');
  fireEvent(view.UNSAFE_getByType(FlatList), 'refresh');
  await waitFor(() =>
    expect(screen.getByLabelText("learner3's avatar")).toHaveProp('source', {
      uri: 'data:image/jpeg;base64,/9j/2Q==',
      cache: 'reload',
    }),
  );
  expect(mockAvatars).toHaveBeenCalledTimes(2);
});

it('reconciles a follow committed before blur, without replay or late acknowledgement overwriting the refreshed list', async () => {
  let finish = (_: unknown) => {};
  mockFollow.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const view = render(content());
  fireEvent.press(await screen.findByLabelText('Follow @learner3'));
  await waitFor(() => expect(mockFollow).toHaveBeenCalledTimes(1));
  const signal: AbortSignal = mockFollow.mock.calls[0][2];
  view.unmount();
  expect(signal.aborted).toBe(true);
  expect(mockLoad).toHaveBeenCalledTimes(1);
  mockLoad.mockResolvedValue({
    profile,
    items: [{ ...row(3), isFollowing: true }],
    hasMore: false,
  });
  render(content());
  await screen.findByLabelText('Unfollow @learner3');
  expect(mockLoad).toHaveBeenCalledTimes(2);
  await act(async () =>
    finish({
      profile: { ...profile, ...row(3), isFollowing: true },
      viewerProfile: viewer,
      followedAt: row(3).followedAt,
    }),
  );
  expect(screen.getByLabelText('Unfollow @learner3')).toBeVisible();
  expect(mockLoad).toHaveBeenCalledTimes(2);
  expect(mockFollow).toHaveBeenCalledTimes(1);
});
it('late acknowledgement from an old account never clears the new account list', async () => {
  let finish = (_: unknown) => {};
  mockFollow.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const view = render(<ConnectionsScreen />);
  fireEvent.press(await screen.findByLabelText('Follow @learner3'));
  await waitFor(() => expect(mockFollow).toHaveBeenCalledTimes(1));
  mockSession = makeSession('other-account');
  mockLoad.mockResolvedValue({ profile, items: [row(9)], hasMore: false });
  view.rerender(<ConnectionsScreen />);
  await screen.findByText('@learner9');
  await act(async () =>
    finish({
      profile: { ...profile, ...row(3), isFollowing: true },
      viewerProfile: viewer,
      followedAt: row(3).followedAt,
    }),
  );
  expect(screen.getByText('@learner9')).toBeVisible();
  expect(screen.queryByText('@learner3')).toBeNull();
});
