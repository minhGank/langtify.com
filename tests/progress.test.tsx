import { palette } from '@/lib/theme';
import { AppState, View } from 'react-native';
import type * as ReactTypes from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ProgressPanel } from '@/features/progress/progress-panel';
import { SubmissionXpFeedback } from '@/features/progress/submission-xp-feedback';
import { parseProgress, progressGateway, receiptGateway } from '@/services/progress';
import { invalidateServerData } from '@/lib/server-cache';

const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({ requireSupabase: () => ({ rpc: mockRpc }) }));
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => () => void) => {
    const React = jest.requireActual<typeof ReactTypes>('react');
    React.useEffect(callback, [callback]);
  },
}));
const payload = {
  user_id: 'owner',
  challenge_id: 'challenge',
  completed_words: 3,
  total_xp: 620,
  level: 3,
  next_level_xp: 700,
  xp_into_level: 170,
  xp_for_next_level: 250,
  current_streak: 7,
  longest_streak: 18,
  total_words_completed: 40,
  total_challenges_completed: 10,
};
const header = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    writable: true,
    value: 'active',
  });
  mockRpc.mockReturnValue({ setHeader: header });
  header.mockResolvedValue({ data: payload, error: null });
});
it('rejects obsolete foreground callbacks after a token change and defers background startup', async () => {
  AppState.currentState = 'background';
  const listeners = jest.mocked(AppState.addEventListener);
  const { rerender } = render(<ProgressPanel userId="owner" accessToken="old" />);
  const obsolete = listeners.mock.calls.at(-1)?.[1];
  await act(async () => {});
  expect(mockRpc).not.toHaveBeenCalled();
  AppState.currentState = 'active';
  rerender(<ProgressPanel userId="owner" accessToken="new" />);
  await screen.findByText('620 XP');
  const calls = mockRpc.mock.calls.length;
  await act(async () => obsolete?.('active'));
  expect(mockRpc).toHaveBeenCalledTimes(calls);
  expect(header).toHaveBeenLastCalledWith('Authorization', 'Bearer new');
});
it('renders server daily completion and full bonus with formula-correct level', async () => {
  render(<ProgressPanel userId="owner" accessToken="token" challengeId="challenge" />);
  expect(await screen.findByText('3 / 3 completed')).toBeVisible();
  expect(screen.getByText('Daily Challenge Complete')).toBeVisible();
  expect(screen.getByText('+10 XP bonus')).toBeVisible();
  expect(screen.getByText('+10 XP bonus')).toHaveStyle({ color: palette.light.textOnAccent });
  expect(screen.getByText('Daily Challenge Complete')).toHaveStyle({
    color: palette.light.success,
  });
  expect(screen.getByText('Level 3')).toBeVisible();
  expect(screen.getByText('7 day streak')).toBeVisible();
  expect(mockRpc).toHaveBeenCalledWith('get_my_progress', { challenge_id: 'challenge' });
  expect(header).toHaveBeenCalledWith('Authorization', 'Bearer token');
});
it('renders accessible within-level progress and profile totals', async () => {
  render(<ProgressPanel userId="owner" accessToken="token" detailed />);
  expect(await screen.findByText('620 / 700 XP · next level')).toBeVisible();
  expect(screen.getByRole('progressbar').props.accessibilityValue).toEqual({
    min: 0,
    max: 250,
    now: 170,
  });
  expect(screen.getByLabelText('Longest streak: 18 days')).toBeVisible();
  expect(screen.getByLabelText('Words completed: 40')).toBeVisible();
  expect(screen.getByLabelText('Full challenges: 10')).toBeVisible();
});
it('does not manufacture zero XP when the server fails and supports retry', async () => {
  header.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
  render(<ProgressPanel userId="owner" accessToken="token" />);
  expect(await screen.findByText('Progress is unavailable.')).toBeVisible();
  expect(screen.queryByText('0 XP')).toBeNull();
  fireEvent.press(screen.getByText('Retry progress'));
  expect(await screen.findByText('620 XP')).toBeVisible();
});
it('drops a late previous-account response after switching accounts', async () => {
  let finish: (value: { data: typeof payload; error: null }) => void = () => {};
  header.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { rerender } = render(
    <View>
      <ProgressPanel key="owner" userId="owner" accessToken="old" />
    </View>,
  );
  await waitFor(() => expect(header).toHaveBeenCalledWith('Authorization', 'Bearer old'));
  header.mockResolvedValue({
    data: { ...payload, user_id: 'other', total_xp: 0, level: 0, xp_into_level: 0 },
    error: null,
  });
  rerender(
    <View>
      <ProgressPanel key="other" userId="other" accessToken="new" />
    </View>,
  );
  expect(await screen.findByText('0 XP')).toBeVisible();
  await act(async () => finish({ data: payload, error: null }));
  expect(screen.queryByText('620 XP')).toBeNull();
});
it('ignores an obsolete token response', async () => {
  let finish: (value: { data: typeof payload; error: null }) => void = () => {};
  header.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { rerender } = render(<ProgressPanel userId="owner" accessToken="old" />);
  await waitFor(() => expect(header).toHaveBeenCalledWith('Authorization', 'Bearer old'));
  header.mockResolvedValue({ data: { ...payload, total_xp: 700 }, error: null });
  rerender(<ProgressPanel userId="owner" accessToken="new" />);
  await screen.findByText('700 XP');
  await act(async () => finish({ data: payload, error: null }));
  expect(screen.queryByText('620 XP')).toBeNull();
});
it('shows a server receipt including word, full challenge and milestone feedback', async () => {
  header.mockResolvedValue({
    data: {
      user_id: 'owner',
      submission_id: 'photo',
      word_xp: 10,
      challenge_bonus_xp: 10,
      milestone_xp: 25,
    },
    error: null,
  });
  render(<SubmissionXpFeedback userId="owner" accessToken="token" submissionId="photo" />);
  expect(await screen.findByText('+10 XP · word completed')).toBeVisible();
  expect(screen.getByText('+10 XP · full challenge bonus')).toBeVisible();
  expect(screen.getByText('+25 XP · streak milestone')).toBeVisible();
});

it('shows only the server historical +10 XP receipt without daily or streak completion wording', async () => {
  header.mockResolvedValue({
    data: {
      user_id: 'owner',
      submission_id: 'photo',
      word_xp: 10,
      challenge_bonus_xp: 0,
      milestone_xp: 0,
    },
    error: null,
  });
  render(
    <SubmissionXpFeedback userId="owner" accessToken="token" submissionId="photo" historical />,
  );
  expect(await screen.findByText('+10 XP')).toBeVisible();
  expect(screen.queryByText(/word completed|full challenge bonus|streak milestone/)).toBeNull();
  expect(mockRpc).toHaveBeenCalledWith('get_submission_xp', { submission_id: 'photo' });
});

it('reconciles historical feedback with authoritative reversal and restoration instead of accumulating positive awards', async () => {
  const receipt = {
    user_id: 'owner',
    submission_id: 'photo',
    word_xp: 10,
    challenge_bonus_xp: 0,
    milestone_xp: 0,
  };
  header.mockResolvedValue({ data: receipt, error: null });
  render(
    <SubmissionXpFeedback userId="owner" accessToken="token" submissionId="photo" historical />,
  );
  await screen.findByText('+10 XP');
  header.mockResolvedValue({ data: { ...receipt, word_xp: 0 }, error: null });
  act(() => invalidateServerData(['progress']));
  await waitFor(() => expect(screen.queryByText('+10 XP')).toBeNull());
  header.mockResolvedValue({ data: receipt, error: null });
  act(() => invalidateServerData(['progress']));
  expect(await screen.findByText('+10 XP')).toBeVisible();
  expect(screen.queryByText('+20 XP')).toBeNull();
});
it('rejects mismatched account, challenge, malformed or unsafe numbers', () => {
  expect(() => parseProgress(payload, 'other')).toThrow();
  expect(() => parseProgress(payload, 'owner', 'other')).toThrow();
  for (const total_xp of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '620'])
    expect(() => parseProgress({ ...payload, total_xp }, 'owner')).toThrow();
  expect(() => parseProgress({ ...payload, completed_words: 4 }, 'owner')).toThrow();
});
it('rejects a foreign photo receipt and never accepts a client XP amount', async () => {
  header.mockResolvedValue({ data: { user_id: 'owner', submission_id: 'different' }, error: null });
  await expect(
    receiptGateway({ userId: 'owner', accessToken: 'token' }, 'photo')(),
  ).rejects.toThrow('Submission changed');
  expect(mockRpc).toHaveBeenCalledWith('get_submission_xp', { submission_id: 'photo' });
  header.mockResolvedValue({ data: payload, error: null });
  await progressGateway({ userId: 'owner', accessToken: 'token' })();
  expect(mockRpc).toHaveBeenLastCalledWith('get_my_progress', { challenge_id: undefined });
});

it('ignores background responses and re-reads authoritative XP on foreground resume', async () => {
  const listeners = jest.mocked(AppState.addEventListener);
  let finish: (value: { data: typeof payload; error: null }) => void = () => {};
  header.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const app = render(<ProgressPanel userId="owner" accessToken="token" />);
  await waitFor(() => expect(header).toHaveBeenCalledWith('Authorization', 'Bearer token'));
  const change = listeners.mock.calls.find(([event]) => event === 'change')?.[1];
  expect(change).toBeDefined();
  act(() => change?.('background'));
  await act(async () => finish({ data: payload, error: null }));
  expect(screen.queryByText('620 XP')).toBeNull();
  header.mockResolvedValue({ data: { ...payload, total_xp: 700 }, error: null });
  await act(async () => change?.('active'));
  expect(await screen.findByText('700 XP')).toBeVisible();
  app.unmount();
});
it('a late expired-token failure cannot clear newer same-account progress', async () => {
  let fail: (cause: Error) => void = () => {};
  header.mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      fail = reject;
    }),
  );
  const { rerender } = render(<ProgressPanel userId="owner" accessToken="expired" />);
  await waitFor(() => expect(header).toHaveBeenCalledWith('Authorization', 'Bearer expired'));
  rerender(<ProgressPanel userId="owner" accessToken="renewed" />);
  expect(await screen.findByText('620 XP')).toBeVisible();
  await act(async () => fail(new Error('session expired')));
  expect(screen.getByText('620 XP')).toBeVisible();
  expect(screen.queryByText('Progress is unavailable.')).toBeNull();
});
it('drops old-account photo XP feedback after switching to another account', async () => {
  const oldReceipt = {
    user_id: 'owner',
    submission_id: 'old-photo',
    word_xp: 10,
    challenge_bonus_xp: 10,
    milestone_xp: 25,
  };
  let finish: (value: { data: typeof oldReceipt; error: null }) => void = () => {};
  header.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { rerender } = render(
    <View>
      <SubmissionXpFeedback key="owner" userId="owner" accessToken="old" submissionId="old-photo" />
    </View>,
  );
  await waitFor(() => expect(header).toHaveBeenCalledWith('Authorization', 'Bearer old'));
  header.mockResolvedValue({
    data: {
      ...oldReceipt,
      user_id: 'other',
      submission_id: 'new-photo',
      word_xp: 0,
      challenge_bonus_xp: 0,
      milestone_xp: 0,
    },
    error: null,
  });
  await act(async () =>
    rerender(
      <View>
        <SubmissionXpFeedback
          key="other"
          userId="other"
          accessToken="new"
          submissionId="new-photo"
        />
      </View>,
    ),
  );
  await act(async () => finish({ data: oldReceipt, error: null }));
  expect(screen.queryByText('+10 XP · word completed')).toBeNull();
  expect(screen.queryByText('+25 XP · streak milestone')).toBeNull();
  expect(header).toHaveBeenLastCalledWith('Authorization', 'Bearer new');
});
