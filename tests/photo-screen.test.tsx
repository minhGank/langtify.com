import type * as ReactTypes from 'react';
import type * as NativeTypes from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, View } from 'react-native';
import { PhotoContent } from '@/features/photos/photo-screen';
import {
  photoAssignment,
  photoUser,
  photoFixture,
  preparedPhoto,
  makeSubmission,
} from './photo-fixtures';
let mockFixture = photoFixture();
const mockPrepare = jest.fn().mockResolvedValue(preparedPhoto);
jest.mock('@/services/submissions', () => ({ photoGateway: () => mockFixture.gateway }));
jest.mock('@/features/photos/photo-files', () => ({
  loadDraft: async () => null,
  removeDraft: jest.fn(),
  preparePhoto: (...args: unknown[]) => mockPrepare(...args),
}));
jest.mock('@/features/photos/camera-capture', () => ({
  CameraCapture: ({
    onCapture,
  }: {
    onCapture: (photo: { uri: string; width: number; height: number }) => Promise<void>;
  }) => {
    const { Button }: typeof NativeTypes = jest.requireActual('react-native');
    return (
      <Button
        title="Mock camera shutter"
        onPress={() => void onCapture({ uri: 'file:///raw.jpg', width: 3000, height: 2000 })}
      />
    );
  },
}));
jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
  useFocusEffect: (callback: () => () => void) => {
    const React = jest.requireActual<typeof ReactTypes>('react');
    React.useEffect(callback, [callback]);
  },
}));
beforeEach(() => {
  mockFixture = photoFixture();
  jest.clearAllMocks();
  AppState.currentState = 'active';
});
it('shows a camera preview before submission, starts private, and supports retake', async () => {
  render(<PhotoContent userId={photoUser} assignmentId={photoAssignment} token="test-token" />);
  fireEvent.press(await screen.findByRole('button', { name: 'Take Photo' }));
  fireEvent.press(screen.getByText('Mock camera shutter'));
  expect(await screen.findByLabelText('Your challenge photo')).toBeVisible();
  expect(mockFixture.gateway.upload).not.toHaveBeenCalled();
  expect(
    screen.getByRole('switch', { name: 'Share with the Langtify community' }).props.value,
  ).toBe(false);
  fireEvent(screen.getByRole('switch'), 'valueChange', true);
  fireEvent.press(screen.getByRole('button', { name: 'Retake photo' }));
  expect(screen.queryByLabelText('Your challenge photo')).toBeNull();
  fireEvent.press(screen.getByText('Mock camera shutter'));
  await screen.findByLabelText('Your challenge photo');
  expect(screen.getByRole('switch').props.value).toBe(false);
  expect(screen.getByRole('button', { name: 'Submit photo' })).toBeDisabled();
  fireEvent(screen.getByLabelText('Your challenge photo'), 'load');
  fireEvent.press(screen.getByRole('button', { name: 'Submit photo' }));
  expect(await screen.findByText('✓ Completed')).toBeVisible();
});
it('shows saved owner detail and requires confirmation before deletion', async () => {
  mockFixture = photoFixture(
    makeSubmission({ status: 'completed', submitted_at: '2026-09-12T13:00:00Z' }),
  );
  render(<PhotoContent userId={photoUser} assignmentId={photoAssignment} token="test-token" />);
  expect(await screen.findByText('Visibility: Private')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Submit photo' })).toBeNull();
  fireEvent(screen.getByRole('switch'), 'valueChange', true);
  expect(await screen.findByText('Visibility: Public')).toBeVisible();
  fireEvent.press(screen.getByRole('button', { name: 'Delete photo' }));
  expect(mockFixture.gateway.beginDelete).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'Confirm delete photo' }));
  expect(await screen.findByRole('button', { name: 'Take Photo' })).toBeVisible();
});
it('does not expose the old account preview when the account-scoped screen remounts', async () => {
  const view = render(
    <View>
      <PhotoContent key="a" userId={photoUser} assignmentId={photoAssignment} token="first" />
    </View>,
  );
  fireEvent.press(await screen.findByRole('button', { name: 'Take Photo' }));
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
  await waitFor(() => expect(screen.getByRole('button', { name: 'Take Photo' })).toBeVisible());
  await act(async () => {});
});

it('unmounts the camera in the background and restores it on resume', async () => {
  let onState: (state: 'active' | 'background') => void = () => {};
  const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    onState = listener;
    return { remove: jest.fn() };
  });
  render(<PhotoContent userId={photoUser} assignmentId={photoAssignment} token="test-token" />);
  fireEvent.press(await screen.findByRole('button', { name: 'Take Photo' }));
  expect(screen.getByText('Mock camera shutter')).toBeVisible();
  act(() => onState('background'));
  expect(screen.queryByText('Mock camera shutter')).toBeNull();
  await act(async () => onState('active'));
  expect(screen.getByText('Mock camera shutter')).toBeVisible();
  spy.mockRestore();
});
