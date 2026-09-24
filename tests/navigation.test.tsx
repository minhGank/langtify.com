import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import TabLayout from '../app/(tabs)/_layout';
import DiscoverScreen from '../app/(tabs)/discover';
import TodayScreen from '../app/(tabs)/index';
import ProfileScreen from '../app/(tabs)/profile';
import VocabularyScreen from '../app/(tabs)/vocabulary';
import RootLayout from '../app/_layout';
import SignInRoute from '../app/sign-in';
import SignUpRoute from '../app/sign-up';
import OnboardingRoute from '../app/onboarding';
import SessionRoute from '../app/session';
import PhotoRoute from '../app/photo';
import ConceptRoute from '../app/vocabulary-concept';
import OAuthCallback from '../app/auth/callback';
import BlockedUsersRoute from '../app/blocked-users';
import ModerationRoute from '../app/moderation';
import NotificationSettingsRoute from '../app/notification-settings';
import EditProfileRoute from '../app/edit-profile';
import LearningSettingsRoute from '../app/learning-settings';
import PeopleRoute from '../app/people';
import PublicProfileRoute from '../app/public-profile';
import ConnectionsRoute from '../app/connections';
import InboxRoute from '../app/notifications';
import PostRoute from '../app/post';
import ExploreRoute from '../app/explore';
import ExploreConceptRoute from '../app/explore-concept';
import type { SessionState } from '@/features/auth/session-state';
import { makeAccount, makeSession } from './fixtures';

let mockState: SessionState;
const mockModerationQueue = jest.fn();
jest.mock('@/services/inbox', () => ({
  inboxGateway: () => ({
    summary: async () => ({ unreadCount: 0, readCursor: null }),
    page: async () => ({ items: [], hasMore: false, unreadCount: 0, readCursor: null }),
  }),
}));
jest.mock('@/features/notifications/device', () => ({
  permission: async () => 'unavailable',
  pushToken: async () => null,
  observe: () => () => {},
  clearResponses: async () => {},
}));
jest.mock('@/services/safety', () => ({
  safetyGateway: () => ({
    access: async () => ({ moderator: false, restricted: false }),
    blocks: async () => ({ items: [], hasMore: false }),
    queue: mockModerationQueue,
  }),
}));
jest.mock('@/services/social', () => ({
  socialGateway: () => ({
    profile: async () => ({
      id: '99000000-0000-4000-8000-000000000001',
      username: 'learner',
      isSelf: true,
      isFollowing: false,
      followerCount: 0,
      followingCount: 0,
      avatarId: null,
    }),
  }),
}));
jest.mock('@/features/auth/auth-provider', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({ ...mockState, reload: jest.fn() }),
}));
beforeEach(() => {
  mockState = { status: 'ready', session: makeSession(), account: makeAccount() };
});

const routes = {
  _layout: RootLayout,
  'sign-in': SignInRoute,
  'sign-up': SignUpRoute,
  onboarding: OnboardingRoute,
  session: SessionRoute,
  photo: PhotoRoute,
  'vocabulary-concept': ConceptRoute,
  'auth/callback': OAuthCallback,
  'blocked-users': BlockedUsersRoute,
  moderation: ModerationRoute,
  'notification-settings': NotificationSettingsRoute,
  'edit-profile': EditProfileRoute,
  'learning-settings': LearningSettingsRoute,
  people: PeopleRoute,
  'public-profile': PublicProfileRoute,
  connections: ConnectionsRoute,
  notifications: InboxRoute,
  post: PostRoute,
  explore: ExploreRoute,
  'explore-concept': ExploreConceptRoute,
  '(tabs)/_layout': TabLayout,
  '(tabs)/index': TodayScreen,
  '(tabs)/discover': DiscoverScreen,
  '(tabs)/vocabulary': VocabularyScreen,
  '(tabs)/profile': ProfileScreen,
};

it('opens Today and navigates through all four tabs', async () => {
  const app = renderRouter(routes, { initialUrl: '/' });

  expect(await screen.findByRole('header', { name: "Today's Challenge" })).toBeVisible();
  expect(app.getPathname()).toBe('/');

  for (const [label, path] of [
    ['Discover', '/discover'],
    ['Vocabulary', '/vocabulary'],
    ['Profile', '/profile'],
    ['Today', '/'],
  ]) {
    fireEvent.press(screen.getByLabelText(label));
    const title =
      label === 'Today' ? "Today's Challenge" : label === 'Vocabulary' ? 'My Vocabulary' : label;
    expect(await screen.findByRole('header', { name: title })).toBeVisible();
    expect(app.getPathname()).toBe(path);
  }
});

it('shows no moderator navigation or data to an ordinary learner', async () => {
  const app = renderRouter(routes, { initialUrl: '/profile' });
  expect(await screen.findByText('Blocked users')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Moderation' })).toBeNull();
  app.unmount();
  renderRouter(routes, { initialUrl: '/moderation' });
  expect(await screen.findByText('Moderator access is required.')).toBeVisible();
  expect(mockModerationQueue).not.toHaveBeenCalled();
});

it.each([
  '/blocked-users',
  '/moderation',
  '/notification-settings',
  '/edit-profile',
  '/learning-settings',
  '/people',
  '/public-profile',
  '/connections',
  '/notifications',
  '/post',
  '/explore',
  '/explore-concept',
])('protects %s from signed-out sessions', async (path) => {
  mockState = { ...mockState, status: 'signed-out', session: null };
  const app = renderRouter(routes, { initialUrl: path });
  expect(await screen.findByRole('header', { name: 'Sign in' })).toBeVisible();
  expect(app.getPathname()).toBe('/sign-in');
});

it('opens the in-app inbox from the global bell while native push is unavailable and returns to Profile', async () => {
  const app = renderRouter(routes, { initialUrl: '/profile' });
  fireEvent.press(await screen.findByLabelText('Notifications'));
  expect(await screen.findByRole('header', { name: 'Notifications' })).toBeVisible();
  expect(app.getPathname()).toBe('/notifications');
  fireEvent.press(screen.getByLabelText('Back'));
  expect(await screen.findByRole('header', { name: 'Profile' })).toBeVisible();
  expect(app.getPathname()).toBe('/profile');
});

it.each(['/connections', '/notifications', '/post', '/explore', '/explore-concept'])(
  'requires onboarding for direct entry into %s',
  async (route) => {
    mockState = { ...mockState, status: 'onboarding' };
    const app = renderRouter(routes, { initialUrl: route });
    expect(await screen.findByRole('header', { name: 'Make it yours' })).toBeVisible();
    expect(app.getPathname()).toBe('/onboarding');
  },
);

it.each([
  ['/discover', 'Discover'],
  ['/vocabulary', 'My Vocabulary'],
  ['/profile', 'Profile'],
])('opens the %s route directly', async (path, title) => {
  const app = renderRouter(routes, { initialUrl: path });
  expect(await screen.findByRole('header', { name: title })).toBeVisible();
  expect(app.getPathname()).toBe(path);
});

it.each([
  ['signed-out', '/sign-in', 'Sign in'],
  ['onboarding', '/onboarding', 'Make it yours'],
  ['loading', '/session', 'Langtify'],
  ['error', '/session', 'Langtify'],
  ['unconfigured', '/session', 'Langtify'],
] as const)('blocks a direct main route while %s', async (status, path, title) => {
  mockState = { ...mockState, status };
  const app = renderRouter(routes, { initialUrl: '/profile' });
  expect(
    await screen.findByRole(path === '/session' ? 'image' : 'header', { name: title }),
  ).toBeVisible();
  expect(app.getPathname()).toBe(path);
  expect(screen.queryByRole('header', { name: 'Profile' })).toBeNull();
});
it('redirects completed users away from authentication', async () => {
  const app = renderRouter(routes, { initialUrl: '/sign-in' });
  expect(await screen.findByRole('header', { name: "Today's Challenge" })).toBeVisible();
  expect(app.getPathname()).toBe('/');
});
it('redirects incomplete authenticated users away from authentication', async () => {
  mockState = { ...mockState, status: 'onboarding' };
  const app = renderRouter(routes, { initialUrl: '/sign-up' });
  expect(await screen.findByRole('header', { name: 'Make it yours' })).toBeVisible();
  expect(app.getPathname()).toBe('/onboarding');
});
it('blocks direct photo routes without an authenticated onboarded account', async () => {
  mockState = { ...mockState, status: 'signed-out', session: null };
  const app = renderRouter(routes, {
    initialUrl: '/photo?assignmentId=45000000-0000-4000-8000-000000000002',
  });
  expect(await screen.findByRole('header', { name: 'Sign in' })).toBeVisible();
  expect(app.getPathname()).toBe('/sign-in');
  expect(screen.queryByLabelText('Your challenge photo')).toBeNull();
});

it.each(['ready', 'onboarding'] as const)(
  'routes a Google return through the existing %s gate',
  async (status) => {
    mockState = { ...mockState, status };
    const app = renderRouter(routes, { initialUrl: '/auth/callback' });
    expect(
      await screen.findByRole('header', {
        name: status === 'ready' ? "Today's Challenge" : 'Make it yours',
      }),
    ).toBeVisible();
    expect(app.getPathname()).toBe(status === 'ready' ? '/' : '/onboarding');
  },
);
it('keeps a malformed signed-out callback outside protected content', async () => {
  mockState = { ...mockState, status: 'signed-out', session: null, account: null };
  const app = renderRouter(routes, { initialUrl: '/auth/callback' });
  expect(
    await screen.findByText('This sign-in link is unavailable. Please try again.'),
  ).toBeVisible();
  fireEvent.press(screen.getByRole('button', { name: 'Back to sign in' }));
  expect(await screen.findByRole('header', { name: 'Sign in' })).toBeVisible();
  expect(app.getPathname()).toBe('/sign-in');
});
