import type * as ReactTypes from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { CardActions } from '@/features/safety/card-actions';
import { BlockedUsersScreen } from '@/features/safety/blocked-users-screen';
import { ModerationScreen } from '@/features/safety/moderation-screen';
import { useSafetyTask } from '@/features/safety/use-safety-task';
import { SafetyUnavailable, type ModerationCase } from '@/features/safety/model';
import type { FeedItem } from '@/services/discover';
import { makeAccount, makeSession } from './fixtures';
import { createServerCache } from '@/lib/server-cache';
let mockSession = makeSession(),
  mockStatus = 'ready';
const mockAccount = makeAccount();
const mockGateway = {
  access: jest.fn(),
  block: jest.fn(),
  unblock: jest.fn(),
  blocks: jest.fn(),
  report: jest.fn(),
  queue: jest.fn(),
  detail: jest.fn(),
  history: jest.fn(),
  photo: jest.fn(),
  moderate: jest.fn(),
};
jest.mock('@/services/safety', () => ({ safetyGateway: () => mockGateway }));
jest.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({ session: mockSession, status: mockStatus, account: mockAccount }),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => '79000000-0000-4000-8000-000000000099' }));
jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn() },
  useFocusEffect: (callback: () => () => void) => {
    const React = jest.requireActual<typeof ReactTypes>('react');
    React.useEffect(callback, [callback]);
  },
}));
const id = '79000000-0000-4000-8000-000000000001';
const identity = { userId: 'viewer', token: 'token' };
const item: FeedItem = {
  id,
  targetTerm: 'le chien',
  referenceTerm: 'dog',
  username: 'learner',
  cefrLevel: 'A1',
  submittedAt: '2026-09-14T12:00:00Z',
  averageRating: null,
  ratingCount: 0,
  viewerRating: null,
  canRate: true,
};
const caseValue: ModerationCase = {
  report: {
    id,
    kind: 'submission',
    username: 'learner',
    word: 'le chien',
    reason: 'privacy',
    details: 'Review this context',
    status: 'open',
    createdAt: item.submittedAt,
  },
  submissionExists: true,
  userExists: true,
  removed: false,
  restricted: false,
};
beforeEach(() => {
  jest.clearAllMocks();
  for (const fn of Object.values(mockGateway)) fn.mockReset();
  mockSession = makeSession();
  mockStatus = 'ready';
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    writable: true,
    value: 'active',
  });
  mockGateway.access.mockResolvedValue({ moderator: true, restricted: false });
  mockGateway.blocks.mockResolvedValue({ items: [{ id, username: 'learner' }], hasMore: false });
  mockGateway.queue.mockResolvedValue({ items: [caseValue.report], hasMore: false });
  mockGateway.detail.mockResolvedValue(caseValue);
  mockGateway.history.mockResolvedValue({ items: [], hasMore: false });
  mockGateway.photo.mockResolvedValue('https://api.test/reported');
  mockGateway.block.mockResolvedValue(undefined);
  mockGateway.unblock.mockResolvedValue(undefined);
  mockGateway.report.mockResolvedValue(undefined);
  mockGateway.moderate.mockResolvedValue(undefined);
});
afterEach(() => jest.useRealTimers());

it('shows a comment case and audited removal without requesting private photo inspection', async () => {
  const report = { ...caseValue.report, kind: 'comment' as const, comment: 'Reported text' };
  mockGateway.queue.mockResolvedValue({ items: [report], hasMore: false });
  mockGateway.detail.mockResolvedValue({
    ...caseValue,
    report,
    commentExists: true,
    commentRemoved: false,
  });
  render(<ModerationScreen />);
  fireEvent.press(
    await screen.findByLabelText(`Review comment report: @learner · le chien · Privacy concern`),
  );
  await screen.findByText('Reported text');
  expect(mockGateway.photo).not.toHaveBeenCalled();
  expect(screen.queryByText('Remove photo from public view')).toBeNull();
  fireEvent.press(screen.getByText('Remove comment'));
  fireEvent.press(screen.getByText('Confirm moderation action'));
  await waitFor(() =>
    expect(mockGateway.moderate).toHaveBeenCalledWith(
      id,
      'remove_comment',
      expect.any(String),
      '',
      expect.any(AbortSignal),
    ),
  );
});

it.each(['Report photo', 'Report user'])(
  'requires category and confirmation for %s without exposing outcome',
  async (label) => {
    render(<CardActions identity={identity} item={item} close={jest.fn()} blocked={jest.fn()} />);
    fireEvent.press(screen.getByText(label));
    fireEvent.press(screen.getByLabelText('Privacy concern'));
    fireEvent.changeText(screen.getByLabelText('Additional details (optional)'), 'Some context');
    expect(mockGateway.report).not.toHaveBeenCalled();
    fireEvent.press(screen.getByText('Review report'));
    expect(screen.getByText(/Only moderators can see your report/)).toBeVisible();
    fireEvent.press(screen.getByText('Confirm report'));
    expect(
      await screen.findByText('Thanks for letting us know. A moderator can review your report.'),
    ).toBeVisible();
    expect(mockGateway.report).toHaveBeenCalledWith(
      id,
      label === 'Report photo' ? 'submission' : 'user',
      'privacy',
      'Some context',
      expect.any(AbortSignal),
    );
  },
);
it('makes blocking explicit and suppresses duplicate taps while pending', async () => {
  let finish: () => void = () => {};
  mockGateway.block.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const blocked = jest.fn();
  render(<CardActions identity={identity} item={item} close={jest.fn()} blocked={blocked} />);
  fireEvent.press(screen.getByText('Block user'));
  expect(screen.getByText('Block @learner?')).toBeVisible();
  expect(screen.getByText(/each other’s public activity/)).toBeVisible();
  expect(mockGateway.block).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Confirm block'));
  expect(screen.getByLabelText('Confirm block')).toBeDisabled();
  fireEvent.press(screen.getByText('Confirm block'));
  expect(mockGateway.block).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(blocked).toHaveBeenCalledTimes(1);
});
it('closes a backgrounded safety dialog and discards its late block result', async () => {
  const listeners = jest.spyOn(AppState, 'addEventListener');
  let finish: () => void = () => {};
  mockGateway.block.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const close = jest.fn(),
    blocked = jest.fn();
  render(<CardActions identity={identity} item={item} close={close} blocked={blocked} />);
  fireEvent.press(screen.getByText('Block user'));
  fireEvent.press(screen.getByText('Confirm block'));
  const signal: AbortSignal = mockGateway.block.mock.calls[0][1];
  act(() => listeners.mock.calls.at(-1)?.[1]('background'));
  expect(signal.aborted).toBe(true);
  expect(close).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(blocked).not.toHaveBeenCalled();
});
it('unblocks only after confirmation, then reloads authoritative rows', async () => {
  render(<BlockedUsersScreen />);
  fireEvent.press(await screen.findByText('Unblock @learner'));
  expect(mockGateway.unblock).not.toHaveBeenCalled();
  mockGateway.blocks.mockResolvedValue({ items: [], hasMore: false });
  fireEvent.press(screen.getByText('Confirm unblock'));
  expect(await screen.findByText('No blocked people here.')).toBeVisible();
  expect(mockGateway.unblock).toHaveBeenCalledWith(id, expect.any(AbortSignal));
});
it('invalidates public relationship caches after unblock even if the list reload fails', async () => {
  const entry = createServerCache<string>().entry('public-profile', ['public-profile']);
  entry.set('old relationship counts');
  render(<BlockedUsersScreen />);
  fireEvent.press(await screen.findByText('Unblock @learner'));
  mockGateway.blocks.mockRejectedValueOnce(new Error('offline after commit'));
  fireEvent.press(screen.getByText('Confirm unblock'));
  await screen.findByText(/couldn’t confirm the change/);
  expect(entry.getSnapshot().data).toBeNull();
});
it('replaces blocked pages instead of accumulating an unbounded list', async () => {
  mockGateway.blocks
    .mockResolvedValueOnce({ items: [{ id, username: 'learner' }], hasMore: true })
    .mockResolvedValue({ items: [{ id: 'next', username: 'other' }], hasMore: false });
  render(<BlockedUsersScreen />);
  fireEvent.press(await screen.findByText('Next page'));
  expect(await screen.findByText('Unblock @other')).toBeVisible();
  expect(screen.queryByText('Unblock @learner')).toBeNull();
  expect(mockGateway.blocks).toHaveBeenLastCalledWith(id, expect.any(AbortSignal));
});
async function openCase() {
  render(<ModerationScreen />);
  fireEvent.press(await screen.findByLabelText(/Review photo report:/));
  await screen.findByLabelText('Reported photo');
}
it('discards public content after confirmed moderation even if case reconciliation fails', async () => {
  const entry = createServerCache<string>().entry('comments', ['comments']);
  entry.set('previously visible comment');
  await openCase();
  fireEvent.press(screen.getByText('Remove photo from public view'));
  mockGateway.detail.mockRejectedValueOnce(new Error('offline after commit'));
  fireEvent.press(screen.getByText('Confirm moderation action'));
  await screen.findByText(/couldn’t confirm the change/);
  expect(entry.getSnapshot().data).toBeNull();
});
it('does not let a late moderation acknowledgement clear a subsequent account cache', async () => {
  let finish: () => void = () => {};
  mockGateway.moderate.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const view = render(<ModerationScreen />);
  fireEvent.press(await screen.findByLabelText(/Review photo report:/));
  await screen.findByLabelText('Reported photo');
  fireEvent.press(screen.getByText('Remove photo from public view'));
  fireEvent.press(screen.getByText('Confirm moderation action'));
  await waitFor(() => expect(mockGateway.moderate).toHaveBeenCalledTimes(1));
  const signal: AbortSignal = mockGateway.moderate.mock.calls[0][4];
  mockSession = makeSession('other');
  mockGateway.access.mockResolvedValue({ moderator: false, restricted: false });
  view.rerender(<ModerationScreen />);
  await screen.findByText('You don’t have access to moderation.');
  const entry = createServerCache<string>().entry('new-account', ['comments']);
  entry.set('new account content');
  await act(async () => finish());
  expect(signal.aborted).toBe(true);
  expect(entry.getSnapshot().data).toBe('new account content');
  expect(mockGateway.detail).toHaveBeenCalledTimes(1);
});
it('requires explicit moderator action confirmation and retries the same request identity', async () => {
  await openCase();
  fireEvent.changeText(screen.getByLabelText('Moderation reason (optional)'), 'Confirmed context');
  fireEvent.press(screen.getByText('Remove photo from public view'));
  expect(mockGateway.moderate).not.toHaveBeenCalled();
  mockGateway.moderate.mockRejectedValueOnce(new Error('lost response'));
  fireEvent.press(screen.getByText('Confirm moderation action'));
  await screen.findByText(/couldn’t confirm the change/);
  fireEvent.press(screen.getByText('Confirm moderation action'));
  await waitFor(() => expect(mockGateway.moderate).toHaveBeenCalledTimes(2));
  expect(mockGateway.moderate.mock.calls[0].slice(0, 4)).toEqual([
    id,
    'remove_submission',
    '79000000-0000-4000-8000-000000000099',
    'Confirmed context',
  ]);
  expect(mockGateway.moderate.mock.calls[1].slice(0, 4)).toEqual(
    mockGateway.moderate.mock.calls[0].slice(0, 4),
  );
  await waitFor(() => expect(screen.queryByText('Confirm moderation action')).toBeNull());
});
it('expires moderator photo capabilities independently of stalled permission renewal', async () => {
  jest.useFakeTimers();
  await openCase();
  mockGateway.access.mockReturnValue(new Promise(() => {}));
  await act(async () => {
    jest.advanceTimersByTime(55000);
  });
  expect(screen.queryByLabelText('Reported photo')).toBeNull();
});
it('keeps a renewed moderator preview when an old image error arrives late', async () => {
  await openCase();
  const obsoleteError = screen.getByLabelText('Reported photo').props.onError;
  mockGateway.photo.mockResolvedValue('https://api.test/renewed');
  fireEvent.press(screen.getByText('Reload case and photo'));
  await waitFor(() =>
    expect(screen.getByLabelText('Reported photo').props.source.uri).toBe(
      'https://api.test/renewed',
    ),
  );
  act(() => obsoleteError());
  expect(screen.getByLabelText('Reported photo').props.source.uri).toBe('https://api.test/renewed');
});
it('removes moderator context and controls on revoked access', async () => {
  await openCase();
  mockGateway.detail.mockRejectedValueOnce(new SafetyUnavailable('Moderator access revoked.'));
  fireEvent.press(screen.getByText('Reload case and photo'));
  expect(await screen.findByText('Moderator access revoked.')).toBeVisible();
  expect(screen.queryByLabelText('Reported photo')).toBeNull();
  expect(screen.queryByText('Review this context')).toBeNull();
  expect(screen.queryByText('Remove photo from public view')).toBeNull();
});
it('does not reuse another report status page or cursor after a failed filter change', async () => {
  mockGateway.queue.mockResolvedValueOnce({ items: [caseValue.report], hasMore: true });
  render(<ModerationScreen />);
  await screen.findByText('Next reports');
  mockGateway.queue.mockRejectedValueOnce(new Error('offline'));
  fireEvent.press(screen.getByLabelText('Dismissed'));
  await screen.findByText(/couldn’t confirm the change/);
  expect(screen.queryByLabelText(/Review photo report:/)).toBeNull();
  expect(screen.queryByText('Next reports')).toBeNull();
  mockGateway.queue.mockResolvedValue({ items: [], hasMore: false });
  fireEvent.press(screen.getByLabelText('Refresh moderation'));
  await screen.findByText('No reports on this page.');
  expect(mockGateway.queue).toHaveBeenLastCalledWith('dismissed', null, expect.any(AbortSignal));
});
it('cannot install an old moderator case after switching to an ordinary account', async () => {
  let finish: (value: ModerationCase) => void = () => {};
  mockGateway.detail.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { rerender } = render(<ModerationScreen />);
  fireEvent.press(await screen.findByLabelText(/Review photo report:/));
  await waitFor(() => expect(mockGateway.detail).toHaveBeenCalledTimes(1));
  const signal: AbortSignal = mockGateway.detail.mock.calls[0][1];
  mockSession = makeSession('other');
  mockGateway.access.mockResolvedValue({ moderator: false, restricted: false });
  rerender(<ModerationScreen />);
  await screen.findByText('You don’t have access to moderation.');
  await act(async () => finish(caseValue));
  expect(signal.aborted).toBe(true);
  expect(screen.queryByText('Review this context')).toBeNull();
  expect(screen.queryByLabelText('Reported photo')).toBeNull();
});
it('times out uncertain writes without automatic replay and rejects obsolete callbacks', async () => {
  jest.useFakeTimers();
  const work = jest.fn(() => new Promise<void>(() => {})),
    accept = jest.fn();
  const { result, unmount } = renderHook(() => useSafetyTask(jest.fn()));
  act(() => {
    void result.current.run(work, accept);
    void result.current.run(work, accept);
  });
  expect(work).toHaveBeenCalledTimes(1);
  await act(async () => {
    jest.advanceTimersByTime(20000);
  });
  expect(result.current.busy).toBe(false);
  expect(result.current.error).toBeTruthy();
  expect(accept).not.toHaveBeenCalled();
  expect(work).toHaveBeenCalledTimes(1);
  const old = result.current.run;
  unmount();
  await old(work, accept);
  expect(work).toHaveBeenCalledTimes(1);
});
it('never starts safety work from a background-mounted screen', async () => {
  AppState.currentState = 'background';
  render(<BlockedUsersScreen />);
  await act(async () => {});
  expect(mockGateway.blocks).not.toHaveBeenCalled();
});
it('ignores retained foreground callbacks after the safety screen unmounts', async () => {
  const listeners = jest.spyOn(AppState, 'addEventListener');
  const { unmount } = render(<BlockedUsersScreen />);
  await screen.findByText('Unblock @learner');
  const obsolete = listeners.mock.calls.at(-1)?.[1];
  unmount();
  const calls = mockGateway.blocks.mock.calls.length;
  await act(async () => obsolete?.('active'));
  expect(mockGateway.blocks).toHaveBeenCalledTimes(calls);
});
