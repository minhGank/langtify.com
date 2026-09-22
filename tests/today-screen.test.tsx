import type * as ReactTypes from 'react';
import { AppState } from 'react-native';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react-native';
import { TodayScreen } from '@/features/challenges/today-screen';
import { makeAccount, makeSession } from './fixtures';
import { makeChallenge } from './challenge-fixtures';
import type { TodayChallenge } from '@/services/challenges';
jest.mock('@/features/inbox/notification-bell', () => ({ NotificationBell: () => null }));
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
  expect(await screen.findByText('La fenêtre')).toBeVisible();
});
it('renders linked vocabulary cards and accessible replacement actions', async () => {
  render(<TodayScreen />);
  expect(await screen.findByText('La fenêtre')).toBeVisible();
  expect(screen.getByText('Window')).toBeVisible();
  expect(screen.getByText('Review · A2')).toBeVisible();
  expect(screen.getByText('Target · B1')).toBeVisible();
  expect(screen.getByText('Stretch · B2')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Refresh challenge' })).toBeNull();
  fireEvent.press(screen.getAllByRole('button', { name: 'Replace' })[0]);
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('assignment-review'));
});
it('shows controlled failure and a working retry', async () => {
  mockLoad.mockRejectedValueOnce({ message: 'insufficient_vocabulary' });
  render(<TodayScreen />);
  expect(await screen.findByText(/not enough eligible/)).toBeVisible();
  fireEvent.press(screen.getByRole('button', { name: 'Retry challenge' }));
  expect(await screen.findByText('La fenêtre')).toBeVisible();
});
it('clears cards across account and language-profile configuration changes', async () => {
  const { rerender } = render(<TodayScreen />);
  await screen.findByText('La fenêtre');
  let finish: (value: TodayChallenge) => void = () => {};
  mockLoad.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  mockSession = makeSession('other');
  mockAccount = makeAccount('other');
  rerender(<TodayScreen />);
  expect(screen.queryByText('La fenêtre')).toBeNull();
  await act(async () => {
    finish(makeChallenge('other'));
  });
  expect(screen.getByText('La fenêtre')).toBeVisible();
  mockLoad.mockReturnValueOnce(new Promise(() => {}));
  mockAccount = {
    ...mockAccount,
    learning: mockAccount.learning ? { ...mockAccount.learning, cefr_level: 'C2' } : null,
  };
  await act(async () => rerender(<TodayScreen />));
  expect(screen.queryByText('La fenêtre')).toBeNull();
});

it('shows completed cards with View Photo and no replacement action', async () => {
  const challenge = makeChallenge();
  challenge.words[0].submission = { id: 'submission', status: 'completed', captureKind: 'daily' };
  mockLoad.mockResolvedValue(challenge);
  render(<TodayScreen />);
  expect(await screen.findByText('Completed')).toBeVisible();
  expect(
    screen
      .getAllByRole('button', { name: 'Replace' })
      .map((button) => button.props.accessibilityHint),
  ).not.toContain('Replace the review word: la fenêtre');
  fireEvent.press(screen.getByRole('button', { name: 'View photo · review' }));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/photo',
    params: { assignmentId: 'assignment-review' },
  });
});
it('offers recovery instead of replacement while an upload is pending', async () => {
  const challenge = makeChallenge();
  challenge.words[0].submission = { id: 'submission', status: 'pending', captureKind: 'daily' };
  mockLoad.mockResolvedValue(challenge);
  render(<TodayScreen />);
  expect(await screen.findByRole('button', { name: 'Resume photo · review' })).toBeVisible();
  expect(
    screen
      .getAllByRole('button', { name: 'Replace' })
      .map((button) => button.props.accessibilityHint),
  ).not.toContain('Replace the review word: la fenêtre');
  expect(screen.queryByText('Completed')).toBeNull();
});
it('shows Captured without daily completion when timezone travel brings a historical photo into Today', async () => {
  const challenge = makeChallenge();
  challenge.words[0].submission = {
    id: 'historical-photo',
    status: 'completed',
    captureKind: 'historical',
  };
  mockLoad.mockResolvedValue(challenge);
  render(<TodayScreen />);
  expect(await screen.findByText('Captured')).toBeVisible();
  expect(screen.queryByText('Completed')).toBeNull();
  expect(screen.getAllByRole('button', { name: 'Replace' })).toHaveLength(2);
  fireEvent.press(screen.getByRole('button', { name: 'View photo · review' }));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/photo',
    params: { assignmentId: 'assignment-review' },
  });
});

it('opens capture directly from the explicit Take photo action', async () => {
  render(<TodayScreen />);
  fireEvent.press(await screen.findByRole('button', { name: 'Take photo · review' }));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/photo',
    params: { assignmentId: 'assignment-review', capture: '1' },
  });
});
it('offers authoritative state recovery after an uncertain replacement without replaying it', async () => {
  mockReplace.mockRejectedValueOnce(new Error('network interrupted'));
  render(<TodayScreen />);
  fireEvent.press((await screen.findAllByRole('button', { name: 'Replace' }))[0]);
  const check = await screen.findByRole('button', { name: 'Check challenge state' });
  const reads = mockLoad.mock.calls.length;
  fireEvent.press(check);
  await waitFor(() => expect(mockLoad.mock.calls.length).toBeGreaterThan(reads));
  expect(mockReplace).toHaveBeenCalledTimes(1);
  expect(await screen.findByText('La fenêtre')).toBeVisible();
});

it('keeps server-authoritative challenges usable when device timezone data is older', async () => {
  if (!mockAccount.learning) throw new Error('Expected learning fixture.');
  mockAccount = {
    ...mockAccount,
    learning: { ...mockAccount.learning, timezone: 'Server/New_Zone' },
  };
  render(<TodayScreen />);
  expect(await screen.findByText('La fenêtre')).toBeVisible();
  expect(mockLoad).toHaveBeenCalledTimes(1);
});
