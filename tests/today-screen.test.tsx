import type * as ReactTypes from 'react';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react-native';
import { TodayScreen } from '@/features/challenges/today-screen';
import { makeAccount, makeSession } from './fixtures';
import { makeChallenge } from './challenge-fixtures';
import type { TodayChallenge } from '@/services/challenges';
let mockAccount = makeAccount();
let mockSession = makeSession();
const mockLoad = jest.fn<Promise<TodayChallenge>, []>();
const mockReplace = jest.fn<Promise<TodayChallenge>, [string]>();
jest.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({ account: mockAccount, session: mockSession }),
}));
jest.mock('@/services/challenges', () => ({
  ...jest.requireActual('@/services/challenges'),
  challengeGateway: () => ({ load: mockLoad, replace: mockReplace }),
}));
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => () => void) => {
    const React = jest.requireActual<typeof ReactTypes>('react');
    React.useEffect(callback, [callback]);
  },
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockAccount = makeAccount();
  mockSession = makeSession();
  mockLoad.mockResolvedValue(makeChallenge());
  mockReplace.mockResolvedValue(makeChallenge());
});
it('renders the date and all linked cards with replacement actions', async () => {
  render(<TodayScreen />);
  expect(await screen.findByText('la fenêtre')).toBeVisible();
  expect(screen.getByText('window')).toBeVisible();
  expect(screen.getByText('Review · A2')).toBeVisible();
  expect(screen.getByText('Target · B1')).toBeVisible();
  expect(screen.getByText('Stretch · B2')).toBeVisible();
  expect(screen.getByText('2026-09-12 · America/Toronto')).toBeVisible();
  fireEvent.press(screen.getByRole('button', { name: 'Replace review word' }));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('assignment-review'));
});
it('shows controlled failure and a working retry', async () => {
  mockLoad.mockRejectedValueOnce({ message: 'insufficient_vocabulary' });
  render(<TodayScreen />);
  expect(await screen.findByText(/not enough eligible/)).toBeVisible();
  fireEvent.press(screen.getByRole('button', { name: 'Retry challenge' }));
  expect(await screen.findByText('la fenêtre')).toBeVisible();
});
it('clears cards across account and language-profile configuration changes', async () => {
  const { rerender } = render(<TodayScreen />);
  await screen.findByText('la fenêtre');
  let finish: (value: TodayChallenge) => void = () => {};
  mockLoad.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  mockSession = makeSession('other');
  mockAccount = makeAccount('other');
  rerender(<TodayScreen />);
  expect(screen.queryByText('la fenêtre')).toBeNull();
  await act(async () => {
    finish(makeChallenge('other'));
  });
  expect(screen.getByText('la fenêtre')).toBeVisible();
  mockLoad.mockReturnValueOnce(new Promise(() => {}));
  mockAccount = {
    ...mockAccount,
    learning: mockAccount.learning ? { ...mockAccount.learning, cefr_level: 'C2' } : null,
  };
  rerender(<TodayScreen />);
  expect(screen.queryByText('la fenêtre')).toBeNull();
});
