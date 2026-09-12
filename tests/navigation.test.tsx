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
import type { SessionState } from '@/features/auth/session-state';
import { makeAccount, makeSession } from './fixtures';

let mockState: SessionState;
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
    const title = label === 'Today' ? "Today's Challenge" : label;
    expect(await screen.findByRole('header', { name: title })).toBeVisible();
    expect(app.getPathname()).toBe(path);
  }
});

it.each([
  ['/discover', 'Discover'],
  ['/vocabulary', 'Vocabulary'],
  ['/profile', 'Profile'],
])('opens the %s route directly', async (path, title) => {
  const app = renderRouter(routes, { initialUrl: path });
  expect(await screen.findByRole('header', { name: title })).toBeVisible();
  expect(app.getPathname()).toBe(path);
});

it.each([
  ['signed-out', '/sign-in', 'Sign in'],
  ['onboarding', '/onboarding', 'Welcome to Langtify'],
  ['loading', '/session', 'Langtify'],
  ['error', '/session', 'Langtify'],
  ['unconfigured', '/session', 'Langtify'],
] as const)('blocks a direct main route while %s', async (status, path, title) => {
  mockState = { ...mockState, status };
  const app = renderRouter(routes, { initialUrl: '/profile' });
  expect(await screen.findByRole('header', { name: title })).toBeVisible();
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
  expect(await screen.findByRole('header', { name: 'Welcome to Langtify' })).toBeVisible();
  expect(app.getPathname()).toBe('/onboarding');
});
