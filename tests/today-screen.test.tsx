import type * as ReactTypes from 'react';
import { AppState } from 'react-native';
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
jest.mock('@/services/submissions', () => ({ listUnfinishedPhotos: async () => [] }));
jest.mock('@/services/challenges', () => ({
  ...jest.requireActual('@/services/challenges'),
  challengeGateway: () => ({ load: mockLoad, replace: mockReplace }),
}));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  useFocusEffect: (callback: () => () => void) => {
    const React = jest.requireActual<typeof ReactTypes>('react');
    React.useEffect(callback, [callback]);
  },
}));
beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    writable: true,
    value: 'active',
  });
  mockAccount = makeAccount();
  mockSession = makeSession();
  mockLoad.mockResolvedValue(makeChallenge());
  mockReplace.mockResolvedValue(makeChallenge());
});
it('defers background startup until foreground instead of generating a challenge while inactive', async () => {
  AppState.currentState = 'background';
  const listeners = jest.spyOn(AppState, 'addEventListener');
  render(<TodayScreen />);
  await act(async () => {});
  expect(mockLoad).not.toHaveBeenCalled();
  AppState.currentState = 'active';
  await act(async () => {
    for (const [, callback] of listeners.mock.calls) callback('active');
  });
  expect(await screen.findByText('la fenêtre')).toBeVisible();
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
  await act(async () => rerender(<TodayScreen />));
  expect(screen.queryByText('la fenêtre')).toBeNull();
});

it('shows completed cards with View Photo and no replacement action', async () => {
  const challenge = makeChallenge();
  challenge.words[0].submission = { id: 'submission', status: 'completed' };
  mockLoad.mockResolvedValue(challenge);
  render(<TodayScreen />);
  expect(await screen.findByText('✓ Completed')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Replace review word' })).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'View Photo · review' }));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/photo',
    params: { assignmentId: 'assignment-review' },
  });
});
it('offers recovery instead of replacement while an upload is pending', async () => {
  const challenge = makeChallenge();
  challenge.words[0].submission = { id: 'submission', status: 'pending' };
  mockLoad.mockResolvedValue(challenge);
  render(<TodayScreen />);
  expect(await screen.findByRole('button', { name: 'Resume photo · review' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Replace review word' })).toBeNull();
  expect(screen.queryByText('✓ Completed')).toBeNull();
});
