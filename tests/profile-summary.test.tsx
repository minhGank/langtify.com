import type * as ReactTypes from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { router } from 'expo-router';
import { ProfileScreen } from '@/features/profile/profile-screen';
import { followChanged } from '@/features/social/cache';
import { invalidateServerData, serverScope } from '@/lib/server-cache';
import type { Progress, ProgressIdentity } from '@/services/progress';
import { makeAccount, makeSession } from './fixtures';

let mockSession = makeSession(),
  mockAccount = makeAccount();
const mockProfile = jest.fn(),
  mockProgress = jest.fn(),
  mockPublicPosts = jest.fn();
jest.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({ status: 'ready', session: mockSession, account: mockAccount }),
}));
jest.mock('@/features/inbox/notification-bell', () => ({ NotificationBell: () => null }));
jest.mock('@/features/auth/sign-out-button', () => ({ SignOutButton: () => null }));
jest.mock('@/features/safety/profile-safety', () => ({ ProfileSafety: () => null }));
jest.mock('@/services/social', () => ({ socialGateway: () => ({ profile: mockProfile }) }));
jest.mock('@/services/progress', () => ({
  progressGateway: (identity: ProgressIdentity) => () => mockProgress(identity),
}));
jest.mock('@/features/social/public-profile-posts', () => ({
  PublicProfilePosts: () => {
    mockPublicPosts();
    return null;
  },
}));
jest.mock('expo-router', () => ({
  router: { navigate: jest.fn(), push: jest.fn() },
  useFocusEffect: (effect: () => () => void) => {
    const React = jest.requireActual<typeof ReactTypes>('react');
    React.useEffect(effect, [effect]);
  },
}));
const profile = {
  id: '99000000-0000-4000-8000-000000000001',
  username: 'learner',
  avatarId: null,
  isSelf: true,
  isFollowing: false,
  followerCount: 12,
  followingCount: 8,
  level: 1,
};
const progress: Progress = {
  completedWords: 1,
  level: 7,
  totalXp: 620,
  xpIntoLevel: 80,
  xpForNextLevel: 160,
  nextLevelXp: 700,
  currentStreak: 7,
  longestStreak: 18,
  totalWordsCompleted: 40,
  totalChallengesCompleted: 10,
};
beforeEach(() => {
  jest.clearAllMocks();
  mockSession = makeSession();
  mockAccount = makeAccount();
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  mockProfile.mockReset().mockResolvedValue(profile);
  mockProgress.mockReset().mockResolvedValue(progress);
});
it('groups authoritative level with social counts and replaces the public grid with existing owner browsing', async () => {
  render(<ProfileScreen />);
  await screen.findByLabelText('Level 7');
  expect(screen.getByText('@learner')).toBeVisible();
  expect(screen.getByRole('button', { name: '12 followers' })).toBeVisible();
  expect(screen.getByRole('button', { name: '8 following' })).toBeVisible();
  expect(screen.queryByText('Your public photos')).toBeNull();
  expect(mockPublicPosts).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'My photos' }));
  expect(router.navigate).toHaveBeenCalledWith('/vocabulary');
  fireEvent.press(screen.getByRole('button', { name: '12 followers' }));
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/connections',
    params: { profileId: profile.id, kind: 'followers' },
  });
  fireEvent.press(screen.getByRole('button', { name: '8 following' }));
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: '/connections',
    params: { profileId: profile.id, kind: 'following' },
  });
  expect(mockProgress).toHaveBeenCalledTimes(1);
});
it('preserves progress details behind disclosure without repeating Level or making a second read', async () => {
  render(<ProfileScreen />);
  await screen.findByLabelText('Level 7');
  expect(screen.queryByText('620 XP')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Learning progress' }));
  expect(screen.getByRole('button', { name: 'Learning progress' })).toHaveProp(
    'accessibilityState',
    {
      expanded: true,
    },
  );
  expect(screen.getByText('80 / 160 XP to Level 8')).toBeVisible();
  expect(screen.getByLabelText('Longest streak: 18 days')).toBeVisible();
  expect(screen.getByLabelText('Words completed: 40')).toBeVisible();
  expect(screen.getAllByLabelText('Level 7')).toHaveLength(1);
  expect(screen.queryByText('Level 7')).toBeNull();
  expect(mockProgress).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByRole('button', { name: 'Learning progress' }));
  expect(screen.queryByLabelText('Longest streak: 18 days')).toBeNull();
});
it('keeps profile editing and learning/account entry points on their existing routes', async () => {
  render(<ProfileScreen />);
  await screen.findByLabelText('Level 7');
  for (const [label, path] of [
    ['Edit profile', '/edit-profile'],
    ['Learning preferences', '/learning-settings'],
    ['Notification settings', '/notification-settings'],
  ]) {
    fireEvent.press(screen.getByRole('button', { name: label }));
    expect(router.push).toHaveBeenLastCalledWith(path);
  }
});
it('shows Level 1 correctly and never invents a level or counts while unavailable', async () => {
  mockProgress.mockRejectedValueOnce(new Error('Offline'));
  mockProfile.mockRejectedValueOnce(new Error('Offline'));
  render(<ProfileScreen />);
  await screen.findByText('We couldn’t load your progress. Try again.');
  expect(screen.queryByLabelText('Level 1')).toBeNull();
  expect(screen.getByRole('button', { name: 'followers unavailable' })).toBeDisabled();
  mockProgress.mockResolvedValue({
    ...progress,
    level: 1,
    totalXp: 0,
    xpIntoLevel: 0,
    xpForNextLevel: 40,
    nextLevelXp: 40,
  });
  fireEvent.press(screen.getByText('Retry progress'));
  await screen.findByLabelText('Level 1');
  mockProfile.mockResolvedValue(profile);
  fireEvent.press(screen.getByRole('button', { name: 'Retry profile summary' }));
  await screen.findByRole('button', { name: '12 followers' });
});
it('updates confirmed following counts from the existing shared cache without reloading profile', async () => {
  render(<ProfileScreen />);
  await screen.findByRole('button', { name: '8 following' });
  act(() =>
    followChanged(
      { userId: mockSession.user.id, token: mockSession.access_token },
      {
        profile: {
          ...profile,
          id: '99000000-0000-4000-8000-000000000002',
          isSelf: false,
          isFollowing: true,
        },
        viewerProfile: { ...profile, followingCount: 9 },
        followedAt: '2026-09-26T12:00:00Z',
      },
    ),
  );
  expect(screen.getByRole('button', { name: '9 following' })).toBeVisible();
  expect(mockProfile).toHaveBeenCalledTimes(1);
});
it('reuses navigation cache and reloads progress only on relevant invalidation', async () => {
  const view = render(<ProfileScreen />);
  await screen.findByLabelText('Level 7');
  view.unmount();
  render(<ProfileScreen />);
  await screen.findByLabelText('Level 7');
  expect(mockProgress).toHaveBeenCalledTimes(1);
  mockProgress.mockResolvedValue({
    ...progress,
    level: 8,
    totalXp: 700,
    xpIntoLevel: 0,
    xpForNextLevel: 180,
    nextLevelXp: 880,
  });
  act(() =>
    invalidateServerData(['progress'], {
      scope: serverScope(mockSession.user.id, mockSession.access_token),
    }),
  );
  await screen.findByLabelText('Level 8');
  expect(mockProfile).toHaveBeenCalledTimes(1);
});
it('ignores a previous account level and clears expanded private progress on account switch', async () => {
  let finish = (_: Progress) => {};
  mockProgress.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const view = render(<ProfileScreen />);
  await waitFor(() => expect(mockProgress).toHaveBeenCalledTimes(1));
  fireEvent.press(screen.getByRole('button', { name: 'Learning progress' }));
  mockSession = makeSession('other-user');
  mockAccount = makeAccount('other-user');
  mockProgress.mockResolvedValue({
    ...progress,
    level: 1,
    totalXp: 0,
    xpIntoLevel: 0,
    xpForNextLevel: 40,
    nextLevelXp: 40,
  });
  mockProfile.mockResolvedValue({ ...profile, username: 'newlearner', followerCount: 0 });
  view.rerender(<ProfileScreen />);
  await screen.findByLabelText('Level 1');
  await act(async () => finish(progress));
  expect(screen.queryByLabelText('Level 7')).toBeNull();
  expect(screen.getByRole('button', { name: 'Learning progress' })).toHaveProp(
    'accessibilityState',
    {
      expanded: false,
    },
  );
  expect(screen.queryByText('620 XP')).toBeNull();
  expect(screen.getByRole('button', { name: '0 followers' })).toBeVisible();
});
