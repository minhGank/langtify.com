import type * as ReactTypes from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, Linking } from 'react-native';
import { NotificationSettingsScreen } from '@/features/notifications/notification-settings-screen';
import type { NotificationPreferences } from '@/features/notifications/model';
import { makeSession } from './fixtures';
let mockSession = makeSession();
const mockApi = { load: jest.fn(), save: jest.fn() };
const mockNative = { permission: 'denied', busy: false, error: null, refresh: jest.fn() };
jest.mock('@/services/notifications', () => ({ notificationGateway: () => mockApi }));
jest.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({ status: 'ready', session: mockSession }),
}));
jest.mock('@/features/notifications/notification-provider', () => ({
  useNotifications: () => mockNative,
}));
jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
  useFocusEffect: (callback: () => () => void) => {
    const React = jest.requireActual<typeof ReactTypes>('react');
    React.useEffect(callback, [callback]);
  },
}));
const defaults: NotificationPreferences = {
  enabled: true,
  dailyWords: true,
  streakReminder: true,
  dailyTime: '08:00',
  streakTime: '19:00',
  timezone: 'America/Toronto',
};
beforeEach(() => {
  jest.clearAllMocks();
  mockSession = makeSession();
  mockApi.load.mockReset().mockResolvedValue(defaults);
  mockApi.save.mockReset().mockResolvedValue(defaults);
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
});
it('keeps permission denial separate from preferences and never claims success after a failed save', async () => {
  const settings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
  render(<NotificationSettingsScreen />);
  await screen.findByText(/Times use your saved timezone: America\/Toronto/);
  expect(screen.getByText('Daily 3 words')).toBeVisible();
  expect(screen.queryByText('Allow notifications')).toBeNull();
  fireEvent.press(screen.getByText('Open device Settings'));
  expect(settings).toHaveBeenCalledTimes(1);
  fireEvent.changeText(screen.getByLabelText('Daily time (HH:MM)'), '25:00');
  expect(screen.getByLabelText('Save preferences')).toBeDisabled();
  fireEvent.changeText(screen.getByLabelText('Daily time (HH:MM)'), '09:15');
  mockApi.save.mockRejectedValueOnce(new Error('internal secret database message'));
  fireEvent.press(screen.getByText('Save preferences'));
  await screen.findByText(/Request could not be confirmed/);
  expect(screen.queryByText(/Preferences saved/)).toBeNull();
  expect(screen.queryByText(/internal secret/)).toBeNull();
  fireEvent.press(screen.getByText('Reload preferences'));
  await waitFor(() =>
    expect(screen.getByLabelText('Daily time (HH:MM)').props.value).toBe('08:00'),
  );
});
it('aborts old account preference loads and ignores their late result', async () => {
  let finish: (value: NotificationPreferences) => void = () => {};
  mockApi.load.mockReturnValueOnce(
    new Promise<NotificationPreferences>((resolve) => {
      finish = resolve;
    }),
  );
  const view = render(<NotificationSettingsScreen />);
  await waitFor(() => expect(mockApi.load).toHaveBeenCalledTimes(1));
  const signal: AbortSignal = mockApi.load.mock.calls[0][0];
  mockSession = makeSession('10000000-0000-4000-8000-000000000002');
  mockApi.load.mockResolvedValue({ ...defaults, timezone: 'Europe/Paris' });
  view.rerender(<NotificationSettingsScreen />);
  await screen.findByText(/Times use your saved timezone: Europe\/Paris/);
  await act(async () => finish(defaults));
  expect(signal.aborted).toBe(true);
  expect(screen.queryByText(/Times use your saved timezone: America\/Toronto/)).toBeNull();
});

it('confirms saved preferences without claiming a notification was delivered', async () => {
  render(<NotificationSettingsScreen />);
  await screen.findByText('Daily 3 words');
  fireEvent.press(screen.getByText('Save preferences'));
  expect(await screen.findByText('Notification preferences saved.')).toBeVisible();
  expect(screen.queryByText(/reminders will not be sent/)).toBeNull();
  expect(screen.queryByText(/notification delivered/i)).toBeNull();
});
