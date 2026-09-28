import type * as ReactTypes from 'react';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, Animated } from 'react-native';
import { PhotoAddedNotice } from '@/features/progress/photo-added-notice';
import { postAcknowledgement } from '@/features/discover/owned-post-access';
import { clearServerData } from '@/lib/server-cache';
import type { XpReceipt } from '@/services/progress';
const mockReceipt = jest.fn();
jest.mock('@/services/progress', () => ({ receiptGateway: () => mockReceipt }));
jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => true }));
jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
  useFocusEffect: (callback: () => (() => void) | undefined) => {
    const React = jest.requireActual<typeof ReactTypes>('react');
    React.useEffect(callback, [callback]);
  },
}));
const identity = { userId: 'owner', token: 'token' };
beforeEach(() => {
  jest.clearAllMocks();
  AppState.currentState = 'active';
  mockReceipt.mockResolvedValue({ wordXp: 10, challengeBonusXp: 10, milestoneXp: 0 });
});
it('shows one short server-backed acknowledgement with Reduce Motion, then removes it and never replays on revisit', async () => {
  postAcknowledgement(identity, 'photo').set(performance.now() + 10000);
  const animation = jest.spyOn(Animated, 'timing');
  const view = render(<PhotoAddedNotice {...identity} submissionId="photo" />);
  expect(await screen.findByText('Photo added · +20 XP')).toBeVisible();
  expect(animation).not.toHaveBeenCalled();
  view.unmount();
  render(<PhotoAddedNotice {...identity} submissionId="photo" />);
  expect(screen.queryByText(/Photo added/)).toBeNull();
  expect(mockReceipt).toHaveBeenCalledTimes(1);
  animation.mockRestore();
});
it('drops a late XP response after account switching and does not show old success copy', async () => {
  let finish: (receipt: XpReceipt) => void = () => {};
  mockReceipt.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  postAcknowledgement(identity, 'photo').set(performance.now() + 10000);
  const view = render(<PhotoAddedNotice {...identity} submissionId="photo" />);
  await waitFor(() => expect(mockReceipt).toHaveBeenCalledTimes(1));
  view.rerender(<PhotoAddedNotice userId="other" token="other" submissionId="photo" />);
  await act(async () => finish({ wordXp: 10, challengeBonusXp: 10, milestoneXp: 200 }));
  expect(screen.queryByText(/Photo added/)).toBeNull();
});
it('does not replay an expired or background acknowledgement', () => {
  postAcknowledgement(identity, 'photo').set(performance.now() - 1);
  const view = render(<PhotoAddedNotice {...identity} submissionId="photo" />);
  expect(mockReceipt).not.toHaveBeenCalled();
  view.unmount();
  postAcknowledgement(identity, 'photo').set(performance.now() + 10000);
  AppState.currentState = 'background';
  render(<PhotoAddedNotice {...identity} submissionId="photo" />);
  expect(screen.queryByText(/Photo added/)).toBeNull();
  expect(mockReceipt).not.toHaveBeenCalled();
});
it('clears visible feedback when session caches retire', async () => {
  postAcknowledgement(identity, 'photo').set(performance.now() + 10000);
  render(<PhotoAddedNotice {...identity} submissionId="photo" />);
  await screen.findByText('Photo added · +20 XP');
  act(() => clearServerData());
  expect(screen.queryByText(/Photo added/)).toBeNull();
});
it('removes the acknowledgement after four seconds without waiting for XP', async () => {
  jest.useFakeTimers();
  try {
    mockReceipt.mockImplementationOnce(() => new Promise(() => {}));
    postAcknowledgement(identity, 'photo').set(performance.now() + 10000);
    render(<PhotoAddedNotice {...identity} submissionId="photo" />);
    expect(screen.getByText('Photo added')).toBeVisible();
    await act(async () => jest.advanceTimersByTime(4000));
    expect(screen.queryByText(/Photo added/)).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});
