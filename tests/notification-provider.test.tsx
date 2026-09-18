import { AppState } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import { NotificationProvider } from '@/features/notifications/notification-provider';
import { makeSession } from './fixtures';
let mockStatus = 'ready',
  mockSession = makeSession();
let mockTap: (id: string, data: unknown) => void = () => {};
const mockReplace = jest.fn(),
  mockSend = jest.fn(),
  mockPermission = jest.fn(),
  mockToken = jest.fn();
let mockStored = {
  id: '10000000-0000-4000-8000-000000000099',
  secret: 'a'.repeat(64),
  revision: 0,
};
jest.mock('expo-router', () => ({
  router: { replace: (value: unknown) => mockReplace(value) },
  useRootNavigationState: () => ({ key: 'root' }),
}));
jest.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({
    status: mockStatus,
    session: mockStatus === 'signed-out' ? null : mockSession,
  }),
}));
jest.mock('@/services/notifications', () => ({
  syncInstallation: (...args: unknown[]) => mockSend(...args),
}));
jest.mock('@/features/notifications/device', () => ({
  devicePlatform: 'ios',
  permission: (...args: unknown[]) => mockPermission(...args),
  pushToken: () => mockToken(),
  loadInstallation: async () => mockStored,
  saveInstallation: async (value: typeof mockStored) => {
    mockStored = value;
  },
  clearResponses: async () => {},
  observe: (tap: typeof mockTap) => {
    mockTap = tap;
    return () => {};
  },
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockStatus = 'ready';
  mockSession = makeSession();
  mockStored = { ...mockStored, revision: 0 };
  mockSend.mockReset().mockResolvedValue(undefined);
  mockPermission.mockReset().mockResolvedValue('granted');
  mockToken.mockReset().mockResolvedValue('ExpoPushToken[fixture]');
});
it('routes a warm known notification to Today once and ignores routes/other recipients', async () => {
  render(<NotificationProvider>{null}</NotificationProvider>);
  await waitFor(() =>
    expect(mockSend).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: mockSession.user.id }),
      'ExpoPushToken[fixture]',
      'ios',
      expect.anything(),
    ),
  );
  act(() =>
    mockTap('one', { type: 'DAILY_WORDS', userId: mockSession.user.id, route: '/moderation' }),
  );
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(tabs)'));
  act(() => {
    mockTap('one', { type: 'DAILY_WORDS', userId: mockSession.user.id });
    mockTap('two', { type: 'UNKNOWN', userId: mockSession.user.id });
    mockTap('three', { type: 'STREAK_AT_RISK', userId: '10000000-0000-4000-8000-000000000002' });
  });
  expect(mockReplace).toHaveBeenCalledTimes(1);
});
it('holds a cold notification until the matching account finishes authentication', async () => {
  mockStatus = 'signed-out';
  const view = render(<NotificationProvider>{null}</NotificationProvider>);
  act(() => mockTap('cold', { type: 'STREAK_AT_RISK', userId: mockSession.user.id }));
  expect(mockReplace).not.toHaveBeenCalled();
  mockStatus = 'ready';
  view.rerender(<NotificationProvider>{null}</NotificationProvider>);
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(tabs)'));
});
it('rejects a cold notification after login to a different account', async () => {
  mockStatus = 'signed-out';
  const view = render(<NotificationProvider>{null}</NotificationProvider>);
  act(() => mockTap('cold', { type: 'DAILY_WORDS', userId: mockSession.user.id }));
  mockStatus = 'ready';
  mockSession = makeSession('10000000-0000-4000-8000-000000000002');
  view.rerender(<NotificationProvider>{null}</NotificationProvider>);
  await waitFor(() =>
    expect(mockSend).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: mockSession.user.id }),
      'ExpoPushToken[fixture]',
      'ios',
      expect.anything(),
    ),
  );
  expect(mockReplace).not.toHaveBeenCalled();
});
it('revokes on sign-out even when an older registration response never arrives', async () => {
  mockSend.mockImplementation((_value, identity) =>
    identity ? new Promise(() => {}) : Promise.resolve(),
  );
  const view = render(<NotificationProvider>{null}</NotificationProvider>);
  await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(2));
  mockStatus = 'signed-out';
  view.rerender(<NotificationProvider>{null}</NotificationProvider>);
  await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(3));
  expect(mockSend.mock.calls[2][0].revision).toBeGreaterThan(mockSend.mock.calls[1][0].revision);
  expect(mockSend.mock.calls[2][1]).toBeNull();
  expect(mockSend.mock.calls[2][2]).toBeNull();
});

it('re-registers on foreground so a provider-invalidated binding can recover', async () => {
  const listeners = jest.spyOn(AppState, 'addEventListener');
  render(<NotificationProvider>{null}</NotificationProvider>);
  await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(2));
  await act(async () => listeners.mock.calls.at(-1)?.[1]('active'));
  await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(3));
  expect(mockSend.mock.calls[2][0].revision).toBeGreaterThan(mockSend.mock.calls[1][0].revision);
});

it('revokes the old account before a new account token lookup can fail', async () => {
  const view = render(<NotificationProvider>{null}</NotificationProvider>);
  await waitFor(() =>
    expect(mockSend).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: mockSession.user.id }),
      'ExpoPushToken[fixture]',
      'ios',
      expect.anything(),
    ),
  );
  mockSend.mockClear();
  mockToken.mockRejectedValue(new Error('Token service offline'));
  mockSession = makeSession('10000000-0000-4000-8000-000000000002');
  view.rerender(<NotificationProvider>{null}</NotificationProvider>);
  await waitFor(() => expect(mockToken).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(mockSend).toHaveBeenCalled());
  expect(mockSend.mock.calls[0][1]).toBeNull();
  expect(mockSend.mock.calls[0][2]).toBeNull();
});

it('revokes on sign-out even when native permission inspection fails', async () => {
  const view = render(<NotificationProvider>{null}</NotificationProvider>);
  await waitFor(() =>
    expect(mockSend).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: mockSession.user.id }),
      'ExpoPushToken[fixture]',
      'ios',
      expect.anything(),
    ),
  );
  mockSend.mockClear();
  mockPermission.mockRejectedValue(new Error('Native service unavailable'));
  mockStatus = 'signed-out';
  view.rerender(<NotificationProvider>{null}</NotificationProvider>);
  await waitFor(() => expect(mockSend).toHaveBeenCalled());
  expect(mockSend.mock.calls[0][1]).toBeNull();
});
