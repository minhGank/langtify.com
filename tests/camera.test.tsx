import type * as ReactTypes from 'react';
import type { CameraCapturedPicture, CameraViewProps } from 'expo-camera';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { CameraCapture } from '@/features/photos/camera-capture';
import { Linking } from 'react-native';
const mockRequest = jest.fn(),
  mockTake = jest.fn();
const mockDelete = jest.fn();
jest.mock('expo-file-system', () => ({
  File: class {
    exists = true;
    delete() {
      mockDelete();
    }
  },
}));
let mockPermission: { granted: boolean; canAskAgain: boolean } | null;
jest.mock('expo-camera', () => {
  const React: typeof ReactTypes = jest.requireActual('react');
  return {
    useCameraPermissions: () => [mockPermission, mockRequest],
    CameraView: React.forwardRef(function MockCamera(props: CameraViewProps, ref) {
      React.useImperativeHandle(ref, () => ({ takePictureAsync: mockTake }));
      return React.createElement('CameraPreview', { ...props, testID: 'camera-preview' });
    }),
  };
});
beforeEach(() => {
  jest.clearAllMocks();
  mockPermission = { granted: false, canAskAgain: true };
  mockRequest.mockResolvedValue(undefined);
  mockTake.mockResolvedValue({ uri: 'file:///camera.jpg', width: 3000, height: 2000 });
});
it('requests permission once after the capture action and permits an explicit denied-access retry', async () => {
  render(<CameraCapture onCapture={jest.fn()} onCancel={jest.fn()} />);
  expect(await screen.findByText('Capture this word')).toBeVisible();
  expect(mockRequest).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('camera-preview')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Allow camera' }));
  await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(2));
});
it('offers settings when permission cannot be requested again', async () => {
  mockPermission = { granted: false, canAskAgain: false };
  const settings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
  render(<CameraCapture onCapture={jest.fn()} onCancel={jest.fn()} />);
  expect(screen.queryByRole('button', { name: 'Allow camera' })).toBeNull();
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Open Settings' })));
  expect(settings).toHaveBeenCalledTimes(1);
  settings.mockRestore();
});
it('does not repeat the native permission prompt on an unchanged denied state', async () => {
  const props = { onCapture: jest.fn(), onCancel: jest.fn() };
  const { rerender } = render(<CameraCapture {...props} />);
  await screen.findByText('Capture this word');
  mockPermission = { granted: false, canAskAgain: true };
  rerender(<CameraCapture {...props} />);
  await act(async () => {});
  expect(mockRequest).toHaveBeenCalledTimes(1);
});
it('blocks capture until ready, then returns a processed camera photo for preview', async () => {
  mockPermission = { granted: true, canAskAgain: true };
  const captured = jest.fn<Promise<void>, [CameraCapturedPicture]>().mockResolvedValue();
  render(<CameraCapture onCapture={captured} onCancel={jest.fn()} />);
  expect(screen.getByRole('button', { name: 'Take photo' })).toBeDisabled();
  fireEvent(screen.getByTestId('camera-preview'), 'cameraReady');
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Take photo' })));
  expect(mockTake).toHaveBeenCalledWith({ exif: false, quality: 1, skipProcessing: false });
  expect(captured).toHaveBeenCalledTimes(1);
});
it('shows a recoverable capture error and permits another attempt', async () => {
  mockPermission = { granted: true, canAskAgain: true };
  mockTake.mockRejectedValueOnce(new Error('camera failure'));
  render(<CameraCapture onCapture={jest.fn()} onCancel={jest.fn()} />);
  fireEvent(screen.getByTestId('camera-preview'), 'cameraReady');
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Take photo' })));
  expect(screen.getByText(/couldn’t take this photo/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Take photo' })).toBeEnabled();
});

it('discards a camera result arriving after the camera unmounts', async () => {
  mockPermission = { granted: true, canAskAgain: true };
  let finish: (value: { uri: string; width: number; height: number }) => void = () => {};
  mockTake.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const captured = jest.fn();
  const view = render(<CameraCapture onCapture={captured} onCancel={jest.fn()} />);
  fireEvent(screen.getByTestId('camera-preview'), 'cameraReady');
  fireEvent.press(screen.getByRole('button', { name: 'Take photo' }));
  view.unmount();
  await act(async () => finish({ uri: 'file:///obsolete.jpg', width: 16, height: 16 }));
  expect(captured).not.toHaveBeenCalled();
  expect(mockDelete).toHaveBeenCalledTimes(1);
});

it('keeps the library usable when camera permission is denied without requesting camera access', () => {
  mockPermission = { granted: false, canAskAgain: false };
  const choose = jest.fn();
  render(<CameraCapture onCapture={jest.fn()} onCancel={jest.fn()} onChooseLibrary={choose} />);
  fireEvent.press(screen.getByRole('button', { name: 'Choose from library' }));
  expect(choose).toHaveBeenCalledTimes(1);
  expect(mockRequest).not.toHaveBeenCalled();
  expect(mockTake).not.toHaveBeenCalled();
});

it('shows a secondary library action beside the shutter', () => {
  mockPermission = { granted: true, canAskAgain: true };
  const choose = jest.fn();
  render(<CameraCapture onCapture={jest.fn()} onCancel={jest.fn()} onChooseLibrary={choose} />);
  expect(screen.getByRole('button', { name: 'Take photo' })).toBeVisible();
  expect(screen.getByText('Photo library')).toBeVisible();
  fireEvent.press(screen.getByRole('button', { name: 'Choose from library' }));
  expect(choose).toHaveBeenCalledTimes(1);
});
