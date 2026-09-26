import type * as ReactTypes from 'react';
import { router, Stack } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { AppState } from 'react-native';
import { AuthProvider, useAuth } from '@/features/auth/auth-provider';
import type { SessionGateway, useSessionState } from '@/features/auth/use-session-state';
import { EditProfileScreen } from '@/features/profile/edit-profile-screen';
import { ProfileIdentity } from '@/features/profile/profile-identity';
import { PublicProfileScreen } from '@/features/social/public-profile';
import { Button } from '@/components/ui/button';
import { AppText } from '@/components/ui/app-text';
import { makeAccount, makeSession } from './fixtures';

const mockAccountRead = jest.fn();
const mockUpdateUsername = jest.fn();
const mockProfileRead = jest.fn();
const mockRestore = jest.fn();
const mockSubscribe = jest.fn();
const mockSessionGateway: SessionGateway = {
  restore: () => mockRestore(),
  subscribe: (listener) => mockSubscribe(listener),
  loadAccount: (userId) => mockAccountRead(userId),
};
let mockAccount = makeAccount();
jest.mock('@/features/auth/auth-provider', () => {
  const React = jest.requireActual<typeof ReactTypes>('react');
  const { useSessionState: useState } = jest.requireActual<{
    useSessionState: typeof useSessionState;
  }>('@/features/auth/use-session-state');
  const Context = React.createContext<ReturnType<typeof useSessionState> | null>(null);
  return {
    AuthProvider({ children }: ReactTypes.PropsWithChildren) {
      return React.createElement(
        Context.Provider,
        { value: useState(mockSessionGateway) },
        children,
      );
    },
    useAuth() {
      const context = React.useContext(Context);
      if (!context) throw new Error('Missing test Auth context.');
      return context;
    },
  };
});
jest.mock('@/services/social', () => ({
  socialGateway: () => ({
    profile: (...args: unknown[]) => mockProfileRead(...args),
    updateUsername: (...args: unknown[]) => mockUpdateUsername(...args),
  }),
}));
jest.mock('@/features/social/public-profile-posts', () => ({ PublicProfilePosts: () => null }));
jest.mock('@/features/profile/avatar-editor', () => ({ AvatarEditor: () => null }));

function TestNavigation() {
  const { status } = useAuth();
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={status !== 'ready'}>
        <Stack.Screen name="session" />
      </Stack.Protected>
      <Stack.Protected guard={status === 'ready'}>
        <Stack.Screen name="profile" />
        <Stack.Screen name="edit-profile" />
        <Stack.Screen name="public-profile" />
        <Stack.Screen name="connections" />
      </Stack.Protected>
    </Stack>
  );
}
function TestLayout() {
  return (
    <AuthProvider>
      <TestNavigation />
    </AuthProvider>
  );
}
function TestProfile() {
  const { session, account } = useAuth();
  if (!session) return null;
  return (
    <>
      <AppText variant="title">Profile</AppText>
      <ProfileIdentity
        userId={session.user.id}
        token={session.access_token}
        username={account?.profile?.username ?? ''}
      />
    </>
  );
}
const routes = {
  _layout: TestLayout,
  session: () => <AppText>Restoring account</AppText>,
  profile: TestProfile,
  'edit-profile': EditProfileScreen,
  'public-profile': PublicProfileScreen,
  connections: () => (
    <>
      <AppText>Connection list</AppText>
      <Button label="Back to profile" onPress={() => router.back()} />
    </>
  ),
};

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  mockAccount = makeAccount();
  mockRestore.mockResolvedValue(makeSession());
  mockSubscribe.mockReturnValue(() => {});
  mockAccountRead.mockImplementation(async () => mockAccount);
  mockUpdateUsername.mockImplementation(async (username: string) => {
    if (!mockAccount.profile) throw new Error('Missing profile fixture.');
    mockAccount = { ...mockAccount, profile: { ...mockAccount.profile, username } };
  });
  mockProfileRead.mockImplementation(async () => ({
    id: mockAccount.profile?.public_id,
    username: mockAccount.profile?.username,
    isSelf: true,
    isFollowing: false,
    followerCount: 0,
    followingCount: 0,
    avatarId: null,
  }));
});

it.each([false, true])(
  'saves a %s changed username from the normal Profile stack without resetting auth/navigation',
  async (changed) => {
    const app = renderRouter(routes, { initialUrl: '/profile' });
    await screen.findByText('@learner');
    fireEvent.press(screen.getByRole('button', { name: 'Edit profile' }));
    await screen.findByLabelText('Username');
    expect(app.getPathname()).toBe('/edit-profile');
    if (changed) fireEvent.changeText(screen.getByLabelText('Username'), 'New_Name');
    if (changed) fireEvent.press(screen.getByText('Save username'));
    else {
      expect(screen.getByRole('button', { name: 'Save username' })).toBeDisabled();
      fireEvent.press(screen.getByText('Save username'));
      expect(app.getPathname()).toBe('/edit-profile');
      fireEvent.press(screen.getByLabelText('Back to Profile'));
    }
    await waitFor(() => expect(app.getPathname()).toBe('/profile'));
    await screen.findByText(changed ? '@new_name' : '@learner');
    expect(mockUpdateUsername).toHaveBeenCalledTimes(changed ? 1 : 0);
    expect(mockAccountRead).toHaveBeenCalledTimes(changed ? 2 : 1);
    expect(mockProfileRead).toHaveBeenCalledTimes(changed ? 2 : 1);
    expect(mockRestore).toHaveBeenCalledTimes(1);
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
  },
);

it.each([false, true])(
  'returns a directly opened Edit Profile to Profile when username changed is %s',
  async (changed) => {
    // Ready state is restored before protected direct navigation, matching a
    // warm/deep-linked ready account without a Profile screen in its back stack.
    const app = renderRouter(routes, { initialUrl: '/profile' });
    await screen.findByText('@learner');
    act(() => router.replace('/edit-profile'));
    await screen.findByLabelText('Username');
    expect(router.canGoBack()).toBe(false);
    if (changed) fireEvent.changeText(screen.getByLabelText('Username'), 'new_name');
    if (changed) fireEvent.press(screen.getByText('Save username'));
    else {
      expect(screen.getByRole('button', { name: 'Save username' })).toBeDisabled();
      fireEvent.press(screen.getByText('Save username'));
      expect(app.getPathname()).toBe('/edit-profile');
      fireEvent.press(screen.getByLabelText('Back to Profile'));
    }
    await waitFor(() => expect(app.getPathname()).toBe('/profile'));
    expect(mockUpdateUsername).toHaveBeenCalledTimes(changed ? 1 : 0);
    expect(mockAccountRead).toHaveBeenCalledTimes(changed ? 2 : 1);
    expect(mockRestore).toHaveBeenCalledTimes(1);
  },
);

it('treats equivalent normalized usernames as a no-op and ignores duplicate save presses', async () => {
  const app = renderRouter(routes, { initialUrl: '/profile' });
  await screen.findByText('@learner');
  fireEvent.press(screen.getByRole('button', { name: 'Edit profile' }));
  fireEvent.changeText(await screen.findByLabelText('Username'), ' LEARNER ');
  const save = screen.getByText('Save username');
  fireEvent.press(save);
  fireEvent.press(save);
  expect(screen.getByRole('button', { name: 'Save username' })).toBeDisabled();
  expect(app.getPathname()).toBe('/edit-profile');
  expect(mockUpdateUsername).not.toHaveBeenCalled();
  expect(mockAccountRead).toHaveBeenCalledTimes(1);
});

it('waits for one authoritative account refresh while retaining the Edit Profile route', async () => {
  const app = renderRouter(routes, { initialUrl: '/profile' });
  await screen.findByText('@learner');
  fireEvent.press(screen.getByRole('button', { name: 'Edit profile' }));
  fireEvent.changeText(await screen.findByLabelText('Username'), 'new_name');
  let finish = () => {};
  mockAccountRead.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve(mockAccount);
      }),
  );
  fireEvent.press(screen.getByText('Save username'));
  await waitFor(() => expect(mockAccountRead).toHaveBeenCalledTimes(2));
  expect(app.getPathname()).toBe('/edit-profile');
  expect(screen.queryByText('Restoring account')).toBeNull();
  expect(screen.getByRole('button', { name: 'Save username' })).toBeDisabled();
  await act(async () => finish());
  await waitFor(() => expect(app.getPathname()).toBe('/profile'));
});

it('opens Edit Profile through the accessible profile-photo action', async () => {
  const app = renderRouter(routes, { initialUrl: '/profile' });
  await screen.findByText('@learner');
  fireEvent.press(screen.getByRole('button', { name: 'Edit profile' }));
  expect(await screen.findByLabelText('Username')).toBeVisible();
  expect(app.getPathname()).toBe('/edit-profile');
});

it('opens follower lists from own and public profiles without blur cleanup popping the next route', async () => {
  const app = renderRouter(routes, { initialUrl: '/profile' });
  await screen.findByText('@learner');
  fireEvent.press(screen.getByRole('button', { name: '0 followers' }));
  await screen.findByText('Connection list');
  expect(app.getPathname()).toBe('/connections');
  fireEvent.press(screen.getByRole('button', { name: 'Back to profile' }));
  await waitFor(() => expect(app.getPathname()).toBe('/profile'));
  expect(mockProfileRead).toHaveBeenCalledTimes(1);
  act(() => router.push('/public-profile'));
  await waitFor(() => expect(app.getPathname()).toBe('/public-profile'));
  fireEvent.press(screen.getByRole('button', { name: '0 following' }));
  await screen.findByText('Connection list');
  await act(async () => {});
  expect(app.getPathname()).toBe('/connections');
  fireEvent.press(screen.getByRole('button', { name: 'Back to profile' }));
  await waitFor(() => expect(app.getPathname()).toBe('/public-profile'));
});

it('disables Save again after changing a username back and removes redundant profile actions', async () => {
  const app = renderRouter(routes, { initialUrl: '/profile' });
  await screen.findByText('@learner');
  expect(screen.getAllByRole('button', { name: 'Edit profile' })).toHaveLength(1);
  expect(screen.queryByRole('button', { name: 'View public profile' })).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Edit profile' }));
  const input = await screen.findByLabelText('Username');
  fireEvent.changeText(input, 'another_name');
  expect(screen.getByRole('button', { name: 'Save username' })).toBeEnabled();
  fireEvent.changeText(input, ' LEARNER ');
  expect(screen.getByRole('button', { name: 'Save username' })).toBeDisabled();
  fireEvent.press(screen.getByText('Save username'));
  expect(mockUpdateUsername).not.toHaveBeenCalled();
  expect(app.getPathname()).toBe('/edit-profile');
});
