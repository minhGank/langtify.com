import type * as ReactTypes from 'react';
import type * as NativeTypes from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, View } from 'react-native';
import { feedback } from '@/lib/haptics';
import { PhotoContent, PhotoScreen } from '@/features/photos/photo-screen';
import { makeSession } from './fixtures';
import {
  photoAssignment,
  photoUser,
  photoFixture,
  preparedPhoto,
  makeSubmission,
} from './photo-fixtures';
jest.mock('@/lib/haptics', () => ({ feedback: { success: jest.fn(), warning: jest.fn() } }));
let mockFixture = photoFixture();
const mockPrepare = jest.fn().mockResolvedValue(preparedPhoto);
const mockLoadDraft = jest.fn().mockResolvedValue(null);
const mockPickLibrary = jest.fn();
const mockGateway = jest.fn();
const mockRemoveDraft = jest.fn();
const mockReceipt = jest.fn();
let mockSession = makeSession(photoUser);
let mockParams: { assignmentId?: string; capture?: string; captureKind?: string | string[] } = {};
jest.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({ status: 'ready', session: mockSession }),
}));
jest.mock('@/services/progress', () => ({ receiptGateway: () => mockReceipt }));
jest.mock('@/features/photos/pick-library-photo', () => ({
  ...jest.requireActual('@/features/photos/pick-library-photo'),
  pickLibraryPhoto: () => mockPickLibrary(),
}));
jest.mock('@/services/submissions', () => ({
  photoGateway: (...args: unknown[]) => {
    mockGateway(...args);
    return mockFixture.gateway;
  },
}));
jest.mock('@/features/photos/photo-files', () => ({
  loadDraft: () => mockLoadDraft(),
  removeDraft: (...args: unknown[]) => mockRemoveDraft(...args),
  preparePhoto: (...args: unknown[]) => mockPrepare(...args),
}));
jest.mock('@/features/photos/camera-capture', () => ({
  CameraCapture: ({
    onCapture,
    onChooseLibrary,
  }: {
    onCapture: (photo: { uri: string; width: number; height: number }) => Promise<void>;
    onChooseLibrary?: () => void;
  }) => {
    const { Button }: typeof NativeTypes = jest.requireActual('react-native');
    return (
      <>
        <Button
          title="Mock camera shutter"
          onPress={() => void onCapture({ uri: 'file:///raw.jpg', width: 3000, height: 2000 })}
        />
        {onChooseLibrary && <Button title="Choose from library" onPress={onChooseLibrary} />}
      </>
    );
  },
}));
jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), canGoBack: () => false },
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (callback: () => () => void) => {
    const React = jest.requireActual<typeof ReactTypes>('react');
    React.useEffect(callback, [callback]);
  },
}));
beforeEach(() => {
  mockFixture = photoFixture();
  jest.clearAllMocks();
  mockSession = makeSession(photoUser);
  mockParams = { assignmentId: photoAssignment };
  mockReceipt.mockResolvedValue({ wordXp: 10, challengeBonusXp: 0, milestoneXp: 0 });
  mockLoadDraft.mockResolvedValue(null);
  mockPrepare.mockResolvedValue(preparedPhoto);
  mockPickLibrary
    .mockReset()
    .mockResolvedValue({ uri: 'file:///library.heic', width: 4032, height: 3024 });
  jest.mocked(AppState.addEventListener).mockReturnValue({ remove: jest.fn() });
  AppState.currentState = 'active';
});
it('shows a camera preview before submission, starts private, and supports retake', async () => {
  render(<PhotoContent userId={photoUser} assignmentId={photoAssignment} token="test-token" />);
  fireEvent.press(await screen.findByRole('button', { name: 'Take photo' }));
  fireEvent.press(screen.getByText('Mock camera shutter'));
  expect(await screen.findByLabelText('Your challenge photo')).toBeVisible();
  expect(mockFixture.gateway.upload).not.toHaveBeenCalled();
  expect(screen.getByRole('switch', { name: 'Share this photo publicly' }).props.value).toBe(false);
  fireEvent(screen.getByRole('switch'), 'valueChange', true);
  expect(screen.getByText('Visible to other learners')).toBeVisible();
  fireEvent.press(screen.getByRole('button', { name: 'Retake photo' }));
  expect(screen.queryByLabelText('Your challenge photo')).toBeNull();
  fireEvent.press(screen.getByText('Mock camera shutter'));
  await screen.findByLabelText('Your challenge photo');
  expect(screen.getByRole('switch').props.value).toBe(false);
  expect(screen.getByRole('button', { name: 'Add photo' })).toBeDisabled();
  fireEvent(screen.getByLabelText('Your challenge photo'), 'load');
  fireEvent.press(screen.getByRole('button', { name: 'Add photo' }));
  expect(await screen.findByText('Completed')).toBeVisible();
  expect(feedback.success).toHaveBeenCalledTimes(1);
  expect(feedback.warning).not.toHaveBeenCalled();
});
it('shows saved owner detail and requires confirmation before deletion', async () => {
  mockFixture = photoFixture(
    makeSubmission({ status: 'completed', submitted_at: '2026-09-12T13:00:00Z' }),
  );
  render(<PhotoContent userId={photoUser} assignmentId={photoAssignment} token="test-token" />);
  expect(await screen.findByText('Private')).toBeVisible();
  fireEvent.press(screen.getByRole('button', { name: 'Photo options' }));
  expect(screen.queryByRole('button', { name: 'Add photo' })).toBeNull();
  fireEvent(screen.getByRole('switch'), 'valueChange', true);
  expect(await screen.findByText('Visible to other learners')).toBeVisible();
  fireEvent.press(screen.getByRole('button', { name: 'Delete photo' }));
  expect(mockFixture.gateway.beginDelete).not.toHaveBeenCalled();
  expect(feedback.warning).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'Confirm delete photo' }));
  expect(await screen.findByRole('button', { name: 'Take photo' })).toBeVisible();
  expect(feedback.warning).toHaveBeenCalledTimes(1);
  expect(feedback.success).not.toHaveBeenCalled();
});

it('keeps the reviewed image and disables submission while completed-photo recovery is loading', async () => {
  mockLoadDraft.mockResolvedValue(preparedPhoto);
  let finish: (uri: string) => void = () => {};
  mockFixture.gateway.preview.mockResolvedValueOnce(null).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<PhotoContent userId={photoUser} assignmentId={photoAssignment} token="test-token" />);
  fireEvent(await screen.findByLabelText('Your challenge photo'), 'load');
  fireEvent.press(screen.getByRole('button', { name: 'Add photo' }));
  await waitFor(() => expect(mockFixture.gateway.finalize).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(mockFixture.gateway.preview).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText('Your challenge photo').props.source.uri).toBe(preparedPhoto.uri);
  expect(screen.getByRole('button', { name: 'Add photo' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Take photo' })).toBeNull();
  expect(mockRemoveDraft).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'Add photo' }));
  expect(mockFixture.gateway.reserve).toHaveBeenCalledTimes(1);
  await act(async () => finish('https://example.test/confirmed-photo'));
  expect(await screen.findByText('Completed')).toBeVisible();
  expect(screen.getByLabelText('Your challenge photo').props.source.uri).toBe(
    'https://example.test/confirmed-photo',
  );
  expect(screen.queryByRole('button', { name: 'Add photo' })).toBeNull();
  expect(mockFixture.gateway.finalize).toHaveBeenCalledTimes(1);
  expect(mockRemoveDraft).toHaveBeenCalled();
  expect(feedback.success).toHaveBeenCalledTimes(1);
});
it('does not expose the old account preview when the account-scoped screen remounts', async () => {
  const view = render(
    <View>
      <PhotoContent key="a" userId={photoUser} assignmentId={photoAssignment} token="first" />
    </View>,
  );
  fireEvent.press(await screen.findByRole('button', { name: 'Take photo' }));
  fireEvent.press(screen.getByText('Mock camera shutter'));
  await screen.findByLabelText('Your challenge photo');
  mockFixture = photoFixture();
  view.rerender(
    <View>
      <PhotoContent
        key="b"
        userId="45000000-0000-4000-8000-000000000009"
        assignmentId={photoAssignment}
        token="second"
      />
    </View>,
  );
  expect(screen.queryByLabelText('Your challenge photo')).toBeNull();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Take photo' })).toBeVisible());
  await act(async () => {});
});

it('unmounts the camera in the background and restores it on resume', async () => {
  let onState: (state: 'active' | 'background') => void = () => {};
  const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    onState = listener;
    return { remove: jest.fn() };
  });
  render(<PhotoContent userId={photoUser} assignmentId={photoAssignment} token="test-token" />);
  fireEvent.press(await screen.findByRole('button', { name: 'Take photo' }));
  expect(screen.getByText('Mock camera shutter')).toBeVisible();
  act(() => onState('background'));
  expect(screen.queryByText('Mock camera shutter')).toBeNull();
  await act(async () => onState('active'));
  expect(screen.getByText('Mock camera shutter')).toBeVisible();
  spy.mockRestore();
});

it('starts camera after explicit Today capture intent without reserving or submitting', async () => {
  render(
    <PhotoContent
      userId={photoUser}
      assignmentId={photoAssignment}
      token="test-token"
      startCamera
    />,
  );
  expect(await screen.findByText('Mock camera shutter')).toBeVisible();
  expect(mockFixture.gateway.reserve).not.toHaveBeenCalled();
});

it('reviews a recovered draft instead of opening another camera from Today', async () => {
  mockLoadDraft.mockResolvedValue(preparedPhoto);
  render(
    <PhotoContent
      userId={photoUser}
      assignmentId={photoAssignment}
      token="test-token"
      startCamera
    />,
  );
  expect(await screen.findByLabelText('Your challenge photo')).toBeVisible();
  expect(screen.queryByText('Mock camera shutter')).toBeNull();
  expect(mockFixture.gateway.reserve).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Add photo' })).toBeDisabled();
});

it('keeps submission disabled after a failed preview until the retried image loads', async () => {
  mockLoadDraft.mockResolvedValue(preparedPhoto);
  render(<PhotoContent userId={photoUser} assignmentId={photoAssignment} token="test-token" />);
  const original = await screen.findByLabelText('Your challenge photo');
  fireEvent(original, 'error');
  fireEvent.press(screen.getByRole('button', { name: 'Reload photo' }));
  await waitFor(() =>
    expect(screen.queryByText('We couldn’t display this photo. Try reloading it.')).toBeNull(),
  );
  expect(screen.getByRole('button', { name: 'Add photo' })).toBeDisabled();
  fireEvent(screen.getByLabelText('Your challenge photo'), 'load');
  expect(screen.getByRole('button', { name: 'Add photo' })).toBeEnabled();
  expect(mockFixture.gateway.finalize).not.toHaveBeenCalled();
});
it('exposes uncertain visibility recovery inside photo options without replaying the mutation', async () => {
  mockFixture = photoFixture(
    makeSubmission({ status: 'completed', submitted_at: '2026-09-12T13:00:00Z' }),
  );
  mockFixture.gateway.visibility.mockRejectedValueOnce(new Error('network interrupted'));
  render(<PhotoContent userId={photoUser} assignmentId={photoAssignment} token="test-token" />);
  fireEvent.press(await screen.findByRole('button', { name: 'Photo options' }));
  fireEvent(screen.getByRole('switch'), 'valueChange', true);
  const recovery = await screen.findByRole('button', { name: 'Refresh privacy setting' });
  expect(recovery).toBeEnabled();
  const reads = mockFixture.gateway.load.mock.calls.length;
  await act(async () => fireEvent.press(recovery));
  expect(mockFixture.gateway.load).toHaveBeenCalledTimes(reads + 1);
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Refresh privacy setting' })).toBeNull(),
  );
  expect(screen.getByRole('switch').props.value).toBe(false);
  expect(mockFixture.gateway.visibility).toHaveBeenCalledTimes(1);
});

it('offers the library alongside the camera and submits only its normalized preview through the existing public flow', async () => {
  mockPrepare.mockResolvedValue({ ...preparedPhoto, source: 'library' });
  render(
    <PhotoContent
      userId={photoUser}
      assignmentId={photoAssignment}
      token="test-token"
      startCamera
    />,
  );
  fireEvent.press(await screen.findByRole('button', { name: 'Choose from library' }));
  const preview = await screen.findByLabelText('Your challenge photo');
  expect(mockPrepare).toHaveBeenCalledWith(
    { uri: 'file:///library.heic', width: 4032, height: 3024 },
    photoUser,
    photoAssignment,
    expect.any(Function),
    { removeSource: false, source: 'library' },
  );
  expect(mockFixture.gateway.reserve).not.toHaveBeenCalled();
  expect(screen.getByRole('switch').props.value).toBe(false);
  expect(screen.getByRole('button', { name: 'Add photo' })).toBeDisabled();
  fireEvent(preview, 'load');
  fireEvent(screen.getByRole('switch'), 'valueChange', true);
  fireEvent.press(screen.getByRole('button', { name: 'Add photo' }));
  expect(await screen.findByText('Completed')).toBeVisible();
  expect(mockFixture.gateway.upload).toHaveBeenCalledWith(expect.anything(), preparedPhoto.bytes);
  expect(mockFixture.gateway.finalize).toHaveBeenCalledWith(makeSubmission().id, 'public');
  expect(mockFixture.gateway.upload).toHaveBeenCalledTimes(1);
});

it('cancelling reselection keeps the reviewed draft and visibility unchanged', async () => {
  mockLoadDraft.mockResolvedValue({ ...preparedPhoto, source: 'library' });
  mockPickLibrary.mockResolvedValue(null);
  render(<PhotoContent userId={photoUser} assignmentId={photoAssignment} token="test-token" />);
  await screen.findByLabelText('Your challenge photo');
  fireEvent(screen.getByRole('switch'), 'valueChange', true);
  fireEvent.press(await screen.findByRole('button', { name: 'Choose another photo' }));
  await waitFor(() => expect(screen.queryByLabelText('Preparing library photo')).toBeNull());
  expect(screen.getByLabelText('Your challenge photo').props.source.uri).toBe(preparedPhoto.uri);
  expect(screen.getByRole('switch').props.value).toBe(true);
  expect(mockPrepare).not.toHaveBeenCalled();
  expect(mockFixture.gateway.reserve).not.toHaveBeenCalled();
});

it('hides new library actions on an older word while preserving existing photo recovery', async () => {
  mockFixture.gateway.canChooseLibraryPhoto.mockResolvedValue(false);
  render(<PhotoContent userId={photoUser} assignmentId={photoAssignment} token="test-token" />);
  await screen.findByRole('button', { name: 'Take photo' });
  await waitFor(() => expect(mockFixture.gateway.canChooseLibraryPhoto).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: 'Choose from library' })).toBeNull();
  expect(mockPickLibrary).not.toHaveBeenCalled();
});

it('offers an explicit library eligibility retry while keeping camera capture available', async () => {
  mockFixture.gateway.canChooseLibraryPhoto.mockRejectedValueOnce(new Error('offline'));
  render(<PhotoContent userId={photoUser} assignmentId={photoAssignment} token="test-token" />);
  const retry = await screen.findByRole('button', { name: 'Try photo library again' });
  expect(screen.getByRole('button', { name: 'Take photo' })).toBeEnabled();
  fireEvent.press(retry);
  expect(await screen.findByRole('button', { name: 'Choose from library' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Try photo library again' })).toBeNull();
});

it.each([
  ['camera', 'private'],
  ['camera', 'public'],
  ['library', 'private'],
  ['library', 'public'],
] as const)(
  'captures a historical %s photo through the shared %s flow with vocabulary-only success',
  async (source, visibility) => {
    mockFixture = photoFixture(null, { captureKind: 'historical', localDate: '2026-08-01' });
    mockParams = { assignmentId: photoAssignment, captureKind: 'historical', capture: '1' };
    if (source === 'library')
      mockPrepare.mockResolvedValue({ ...preparedPhoto, source: 'library' });
    render(<PhotoScreen />);
    if (source === 'camera') fireEvent.press(await screen.findByText('Mock camera shutter'));
    else fireEvent.press(await screen.findByRole('button', { name: 'Choose from library' }));
    const preview = await screen.findByLabelText('Your challenge photo');
    expect(screen.getByText('Past Word')).toBeVisible();
    expect(screen.getByRole('switch').props.value).toBe(false);
    expect(mockFixture.gateway.reserve).not.toHaveBeenCalled();
    fireEvent(preview, 'load');
    if (visibility === 'public') fireEvent(screen.getByRole('switch'), 'valueChange', true);
    fireEvent.press(screen.getByRole('button', { name: 'Add photo' }));
    expect(await screen.findByText('Added to Vocabulary')).toBeVisible();
    expect(await screen.findByText('+10 XP')).toBeVisible();
    expect(screen.queryByText('Completed')).toBeNull();
    expect(screen.queryByText(/full challenge bonus|streak milestone|word completed/)).toBeNull();
    expect(mockGateway).toHaveBeenCalledWith(
      photoUser,
      photoAssignment,
      mockSession.access_token,
      'historical',
    );
    expect(mockFixture.gateway.upload).toHaveBeenCalledWith(
      makeSubmission({ capture_kind: 'historical' }),
      preparedPhoto.bytes,
    );
    expect(mockFixture.gateway.finalize).toHaveBeenCalledWith(makeSubmission().id, visibility);
    expect(mockFixture.gateway.upload).toHaveBeenCalledTimes(1);
  },
);

it('does not grant capture because a historical route says so when server eligibility is false', async () => {
  mockFixture = photoFixture(null, { captureKind: 'historical', canCapture: false });
  mockParams = { assignmentId: photoAssignment, captureKind: 'historical', capture: '1' };
  render(<PhotoScreen />);
  expect(await screen.findByRole('button', { name: 'Take photo' })).toBeDisabled();
  expect(screen.queryByText('Mock camera shutter')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Choose from library' })).toBeNull();
  expect(mockFixture.gateway.reserve).not.toHaveBeenCalled();
  expect(mockFixture.gateway.canChooseLibraryPhoto).not.toHaveBeenCalled();
});

it.each(['future', ['historical', 'daily']])(
  'rejects malformed capture route intent %s before loading any photo',
  (captureKind) => {
    mockParams = { assignmentId: photoAssignment, captureKind };
    render(<PhotoScreen />);
    expect(screen.getByText('This photo is unavailable.')).toBeVisible();
    expect(mockGateway).not.toHaveBeenCalled();
  },
);

it('drops a pending historical picker when the same assignment changes route intent', async () => {
  let finish: (photo: { uri: string; width: number; height: number }) => void = () => {};
  mockPickLibrary.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  mockFixture = photoFixture(null, { captureKind: 'historical' });
  mockParams = { assignmentId: photoAssignment, captureKind: 'historical', capture: '1' };
  const view = render(<PhotoScreen />);
  fireEvent.press(await screen.findByRole('button', { name: 'Choose from library' }));
  await waitFor(() => expect(mockPickLibrary).toHaveBeenCalledTimes(1));
  const historical = mockFixture;
  mockFixture = photoFixture();
  mockParams = { assignmentId: photoAssignment, captureKind: 'daily' };
  view.rerender(<PhotoScreen />);
  await screen.findByRole('button', { name: 'Take photo' });
  await act(async () => finish({ uri: 'file:///old-scope.heic', width: 3000, height: 2000 }));
  expect(mockPrepare).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('Your challenge photo')).toBeNull();
  expect(historical.gateway.reserve).not.toHaveBeenCalled();
  expect(mockFixture.gateway.reserve).not.toHaveBeenCalled();
});

it('drops a historical camera result after switching accounts while preprocessing is pending', async () => {
  let finish: (photo: typeof preparedPhoto) => void = () => {};
  mockPrepare.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  mockFixture = photoFixture(null, { captureKind: 'historical' });
  mockParams = { assignmentId: photoAssignment, captureKind: 'historical', capture: '1' };
  const view = render(<PhotoScreen />);
  fireEvent.press(await screen.findByText('Mock camera shutter'));
  await waitFor(() => expect(mockPrepare).toHaveBeenCalledTimes(1));
  const previous = mockFixture;
  mockSession = makeSession('45000000-0000-4000-8000-000000000009');
  mockFixture = photoFixture(null, { captureKind: 'historical' });
  view.rerender(<PhotoScreen />);
  await act(async () => finish(preparedPhoto));
  expect(screen.queryByLabelText('Your challenge photo')).toBeNull();
  expect(mockRemoveDraft).toHaveBeenCalledWith(photoUser, photoAssignment, preparedPhoto.uri);
  expect(previous.gateway.reserve).not.toHaveBeenCalled();
  expect(mockFixture.gateway.reserve).not.toHaveBeenCalled();
});
