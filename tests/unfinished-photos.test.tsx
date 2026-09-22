import type * as ReactTypes from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, View } from 'react-native';
import { UnfinishedPhotos } from '@/features/photos/unfinished-photos';
import type { UnfinishedPhoto } from '@/services/submissions';
const mockLoad = jest.fn<Promise<UnfinishedPhoto[]>, [string, string]>(),
  mockPush = jest.fn();
jest.mock('@/services/submissions', () => ({
  listUnfinishedPhotos: (user: string, token: string) => mockLoad(user, token),
}));
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
});
it('does not start recovery reads while backgrounded or from an obsolete foreground callback', async () => {
  AppState.currentState = 'background';
  const listeners = jest.spyOn(AppState, 'addEventListener');
  const { unmount } = render(
    <UnfinishedPhotos userId="owner" token="token" currentAssignments={[]} />,
  );
  await act(async () => {});
  expect(mockLoad).not.toHaveBeenCalled();
  const callback = listeners.mock.calls.at(-1)?.[1];
  unmount();
  AppState.currentState = 'active';
  await act(async () => callback?.('active'));
  expect(mockLoad).not.toHaveBeenCalled();
});
it('recovers earlier-date operations even when today has different assignments or cannot load', async () => {
  mockLoad.mockResolvedValue([
    { assignmentId: 'yesterday', targetTerm: 'la fenêtre' },
    { assignmentId: 'today', targetTerm: 'bondé' },
  ]);
  render(<UnfinishedPhotos userId="owner" token="owner-token" currentAssignments={['today']} />);
  fireEvent.press(await screen.findByRole('button', { name: 'Resume La fenêtre photo' }));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/photo',
    params: { assignmentId: 'yesterday' },
  });
  expect(screen.queryByRole('button', { name: 'Resume Bondé photo' })).toBeNull();
});
it('offers retry when recovery history is offline', async () => {
  mockLoad.mockRejectedValueOnce(new Error('offline')).mockResolvedValue([]);
  render(<UnfinishedPhotos userId="owner" token="token" currentAssignments={[]} />);
  fireEvent.press(await screen.findByRole('button', { name: 'Retry unfinished photos' }));
  await waitFor(() =>
    expect(screen.queryByText('Unfinished photos could not be loaded.')).toBeNull(),
  );
});
it('does not restore another account’s pending operations after unmount', async () => {
  let finish: (photos: UnfinishedPhoto[]) => void = () => {};
  mockLoad
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    )
    .mockResolvedValue([]);
  const view = render(
    <View>
      <UnfinishedPhotos key="old" userId="old" token="old-token" currentAssignments={[]} />
    </View>,
  );
  await waitFor(() => expect(mockLoad).toHaveBeenCalledWith('old', 'old-token'));
  view.rerender(
    <View>
      <UnfinishedPhotos key="new" userId="new" token="new-token" currentAssignments={[]} />
    </View>,
  );
  await act(async () => finish([{ assignmentId: 'private-id', targetTerm: 'private word' }]));
  expect(screen.queryByText(/private word/)).toBeNull();
});
