import type * as ReactTypes from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, FlatList } from 'react-native';
import { router } from 'expo-router';
import { Button } from '@/components/ui/button';
import { PastWordsScreen } from '@/features/past-words/past-words-screen';
import { pastWordDate } from '@/features/past-words/past-words-results';
import { pastWordsCache } from '@/features/past-words/cache';
import { invalidateServerData, serverScope, setServerScope } from '@/lib/server-cache';
import { PastWordsUnavailable, type PastWord, type PastWordsPage } from '@/services/past-words';
import { makeAccount, makeOAuthSession, makeSession } from './fixtures';

const mockLoad = jest.fn(),
  mockGateway = jest.fn();
let mockSession = makeSession(),
  mockAccount = makeAccount(),
  mockStatus = 'ready';
jest.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({ status: mockStatus, session: mockSession, account: mockAccount }),
}));
jest.mock('@/services/past-words', () => ({
  ...jest.requireActual('@/services/past-words'),
  pastWordsGateway: (...args: unknown[]) => {
    mockGateway(...args);
    return { load: mockLoad };
  },
}));
jest.mock('expo-router', () => ({
  Stack: {
    Screen: ({ options }: { options: { headerLeft?: () => ReactTypes.ReactNode } }) =>
      options.headerLeft?.() ?? null,
  },
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) },
  useFocusEffect: (callback: () => () => void) => {
    const React = jest.requireActual<typeof ReactTypes>('react');
    React.useEffect(callback, [callback]);
  },
}));
const id = (n: number) => `94000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function word(n = 1, changes: Partial<PastWord> = {}): PastWord {
  return {
    assignmentId: id(n),
    conceptId: id(n + 100),
    challengeDate: '2026-09-21',
    targetTerm: n === 1 ? 'la fenêtre' : `mot ${n}`,
    referenceTerm: n === 1 ? 'window' : `word ${n}`,
    cefrLevel: 'A1',
    hasCapture: false,
    submissionId: null,
    submissionStatus: null,
    captureKind: null,
    ...changes,
  };
}
function page(items: PastWord[] = [word()], hasMore = false): PastWordsPage {
  return { currentLocalDate: '2026-09-22', items, hasMore };
}
const entryKey = () =>
  `${serverScope(mockSession.user.id, mockSession.access_token)}:past-words:${mockAccount.learning?.timezone}::`;
beforeEach(() => {
  jest.clearAllMocks();
  mockLoad.mockReset().mockResolvedValue(page());
  mockSession = makeSession();
  mockAccount = makeAccount();
  mockStatus = 'ready';
  jest.mocked(router.canGoBack).mockReturnValue(true);
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
});
afterEach(() => jest.useRealTimers());

it('presents missing words first with dates and a clear camera-first historical intent', async () => {
  mockLoad.mockResolvedValue(
    page([
      word(),
      word(2, {
        hasCapture: true,
        submissionId: id(200),
        submissionStatus: 'completed',
        captureKind: 'daily',
      }),
    ]),
  );
  render(<PastWordsScreen />);
  await screen.findByText('La fenêtre');
  expect(screen.getByText('Window · A1')).toBeVisible();
  expect(screen.getByText('Still to capture')).toBeVisible();
  expect(screen.getByText('No photo yet')).toBeVisible();
  expect(screen.getByText('+10 XP')).toBeVisible();
  expect(screen.getAllByText(pastWordDate('2026-09-21'))).toHaveLength(2);
  fireEvent.press(screen.getByRole('button', { name: 'Add photo: La fenêtre' }));
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: '/photo',
    params: { assignmentId: id(1), captureKind: 'historical', capture: '1' },
  });
  fireEvent.press(screen.getByRole('button', { name: 'View photos: Mot 2' }));
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: '/vocabulary-concept',
    params: { conceptId: id(102) },
  });
});

it('continues existing pending and deleting photos using their authoritative kind without restarting capture', async () => {
  mockLoad.mockResolvedValue(
    page([
      word(1, { submissionId: id(200), submissionStatus: 'pending', captureKind: 'daily' }),
      word(2, {
        hasCapture: true,
        submissionId: id(201),
        submissionStatus: 'deleting',
        captureKind: 'historical',
      }),
    ]),
  );
  render(<PastWordsScreen />);
  await screen.findByText('Photo in progress');
  fireEvent.press(screen.getByRole('button', { name: 'Resume photo: La fenêtre' }));
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: '/photo',
    params: { assignmentId: id(1), captureKind: 'daily' },
  });
  expect(screen.getByText('Deleting photo')).toBeVisible();
  fireEvent.press(screen.getByRole('button', { name: 'Manage photo: Mot 2' }));
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: '/photo',
    params: { assignmentId: id(2), captureKind: 'historical' },
  });
});

it('provides native back for pushed screens and a fixed Vocabulary fallback for direct entry', async () => {
  jest.mocked(router.canGoBack).mockReturnValue(false);
  render(<PastWordsScreen />);
  fireEvent.press(screen.getByRole('button', { name: 'Back to Vocabulary' }));
  expect(router.replace).toHaveBeenCalledWith('/vocabulary');
  await screen.findByText('La fenêtre');
});

it('shows distinct empty and filtered-empty states and sends search/CEFR to the backend', async () => {
  mockLoad.mockResolvedValue(page([]));
  render(<PastWordsScreen />);
  await screen.findByText('No past words yet');
  fireEvent.changeText(screen.getByLabelText('Search past words'), ' WINDOW ');
  fireEvent(screen.getByLabelText('Search past words'), 'submitEditing');
  await screen.findByText('No matching words');
  expect(mockLoad).toHaveBeenLastCalledWith(
    { search: 'WINDOW', level: '' },
    null,
    expect.any(AbortSignal),
  );
  fireEvent.press(screen.getByRole('button', { name: 'Filter past words' }));
  fireEvent.press(screen.getByRole('button', { name: 'A1' }));
  await waitFor(() =>
    expect(mockLoad).toHaveBeenLastCalledWith(
      { search: 'WINDOW', level: 'A1' },
      null,
      expect.any(AbortSignal),
    ),
  );
  fireEvent.press(screen.getByRole('button', { name: 'Clear level filter' }));
  fireEvent.press(screen.getByRole('button', { name: 'Clear past words search' }));
  expect(await screen.findByText('No past words yet')).toBeVisible();
});

it('debounces typing and cancels superseded search responses', async () => {
  jest.useFakeTimers();
  render(<PastWordsScreen />);
  await act(async () => {});
  fireEvent.changeText(screen.getByLabelText('Search past words'), 'window');
  await act(async () => jest.advanceTimersByTime(200));
  expect(mockLoad).toHaveBeenCalledTimes(1);
  let finish: (value: PastWordsPage) => void = () => {};
  mockLoad.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => jest.advanceTimersByTime(100));
  const signal: AbortSignal = mockLoad.mock.calls.at(-1)?.[2];
  fireEvent.changeText(screen.getByLabelText('Search past words'), 'door');
  mockLoad.mockResolvedValue(page([word(2)]));
  await act(async () => jest.advanceTimersByTime(300));
  expect(signal.aborted).toBe(true);
  await act(async () => finish(page()));
  expect(screen.queryByText('La fenêtre')).toBeNull();
  expect(screen.getByText('Mot 2')).toBeVisible();
});

it('uses missing/captured date-ID keysets, deduplicates pages and bounds stored history to 40 rows', async () => {
  const batch = (start: number, length: number) =>
    Array.from({ length }, (_, i) => word(start + i));
  mockLoad.mockResolvedValueOnce(page(batch(1, 20), true));
  render(<PastWordsScreen />);
  await screen.findByRole('button', { name: 'More past words' });
  mockLoad.mockResolvedValueOnce(page(batch(20, 20), true));
  fireEvent.press(screen.getByRole('button', { name: 'More past words' }));
  await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(2));
  expect(mockLoad).toHaveBeenLastCalledWith(
    { search: '', level: '' },
    { captured: false, date: '2026-09-21', id: id(20) },
    expect.any(AbortSignal),
  );
  const entry = pastWordsCache.entry(entryKey(), ['past-words']);
  await waitFor(() => expect(entry.getSnapshot().data?.items).toHaveLength(39));
  mockLoad.mockResolvedValueOnce(page(batch(40, 20)));
  fireEvent.press(screen.getByRole('button', { name: 'More past words' }));
  await screen.findByRole('button', { name: 'Back to newest words' });
  expect(entry.getSnapshot().data?.items).toHaveLength(40);
  expect(new Set(entry.getSnapshot().data?.items.map((item) => item.assignmentId)).size).toBe(40);
  expect(entry.getSnapshot().data?.items[0].assignmentId).toBe(id(20));
});

it('shares concurrent requests and preserves cached data without time-only or navigation refetch', async () => {
  jest.useFakeTimers();
  const first = render(<PastWordsScreen />);
  await act(async () => {});
  first.unmount();
  await act(async () => jest.advanceTimersByTime(2 * 60 * 60 * 1000));
  render(<PastWordsScreen />);
  await act(async () => {});
  expect(screen.getByText('La fenêtre')).toBeVisible();
  expect(mockLoad).toHaveBeenCalledTimes(1);
  let finish: (value: PastWordsPage) => void = () => {};
  mockLoad.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  fireEvent(screen.getByLabelText('Past words'), 'refresh');
  fireEvent(screen.getByLabelText('Past words'), 'refresh');
  await act(async () => {});
  expect(mockLoad).toHaveBeenCalledTimes(2);
  expect(screen.getByText('La fenêtre')).toBeVisible();
  await act(async () => finish(page()));
});

it('refreshes after capture/deletion invalidation and removes rows only after an authoritative response', async () => {
  render(<PastWordsScreen />);
  await screen.findByText('No photo yet');
  mockLoad.mockResolvedValue(
    page([
      word(1, {
        hasCapture: true,
        submissionId: id(200),
        submissionStatus: 'completed',
        captureKind: 'historical',
      }),
    ]),
  );
  act(() => invalidateServerData(['past-words']));
  await screen.findByRole('button', { name: 'View photos: La fenêtre' });
  expect(screen.queryByRole('button', { name: 'Add photo: La fenêtre' })).toBeNull();
  mockLoad.mockResolvedValue(page());
  act(() => invalidateServerData(['vocabulary']));
  await screen.findByRole('button', { name: 'Add photo: La fenêtre' });
});

it('retains data after a network error, supports retry and clears it on lost access', async () => {
  render(<PastWordsScreen />);
  await screen.findByText('La fenêtre');
  mockLoad.mockRejectedValueOnce(new Error('offline'));
  fireEvent(screen.getByLabelText('Past words'), 'refresh');
  await screen.findByRole('button', { name: 'Try again' });
  expect(screen.getByText('La fenêtre')).toBeVisible();
  mockLoad.mockRejectedValueOnce(new PastWordsUnavailable());
  fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByText('Past words unavailable');
  expect(screen.queryByText('La fenêtre')).toBeNull();
});

it('aborts pending account data and ignores it after account/session switching', async () => {
  let finish: (value: PastWordsPage) => void = () => {};
  mockLoad.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { rerender } = render(<PastWordsScreen />);
  await waitFor(() => expect(mockLoad).toHaveBeenCalled());
  const signal: AbortSignal = mockLoad.mock.calls[0][2];
  mockSession = makeSession('other');
  mockAccount = makeAccount('other');
  mockLoad.mockResolvedValue(page([]));
  act(() => setServerScope(serverScope(mockSession.user.id, mockSession.access_token)));
  rerender(<PastWordsScreen />);
  await screen.findByText('No past words yet');
  expect(signal.aborted).toBe(true);
  await act(async () => finish(page()));
  expect(screen.queryByText('La fenêtre')).toBeNull();
  mockStatus = 'signed-out';
  rerender(<PastWordsScreen />);
  expect(screen.queryByLabelText('Past words')).toBeNull();
});

it('does not read in background and ignores obsolete pagination callbacks', async () => {
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'background' });
  const events = jest.spyOn(AppState, 'addEventListener');
  mockLoad.mockResolvedValue(page([word()], true));
  const view = render(<PastWordsScreen />);
  await act(async () => {});
  expect(mockLoad).not.toHaveBeenCalled();
  await act(async () => {
    Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
    for (const [, listener] of events.mock.calls) listener('active');
  });
  const more = view
    .UNSAFE_getAllByType(Button)
    .find((button) => button.props.label === 'More past words')?.props.onPress;
  if (typeof more !== 'function') throw new Error('Missing pagination action.');
  const calls = mockLoad.mock.calls.length;
  view.unmount();
  await act(async () => more());
  expect(mockLoad).toHaveBeenCalledTimes(calls);
});

it('aborts an in-flight page on background and never installs its delayed response', async () => {
  const events = jest.spyOn(AppState, 'addEventListener');
  let finish: (value: PastWordsPage) => void = () => {};
  mockLoad.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(<PastWordsScreen />);
  await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(1));
  const signal: AbortSignal = mockLoad.mock.calls[0][2];
  act(() => {
    Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'background' });
    for (const [, listener] of events.mock.calls) listener('background');
  });
  expect(signal.aborted).toBe(true);
  await act(async () => finish(page()));
  expect(screen.queryByText('La fenêtre')).toBeNull();
  mockLoad.mockResolvedValue(page([word(2)]));
  await act(async () => {
    Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
    for (const [, listener] of events.mock.calls) listener('active');
  });
  expect(await screen.findByText('Mot 2')).toBeVisible();
  expect(mockLoad).toHaveBeenCalledTimes(2);
});

it('separates a new Auth session for the same user from the previous session cache', async () => {
  mockSession = makeOAuthSession(undefined, 'first-session');
  const view = render(<PastWordsScreen />);
  await screen.findByText('La fenêtre');
  mockSession = makeOAuthSession(undefined, 'second-session');
  mockLoad.mockResolvedValue(page([]));
  view.rerender(<PastWordsScreen />);
  await screen.findByText('No past words yet');
  expect(mockLoad).toHaveBeenCalledTimes(2);
  expect(screen.queryByText('La fenêtre')).toBeNull();
});

it('does not scroll on failed refresh; successful explicit refresh returns to newest', async () => {
  const scroll = jest.spyOn(FlatList.prototype, 'scrollToOffset').mockImplementation(() => {});
  try {
    render(<PastWordsScreen />);
    await screen.findByText('La fenêtre');
    mockLoad.mockRejectedValueOnce(new Error('offline'));
    fireEvent(screen.getByLabelText('Past words'), 'refresh');
    await screen.findByRole('button', { name: 'Try again' });
    expect(scroll).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(scroll).toHaveBeenCalledWith({ offset: 0, animated: false }));
  } finally {
    scroll.mockRestore();
  }
});

it('partitions cached eligibility by the persisted timezone and retains server date display across DST', async () => {
  const view = render(<PastWordsScreen />);
  await screen.findByText('La fenêtre');
  const learning = mockAccount.learning;
  if (!learning) throw new Error('Missing learning fixture.');
  mockAccount = { ...mockAccount, learning: { ...learning, timezone: 'Pacific/Honolulu' } };
  mockLoad.mockResolvedValue(page([]));
  view.rerender(<PastWordsScreen />);
  await screen.findByText('No past words yet');
  expect(mockLoad).toHaveBeenCalledTimes(2);
  expect(pastWordDate('2026-03-08')).toContain('8');
  expect(pastWordDate('2026-11-01')).toContain('1');
});
