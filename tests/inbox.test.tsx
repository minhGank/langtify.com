import type * as ReactTypes from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { AppState, FlatList, type AppStateStatus } from 'react-native';
import { router } from 'expo-router';
import { InboxContent, InboxScreen } from '@/features/inbox/inbox-screen';
import { NotificationBell } from '@/features/inbox/notification-bell';
import { inboxEntries } from '@/features/inbox/cache';
import { useInbox } from '@/features/inbox/use-inbox';
import { inboxDestination } from '@/features/inbox/navigation';
import { SafetyUnavailable } from '@/features/safety/model';
import { invalidateServerData, serverScope, setServerScope } from '@/lib/server-cache';
import {
  parseInboxNotification,
  parseInboxPage,
  parseInboxSummary,
  parseInboxTarget,
  type InboxNotification,
  type InboxPage,
  type InboxOpenReceipt,
} from '@/services/inbox';
import { makeSession } from './fixtures';
import { feedback } from '@/lib/haptics';
jest.mock('@/lib/haptics', () => ({
  feedback: { confirm: jest.fn(), selection: jest.fn(), success: jest.fn() },
}));

const mockGateway = {
  openInbox: jest.fn(),
  summary: jest.fn(),
  page: jest.fn(),
  read: jest.fn(),
  readAll: jest.fn(),
  resolve: jest.fn(),
};
let mockSession = makeSession();
let mockStatus = 'ready';
let mockOpeningSequence = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: () => `88000000-0000-4000-9000-${String(++mockOpeningSequence).padStart(12, '0')}`,
}));
const listeners = new Set<(state: AppStateStatus) => void>();
jest.mock('@/services/inbox', () => ({
  ...jest.requireActual('@/services/inbox'),
  inboxGateway: () => mockGateway,
}));
jest.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({ status: mockStatus, session: mockSession }),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) },
  useFocusEffect: (callback: () => () => void) => {
    const React = jest.requireActual<typeof ReactTypes>('react');
    React.useEffect(callback, [callback]);
  },
}));
const id = (n: number) => `88000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const time = '2026-09-22T12:00:00.123456+00:00';
const follower: InboxNotification = {
  id: id(1),
  kind: 'NEW_FOLLOWER',
  createdAt: time,
  read: false,
  profileId: id(11),
  username: 'learner',
};
const rating: InboxNotification = {
  id: id(2),
  kind: 'NEW_RATING',
  createdAt: time,
  read: false,
  assignmentId: id(12),
  targetTerm: 'le chien',
};
const daily: InboxNotification = {
  id: id(3),
  kind: 'DAILY_WORDS_READY',
  createdAt: time,
  read: false,
  challengeId: id(13),
};
const page: InboxPage = {
  items: [follower, rating, daily],
  hasMore: false,
  unreadCount: 3,
  readCursor: { time, id: id(3) },
};
const identity = { userId: makeSession().user.id, token: makeSession().access_token };
function change(state: AppStateStatus) {
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: state });
  listeners.forEach((listener) => listener(state));
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}
beforeEach(() => {
  jest.clearAllMocks();
  for (const fn of Object.values(mockGateway)) fn.mockReset();
  mockSession = makeSession();
  mockStatus = 'ready';
  mockOpeningSequence = 0;
  listeners.clear();
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    writable: true,
    value: 'active',
  });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => {
    listeners.add(listener);
    return { remove: () => listeners.delete(listener) };
  });
  mockGateway.openInbox.mockImplementation(async (_request: string, ids: string[]) => ({
    openedAt: time,
    unreadCount: 0,
    readCursor: page.readCursor,
    readStates: ids.map((id) => ({ id, read: true })),
  }));
  mockGateway.summary.mockResolvedValue({ unreadCount: 3, readCursor: page.readCursor });
  mockGateway.page.mockResolvedValue(page);
  mockGateway.read.mockResolvedValue({ unreadCount: 2 });
  mockGateway.readAll.mockResolvedValue({ unreadCount: 0 });
  mockGateway.resolve.mockResolvedValue({ kind: follower.kind, profileId: follower.profileId });
  jest.mocked(router.canGoBack).mockReturnValue(true);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('shows follower, anonymous rating and daily-word notifications without push permission or media access', async () => {
  render(<InboxContent identity={identity} />);
  await screen.findByText('@learner started following you');
  expect(screen.getByText('Someone rated your photo for “Le chien”')).toBeVisible();
  expect(screen.getByText('Today’s words are ready')).toBeVisible();
  expect(screen.queryByText('Mark all read')).toBeNull();
  expect(screen.queryByLabelText(/^Mark as/)).toBeNull();
  expect(mockGateway.page).toHaveBeenCalledWith(null, expect.any(AbortSignal));
});

it.each([
  [
    follower,
    { kind: 'NEW_FOLLOWER', profileId: id(11) },
    { pathname: '/public-profile', params: { profileId: id(11) } },
  ],
  [
    rating,
    { kind: 'NEW_RATING', submissionId: id(14) },
    { pathname: '/post', params: { submissionId: id(14) } },
  ],
  [daily, { kind: 'DAILY_WORDS_READY', challengeId: id(13) }, '/'],
])(
  'resolves live eligibility without a per-row read write before opening fixed destination for $kind',
  async (item, target, destination) => {
    mockGateway.page.mockResolvedValue({ ...page, items: [item] });
    mockGateway.resolve.mockResolvedValue(target);
    render(<InboxContent identity={identity} />);
    const button = await screen.findByLabelText(/^Unread:/);
    fireEvent.press(button);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(destination));
    expect(mockGateway.resolve).toHaveBeenCalledWith(item.id, expect.any(AbortSignal));
    expect(mockGateway.read).not.toHaveBeenCalled();
    expect(feedback.confirm).not.toHaveBeenCalled();
    expect(feedback.selection).not.toHaveBeenCalled();
    expect(feedback.success).not.toHaveBeenCalled();
  },
);

it('clears the badge and cached row state only from the server opening receipt without refetching history', async () => {
  const entries = inboxEntries(serverScope(identity.userId, identity.token));
  entries.list.set({ ...page, olderWindow: false });
  entries.summary.set({ unreadCount: 3, readCursor: page.readCursor });
  const pending = deferred<InboxOpenReceipt>();
  mockGateway.openInbox.mockReturnValueOnce(pending.promise);
  render(
    <>
      <NotificationBell />
      <InboxContent identity={identity} />
    </>,
  );
  await waitFor(() => expect(mockGateway.openInbox).toHaveBeenCalledTimes(1));
  expect(screen.getByLabelText('Notifications, 3 unread')).toBeVisible();
  expect(screen.getByText('@learner started following you')).toBeVisible();
  await act(async () =>
    pending.resolve({
      openedAt: time,
      unreadCount: 0,
      readCursor: page.readCursor,
      readStates: page.items.map((item) => ({ id: item.id, read: true })),
    }),
  );
  expect(screen.getByLabelText('Notifications')).toBeVisible();
  expect(screen.queryByLabelText(/^Unread:/)).toBeNull();
  expect(mockGateway.page).not.toHaveBeenCalled();
});

it('preserves a post-cutoff unread count and does not open again on refresh or foreground', async () => {
  mockGateway.openInbox.mockResolvedValue({
    openedAt: time,
    unreadCount: 1,
    readCursor: page.readCursor,
    readStates: [],
  });
  mockGateway.page.mockResolvedValue({
    ...page,
    items: [{ ...follower, read: true }, rating],
    unreadCount: 1,
  });
  render(
    <>
      <NotificationBell />
      <InboxContent identity={identity} />
    </>,
  );
  await screen.findByLabelText('Notifications, 1 unread');
  await screen.findByText('@learner started following you');
  fireEvent(screen.UNSAFE_getByType(FlatList), 'refresh');
  await act(async () => {});
  await act(async () => change('background'));
  await act(async () => change('active'));
  expect(mockGateway.openInbox).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Notifications, 1 unread')).toBeVisible();
  expect(screen.queryByText('Mark all read')).toBeNull();
  expect(screen.queryByLabelText(/^Mark as/)).toBeNull();
});

it('deduplicates target taps while live authorization is pending', async () => {
  const pending = deferred<{ kind: 'NEW_FOLLOWER'; profileId: string }>();
  mockGateway.resolve.mockReturnValue(pending.promise);
  render(<InboxContent identity={identity} />);
  const button = await screen.findByLabelText('Unread: @learner started following you');
  fireEvent.press(button);
  fireEvent.press(button);
  expect(mockGateway.resolve).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve({ kind: 'NEW_FOLLOWER', profileId: follower.profileId }));
  expect(router.push).toHaveBeenCalledTimes(1);
});

it('does not navigate or retain eligibility after blocked/moderated notification denial', async () => {
  mockGateway.resolve.mockRejectedValue(
    new SafetyUnavailable('This notification is no longer available.'),
  );
  render(<InboxContent identity={identity} />);
  fireEvent.press(await screen.findByLabelText('Unread: @learner started following you'));
  await screen.findByText('This notification is no longer available.');
  expect(router.push).not.toHaveBeenCalled();
  expect(mockGateway.read).not.toHaveBeenCalled();
  expect(screen.queryByText('@learner started following you')).toBeNull();
  mockGateway.page.mockResolvedValue({ ...page, items: [], unreadCount: 0, readCursor: null });
  fireEvent.press(screen.getByText('Refresh notifications'));
  await screen.findByText('All caught up');
  expect(screen.queryByText('This notification is no longer available.')).toBeNull();
});

it('keeps pages cached across navigation and elapsed time, and explicit refresh returns to latest', async () => {
  jest.useFakeTimers();
  mockGateway.page
    .mockResolvedValueOnce({ ...page, items: [follower], hasMore: true })
    .mockResolvedValueOnce({ ...page, items: [rating, follower, daily], hasMore: false });
  const first = render(<InboxContent identity={identity} />);
  await act(async () => {});
  fireEvent.press(screen.getByText('Earlier notifications'));
  await act(async () => {});
  expect(mockGateway.page).toHaveBeenLastCalledWith(
    { time, id: follower.id },
    expect.any(AbortSignal),
  );
  expect(screen.getAllByText('@learner started following you')).toHaveLength(1);
  first.unmount();
  await act(async () => jest.advanceTimersByTime(40 * 60000));
  render(<InboxContent identity={identity} />);
  await act(async () => {});
  expect(screen.getByText('Someone rated your photo for “Le chien”')).toBeVisible();
  expect(mockGateway.page).toHaveBeenCalledTimes(2);
  fireEvent(screen.UNSAFE_getByType(FlatList), 'refresh');
  await act(async () => {});
  expect(mockGateway.page).toHaveBeenCalledTimes(3);
  expect(mockGateway.page).toHaveBeenLastCalledWith(null, expect.any(AbortSignal));
});

it('bounds a long paginated inbox to 60 rows and preserves its next cursor', async () => {
  let offset = 0;
  mockGateway.page.mockImplementation(async () => {
    const items = Array.from({ length: 20 }, () => ({ ...daily, id: id(++offset) }));
    return { ...page, items, hasMore: true };
  });
  const { result } = renderHook(() => useInbox(identity, mockGateway));
  await act(async () => {});
  for (let i = 0; i < 4; i++) await act(async () => result.current.more());
  expect(result.current.data?.items).toHaveLength(60);
  expect(result.current.data?.items[0].id).toBe(id(41));
  expect(result.current.data?.olderWindow).toBe(true);
  expect(mockGateway.page.mock.calls[4][0]).toEqual({ time, id: id(80) });
});

it('does not resurrect a discarded page after a concurrent safety invalidation', async () => {
  const pending = deferred<InboxPage>();
  mockGateway.page
    .mockResolvedValueOnce({ ...page, hasMore: true })
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValue({ ...page, items: [], unreadCount: 0, hasMore: false });
  const { result } = renderHook(() => useInbox(identity, mockGateway));
  await act(async () => {});
  act(() => result.current.more());
  await act(async () => invalidateServerData(['inbox'], { discard: true }));
  await act(async () => pending.resolve(page));
  expect(result.current.data?.items).toEqual([]);
});

it('discards late target resolution on account switch and clears session-scoped inbox data', async () => {
  const pending = deferred<{ kind: 'NEW_FOLLOWER'; profileId: string }>();
  mockGateway.resolve.mockReturnValue(pending.promise);
  const view = render(<InboxScreen />);
  fireEvent.press(await screen.findByLabelText('Unread: @learner started following you'));
  const signal: AbortSignal = mockGateway.resolve.mock.calls[0][1];
  mockSession = makeSession(id(99));
  mockGateway.page.mockResolvedValue({ ...page, items: [], unreadCount: 0, readCursor: null });
  act(() => setServerScope(serverScope(mockSession.user.id, mockSession.access_token)));
  view.rerender(<InboxScreen />);
  await act(async () => pending.resolve({ kind: 'NEW_FOLLOWER', profileId: id(11) }));
  expect(signal.aborted).toBe(true);
  expect(router.push).not.toHaveBeenCalled();
  expect(mockGateway.read).not.toHaveBeenCalled();
  await screen.findByText('All caught up');
});

it('aborts navigation work on background without automatically replaying on resume', async () => {
  const pending = deferred<{ kind: 'NEW_FOLLOWER'; profileId: string }>();
  mockGateway.resolve.mockReturnValue(pending.promise);
  render(<InboxContent identity={identity} />);
  fireEvent.press(await screen.findByLabelText('Unread: @learner started following you'));
  await act(async () => change('background'));
  await act(async () => pending.resolve({ kind: 'NEW_FOLLOWER', profileId: id(11) }));
  await act(async () => change('active'));
  expect(router.push).not.toHaveBeenCalled();
  expect(mockGateway.resolve).toHaveBeenCalledTimes(1);
  expect(mockGateway.page).toHaveBeenCalledTimes(1);
});

it('shares one summary request between bell instances and does not refetch on remount', async () => {
  const pending = deferred<{ unreadCount: number; readCursor: typeof page.readCursor }>();
  mockGateway.summary.mockReturnValue(pending.promise);
  const view = render(
    <>
      <NotificationBell />
      <NotificationBell />
    </>,
  );
  await act(async () => {});
  expect(mockGateway.summary).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve({ unreadCount: 123, readCursor: page.readCursor }));
  expect(screen.getAllByText('99+')).toHaveLength(2);
  view.unmount();
  render(<NotificationBell />);
  await screen.findByLabelText('Notifications, 123 unread');
  expect(mockGateway.summary).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByLabelText('Notifications, 123 unread'));
  expect(router.push).toHaveBeenCalledWith('/notifications');
});

it('hides the global bell before account admission and gives direct inbox entry a safe back fallback', async () => {
  mockStatus = 'onboarding';
  const view = render(<NotificationBell />);
  expect(screen.queryByLabelText('Notifications')).toBeNull();
  view.unmount();
  jest.mocked(router.canGoBack).mockReturnValue(false);
  render(<InboxContent identity={identity} />);
  fireEvent.press(screen.getByLabelText('Back'));
  expect(router.replace).toHaveBeenCalledWith('/');
  await act(async () => {});
});

it('provides loading, empty and retry states without automatic error retries', async () => {
  const pending = deferred<InboxPage>();
  mockGateway.page.mockReturnValueOnce(pending.promise);
  const view = render(<InboxContent identity={identity} />);
  await screen.findByLabelText('Loading notifications');
  await act(async () => pending.resolve({ ...page, items: [], unreadCount: 0, readCursor: null }));
  expect(screen.getByText('All caught up')).toBeVisible();
  view.unmount();
  inboxEntries(serverScope(identity.userId, identity.token)).list.clear();
  mockGateway.page.mockRejectedValueOnce(new Error('network'));
  render(<InboxContent identity={identity} />);
  fireEvent.press(await screen.findByText('Refresh notifications'));
  await screen.findByText('@learner started following you');
  expect(mockGateway.page).toHaveBeenCalledTimes(3);
});

it('rejects malformed counts, targets and duplicate pages and drops unneeded private fields', () => {
  expect(() => parseInboxSummary({ unread_count: -1, read_cursor: null })).toThrow();
  expect(() => parseInboxTarget({ kind: 'EXTERNAL', route: 'https://attacker.invalid' })).toThrow();
  expect(() => parseInboxTarget({ kind: 'NEW_FOLLOWER', profile_id: '../private' })).toThrow();
  const row = {
    id: id(1),
    kind: 'NEW_RATING',
    created_at: time,
    read_at: null,
    assignment_id: id(12),
    submission_id: id(14),
    target_term: 'le chien',
    username: 'secret_rater',
    token: 'not retained',
    route: '/moderation',
  };
  const parsed = parseInboxNotification(row);
  expect(parsed).toEqual({ ...rating, id: id(1) });
  expect(inboxDestination(parseInboxTarget({ ...row, kind: 'NEW_RATING' }))).toEqual({
    pathname: '/post',
    params: { submissionId: id(14) },
  });
  expect(() =>
    parseInboxPage({ unread_count: 1, read_cursor: null, has_more: false, items: [row, row] }),
  ).toThrow();
});

it('retries an uncertain inbox opening with the same durable ID instead of clearing newer events', async () => {
  mockGateway.openInbox.mockRejectedValueOnce(new Error('Lost response after commit'));
  render(<InboxContent identity={identity} />);
  fireEvent.press(await screen.findByText('Refresh notifications'));
  await screen.findByText('@learner started following you');
  expect(mockGateway.openInbox).toHaveBeenCalledTimes(2);
  expect(mockGateway.openInbox.mock.calls[0][0]).toBe(mockGateway.openInbox.mock.calls[1][0]);
  expect(mockGateway.readAll).not.toHaveBeenCalled();
});

it('drops an old-account opening receipt and retries only within the matching account', async () => {
  const pending = deferred<InboxOpenReceipt>();
  mockGateway.openInbox.mockReturnValueOnce(pending.promise);
  const view = render(<InboxScreen />);
  await waitFor(() => expect(mockGateway.openInbox).toHaveBeenCalledTimes(1));
  const signal: AbortSignal = mockGateway.openInbox.mock.calls[0][2];
  const original = inboxEntries(serverScope(identity.userId, identity.token));
  mockSession = makeSession(id(99));
  mockGateway.page.mockResolvedValue({ ...page, items: [], unreadCount: 0, readCursor: null });
  act(() => setServerScope(serverScope(mockSession.user.id, mockSession.access_token)));
  view.rerender(<InboxScreen />);
  await act(async () =>
    pending.resolve({
      openedAt: time,
      unreadCount: 99,
      readCursor: page.readCursor,
      readStates: [],
    }),
  );
  await screen.findByText('All caught up');
  expect(signal.aborted).toBe(true);
  expect(original.summary.getSnapshot().data).toBeNull();
  expect(
    inboxEntries(serverScope(mockSession.user.id, mockSession.access_token)).summary.getSnapshot()
      .data?.unreadCount,
  ).toBe(0);
});

it('bounds stalled target resolution without navigating or replaying it', async () => {
  jest.useFakeTimers();
  mockGateway.resolve.mockReturnValue(new Promise(() => {}));
  const { result } = renderHook(() => useInbox(identity, mockGateway));
  await act(async () => {});
  act(() => result.current.open(follower, jest.fn()));
  expect(result.current.busy).toBe(true);
  await act(async () => jest.advanceTimersByTime(20001));
  expect(result.current.busy).toBe(false);
  expect(mockGateway.resolve).toHaveBeenCalledTimes(1);
  expect(result.current.taskError).toMatch(/couldn’t confirm/);
});

it('returns an older inbox window to the top only after an explicit successful latest refresh', async () => {
  const scroll = jest.spyOn(FlatList.prototype, 'scrollToOffset').mockImplementation(() => {});
  const entry = inboxEntries(serverScope(identity.userId, identity.token)).list;
  entry.set({ ...page, olderWindow: true });
  const pending = deferred<InboxPage>();
  mockGateway.page.mockReturnValueOnce(pending.promise);
  const first = render(<InboxContent identity={identity} />);
  expect(scroll).not.toHaveBeenCalled();
  expect(mockGateway.page).not.toHaveBeenCalled();
  await act(async () => {});
  fireEvent.press(screen.getByText('Back to latest notifications'));
  expect(scroll).not.toHaveBeenCalled();
  await act(async () => pending.resolve(page));
  expect(scroll).toHaveBeenCalledTimes(1);
  expect(scroll).toHaveBeenCalledWith({ offset: 0, animated: false });
  expect(screen.queryByText('Back to latest notifications')).toBeNull();
  first.unmount();
  render(<InboxContent identity={identity} />);
  await act(async () => {});
  expect(scroll).toHaveBeenCalledTimes(1);
  expect(mockGateway.page).toHaveBeenCalledTimes(1);
});

it('keeps the current inbox position and older page when latest refresh fails', async () => {
  const scroll = jest.spyOn(FlatList.prototype, 'scrollToOffset').mockImplementation(() => {});
  inboxEntries(serverScope(identity.userId, identity.token)).list.set({
    ...page,
    olderWindow: true,
  });
  mockGateway.page.mockRejectedValueOnce(new Error('Offline'));
  render(<InboxContent identity={identity} />);
  await act(async () => {});
  fireEvent.press(screen.getByText('Back to latest notifications'));
  await screen.findByText('We couldn’t load your notifications. Pull down to try again.');
  expect(screen.getByText('Back to latest notifications')).toBeVisible();
  expect(scroll).not.toHaveBeenCalled();
});

it('does not manufacture a new opening on token refresh within the same Auth session', async () => {
  const token = (suffix: string) =>
    `fixture.${btoa(JSON.stringify({ session_id: id(70) }))}.${suffix}`;
  mockSession = { ...makeSession(), access_token: token('first') };
  const view = render(<InboxScreen />);
  await screen.findByText('@learner started following you');
  mockSession = { ...mockSession, access_token: token('refreshed') };
  view.rerender(<InboxScreen />);
  await act(async () => {});
  expect(mockGateway.openInbox).toHaveBeenCalledTimes(1);
  expect(mockGateway.page).toHaveBeenCalledTimes(1);
});
it('retires an in-flight old badge response when inbox opening reconciles the count', async () => {
  const old = deferred<{ unreadCount: number; readCursor: typeof page.readCursor }>();
  mockGateway.summary.mockReturnValueOnce(old.promise);
  mockGateway.page.mockResolvedValue({ ...page, unreadCount: 0 });
  const bell = render(<NotificationBell />);
  await waitFor(() => expect(mockGateway.summary).toHaveBeenCalledTimes(1));
  const signal: AbortSignal = mockGateway.summary.mock.calls[0][0];
  render(<InboxContent identity={identity} />);
  await screen.findByText('@learner started following you');
  await act(async () => old.resolve({ unreadCount: 99, readCursor: page.readCursor }));
  expect(signal.aborted).toBe(true);
  expect(
    inboxEntries(serverScope(identity.userId, identity.token)).summary.getSnapshot().data
      ?.unreadCount,
  ).toBe(0);
  bell.unmount();
});
it('keeps a paging cursor when opening revalidation removes a previously cached window', async () => {
  inboxEntries(serverScope(identity.userId, identity.token)).list.set({
    ...page,
    hasMore: true,
    olderWindow: true,
    cursor: { time, id: daily.id },
  });
  mockGateway.openInbox.mockResolvedValue({
    openedAt: time,
    unreadCount: 0,
    readCursor: null,
    readStates: [],
  });
  render(<InboxContent identity={identity} />);
  await act(async () => {});
  expect(screen.queryByText('@learner started following you')).toBeNull();
  expect(mockGateway.page).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Earlier notifications'));
  await waitFor(() =>
    expect(mockGateway.page).toHaveBeenCalledWith({ time, id: daily.id }, expect.any(AbortSignal)),
  );
});

it('admits a new explicit inbox visit with a new key while preserving cached history', async () => {
  const first = render(<InboxContent identity={identity} />);
  await screen.findByText('@learner started following you');
  const firstKey: unknown = mockGateway.openInbox.mock.calls[0][0];
  expect(firstKey).toEqual(expect.any(String));
  first.unmount();
  render(<InboxContent identity={identity} />);
  await act(async () => {});
  expect(mockGateway.openInbox).toHaveBeenCalledTimes(2);
  expect(mockGateway.openInbox.mock.calls[1][0]).not.toBe(firstKey);
  expect(mockGateway.page).toHaveBeenCalledTimes(1);
});
