import type * as ReactTypes from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, FlatList } from 'react-native';
import { router } from 'expo-router';
import { BlockedUsersScreen } from '@/features/safety/blocked-users-screen';
import { PublicProfileScreen } from '@/features/social/public-profile';
import { blockedCache, unblockChanged } from '@/features/safety/blocked-cache';
import { serverScope, setServerScope } from '@/lib/server-cache';
import { makeSession } from './fixtures';
import { SafetyUnavailable } from '@/features/safety/model';

let mockSession = makeSession();
let mockParams: { blockId?: string; profileId?: string } = {};
const mockBlocks = jest.fn(),
  mockProfile = jest.fn(),
  mockUnblock = jest.fn(),
  mockAvatars = jest.fn();
const mockPublic = jest.fn();
const mockPixels = new Map<string, Record<string, string>>();
jest.mock('@/services/safety', () => ({
  safetyGateway: () => ({ blocks: mockBlocks, blockedProfile: mockProfile, unblock: mockUnblock }),
}));
jest.mock('@/services/social', () => ({ socialGateway: () => ({ profile: mockPublic }) }));
jest.mock('@/services/avatars', () => ({ avatarGateway: () => ({ previews: mockAvatars }) }));
jest.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({ session: mockSession, status: 'ready' }),
}));
jest.mock('@/lib/image-memory', () => ({
  imageMemory: (scope: string, purpose: string) => {
    const key = `${scope}:${purpose}`;
    const data = mockPixels.get(key) ?? {};
    mockPixels.set(key, data);
    return {
      cached: (ids: string[]) =>
        Object.fromEntries(ids.filter((id) => data[id]).map((id) => [id, data[id]])),
      resolve: async (urls: Record<string, string | null>) => {
        for (const [id, url] of Object.entries(urls))
          if (url) data[id] = 'data:image/jpeg;base64,/9j/2Q==';
        return data;
      },
    };
  },
}));
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (callback: () => () => void) => {
    const React = jest.requireActual<typeof ReactTypes>('react');
    React.useEffect(callback, [callback]);
  },
}));
const id = (n: number) => `91000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rows = [1, 2].map((n) => ({ id: id(n), username: `learner${n}`, avatarId: id(n + 100) }));
beforeEach(() => {
  jest.clearAllMocks();
  mockSession = makeSession();
  mockParams = {};
  mockPixels.clear();
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  mockBlocks.mockReset().mockResolvedValue({ items: rows, hasMore: false });
  mockProfile.mockReset().mockResolvedValue(rows[0]);
  mockUnblock.mockReset().mockResolvedValue(undefined);
  mockAvatars
    .mockReset()
    .mockImplementation(async (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, 'https://controlled.invalid/avatar'])),
    );
});

it('uses one recognition avatar batch and opens a blocked route without unblocking', async () => {
  render(<BlockedUsersScreen />);
  await screen.findByText('@learner1');
  await waitFor(() => expect(mockAvatars).toHaveBeenCalledTimes(1));
  expect(mockAvatars).toHaveBeenCalledWith(
    rows.map((row) => row.avatarId),
    expect.any(AbortSignal),
    'blocked',
  );
  fireEvent.press(screen.getByLabelText('View blocked account @learner1'));
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/public-profile',
    params: { blockId: id(1) },
  });
  expect(mockUnblock).not.toHaveBeenCalled();
  expect(mockProfile).not.toHaveBeenCalled();
  expect(mockPublic).not.toHaveBeenCalled();
});
it('shows only recognition while blocked and requires explicit unblock', async () => {
  mockParams = { blockId: id(1) };
  render(<PublicProfileScreen />);
  await screen.findByText('Blocked account');
  expect(screen.getByText('@learner1')).toBeVisible();
  expect(screen.queryByText(/Level|Followers|Following|Public photos/)).toBeNull();
  expect(mockPublic).not.toHaveBeenCalled();
  expect(mockUnblock).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Unblock'));
  await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
  expect(mockUnblock).toHaveBeenCalledWith(id(1), expect.any(AbortSignal));
});
it('rejects ambiguous or arbitrary blocked routes without attempting normal profile reads', () => {
  mockParams = { blockId: '../other', profileId: id(1) };
  render(<PublicProfileScreen />);
  expect(screen.getByText('This blocked account is unavailable.')).toBeVisible();
  expect(mockPublic).not.toHaveBeenCalled();
  expect(mockProfile).not.toHaveBeenCalled();
});
it('retains the cached list when returning from a profile, without elapsed-time fetching', async () => {
  jest.useFakeTimers();
  const first = render(<BlockedUsersScreen />);
  await act(async () => {});
  first.unmount();
  await act(async () => jest.advanceTimersByTime(3600000));
  render(<BlockedUsersScreen />);
  await act(async () => {});
  expect(screen.getByText('@learner1')).toBeVisible();
  expect(mockBlocks).toHaveBeenCalledTimes(1);
  expect(mockAvatars).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});
it('bounds paginated identity rows to forty and preserves cursor after unblocking the tail', async () => {
  let offset = 0;
  mockBlocks.mockImplementation(async () => ({
    items: Array.from({ length: 20 }, () => ({
      id: id(++offset),
      username: `person${offset}`,
      avatarId: null,
    })),
    hasMore: true,
  }));
  render(<BlockedUsersScreen />);
  for (let i = 0; i < 3; i++) {
    const button = await screen.findByText('More accounts');
    await act(async () => fireEvent.press(button));
  }
  const entry = blockedCache.entry(
    `${serverScope(mockSession.user.id, mockSession.access_token)}:blocked-users`,
    ['blocked-users', 'safety'],
  );
  expect(entry.getSnapshot().data?.items).toHaveLength(40);
  const tail = entry.getSnapshot().data?.items.at(-1);
  expect(tail?.id).toBe(id(80));
  // Virtualized rows may not mount the tail. Reconciliation must preserve its cursor.
  act(() =>
    unblockChanged({ userId: mockSession.user.id, token: mockSession.access_token }, id(80)),
  );
  fireEvent.press(screen.getByText('More accounts'));
  await waitFor(() => expect(mockBlocks).toHaveBeenLastCalledWith(id(80), expect.any(AbortSignal)));
});
it('does not install an old-account blocked profile or avatar response', async () => {
  let finish = (_value: (typeof rows)[number]) => {};
  mockProfile
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    )
    .mockRejectedValue(new SafetyUnavailable());
  mockParams = { blockId: id(1) };
  const view = render(<PublicProfileScreen />);
  await waitFor(() => expect(mockProfile).toHaveBeenCalledTimes(1));
  const signal: AbortSignal = mockProfile.mock.calls[0][1];
  mockSession = makeSession(id(99));
  act(() => setServerScope(serverScope(mockSession.user.id, mockSession.access_token)));
  view.rerender(<PublicProfileScreen />);
  await act(async () => finish(rows[0]));
  expect(signal.aborted).toBe(true);
  expect(screen.queryByText('@learner1')).toBeNull();
  expect(mockAvatars).not.toHaveBeenCalled();
});
it('shows a concise empty state and a retry action on a genuine failure', async () => {
  mockBlocks
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ items: [], hasMore: false });
  render(<BlockedUsersScreen />);
  fireEvent.press(await screen.findByText('Refresh blocked accounts'));
  await screen.findByText('No blocked accounts');
  expect(mockBlocks).toHaveBeenCalledTimes(2);
});

it('explicit refresh retries unavailable avatar batches and returns to the first page only on success', async () => {
  const scroll = jest.spyOn(FlatList.prototype, 'scrollToOffset').mockImplementation(() => {});
  mockAvatars.mockResolvedValueOnce({});
  render(<BlockedUsersScreen />);
  await waitFor(() => expect(mockAvatars).toHaveBeenCalledTimes(1));
  await act(async () => {});
  fireEvent(screen.UNSAFE_getByType(FlatList), 'refresh');
  await waitFor(() => expect(mockAvatars).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(scroll).toHaveBeenCalledWith({ offset: 0, animated: false }));
  expect(mockBlocks).toHaveBeenCalledTimes(2);
  scroll.mockRestore();
});
