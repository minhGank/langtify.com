import type * as ReactTypes from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { router } from 'expo-router';
import { LearningSettingsScreen } from '@/features/profile/learning-settings-screen';
import { makeAccount, makeSession } from './fixtures';

const mockUpdateLearning = jest.fn();
const mockReload = jest.fn();
let mockSession = makeSession();
let mockAccount = makeAccount();
jest.mock('@/services/social', () => ({
  socialGateway: () => ({ updateLearning: mockUpdateLearning }),
}));
jest.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({
    status: 'ready',
    session: mockSession,
    account: mockAccount,
    reload: mockReload,
    refreshAccount: mockReload,
  }),
}));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  useFocusEffect: (callback: () => () => void) => {
    const React = jest.requireActual<typeof ReactTypes>('react');
    React.useEffect(callback, [callback]);
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateLearning.mockReset().mockResolvedValue(undefined);
  mockSession = makeSession();
  mockAccount = makeAccount();
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
});

it('validates the language pair and saves the selected CEFR with the persisted timezone', async () => {
  render(<LearningSettingsScreen />);
  fireEvent.press(within(screen.getByLabelText('Learning language')).getByLabelText('English'));
  fireEvent.press(screen.getByText('Save learning preferences'));
  expect(mockUpdateLearning).not.toHaveBeenCalled();
  expect(screen.getByText('Choose two different languages.')).toBeVisible();
  fireEvent.press(within(screen.getByLabelText('Learning language')).getByLabelText('French'));
  fireEvent.press(screen.getByLabelText('Advanced'));
  fireEvent.press(screen.getByText('Save learning preferences'));
  await waitFor(() => expect(mockReload).toHaveBeenCalledTimes(1));
  expect(mockUpdateLearning).toHaveBeenCalledWith(
    expect.objectContaining({
      referenceLanguageId: 'en',
      targetLanguageId: 'fr',
      cefrLevel: 'C1',
      timezone: 'America/Toronto',
    }),
    expect.any(AbortSignal),
  );
  expect(router.back).toHaveBeenCalledTimes(1);
});

it('ignores an uncertain settings response after switching accounts', async () => {
  let finish = () => {};
  mockUpdateLearning.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const view = render(<LearningSettingsScreen />);
  fireEvent.press(screen.getByLabelText('Advanced'));
  fireEvent.press(screen.getByText('Save learning preferences'));
  await waitFor(() => expect(mockUpdateLearning).toHaveBeenCalledTimes(1));
  const signal: AbortSignal = mockUpdateLearning.mock.calls[0][1];
  mockSession = makeSession('another-account');
  mockAccount = makeAccount('another-account');
  view.rerender(<LearningSettingsScreen />);
  await act(async () => finish());
  expect(signal.aborted).toBe(true);
  expect(mockReload).not.toHaveBeenCalled();
  expect(router.back).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Intermediate')).toHaveProp(
    'accessibilityState',
    expect.objectContaining({ checked: true }),
  );
});
