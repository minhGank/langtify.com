import * as ImagePicker from 'expo-image-picker';
import { PhotoLibraryError, pickLibraryPhoto } from '@/features/photos/pick-library-photo';

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
  getMediaLibraryPermissionsAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  getPendingResultAsync: jest.fn(),
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied' },
}));

const image: ImagePicker.ImagePickerAsset = {
  uri: 'file:///cache/ImagePicker/selected.heic',
  width: 4032,
  height: 3024,
  type: 'image',
  mimeType: 'image/heic',
};
const launch = jest.mocked(ImagePicker.launchImageLibraryAsync);

beforeEach(() => {
  jest.clearAllMocks();
  launch.mockResolvedValue({ canceled: false, assets: [image] });
});

it('opens one native still-photo selection directly without an editor or metadata requests', async () => {
  const selected = pickLibraryPhoto();
  expect(launch).toHaveBeenCalledTimes(1);
  expect(launch).toHaveBeenCalledWith({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    allowsEditing: false,
    legacy: false,
    exif: false,
    base64: false,
    quality: 1,
    shouldDownloadFromNetwork: true,
  });
  expect(await selected).toEqual({ uri: image.uri, width: 4032, height: 3024 });
  expect(ImagePicker.getMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
  expect(ImagePicker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
  expect(ImagePicker.getPendingResultAsync).not.toHaveBeenCalled();
});

it.each(['none', 'limited'] as const)(
  'accepts the selected photo with %s broad library access and no asset ID',
  async (accessPrivileges) => {
    jest.mocked(ImagePicker.getMediaLibraryPermissionsAsync).mockResolvedValue({
      granted: accessPrivileges === 'limited',
      accessPrivileges,
      canAskAgain: false,
      expires: 'never',
      status:
        accessPrivileges === 'limited'
          ? ImagePicker.PermissionStatus.GRANTED
          : ImagePicker.PermissionStatus.DENIED,
    });
    launch.mockResolvedValue({
      canceled: false,
      assets: [{ ...image, assetId: null, fileName: null }],
    });
    await expect(pickLibraryPhoto()).resolves.toEqual({
      uri: image.uri,
      width: 4032,
      height: 3024,
    });
    expect(ImagePicker.getMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
    expect(ImagePicker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
  },
);

it('treats native cancellation as a clean no-op', async () => {
  launch.mockResolvedValue({ canceled: true, assets: null });
  await expect(pickLibraryPhoto()).resolves.toBeNull();
});

it.each(['ERR_USER_REJECTED_PERMISSIONS', 'E_NO_LIBRARY_PERMISSION'])(
  'reports %s safely without disclosing a native error path',
  async (code) => {
    launch.mockRejectedValue({ code, message: 'private-library-path.jpg' });
    await expect(pickLibraryPhoto()).rejects.toMatchObject({
      name: 'PhotoLibraryError',
      code: 'permission',
      message: 'We can’t access this photo. Choose another or check photo access in Settings.',
    });
  },
);

it('sanitizes unexpected native failures and permits an explicit retry', async () => {
  launch.mockRejectedValueOnce(new Error('private-image-name-and-path'));
  await expect(pickLibraryPhoto()).rejects.toEqual(new PhotoLibraryError('unavailable'));
  await expect(pickLibraryPhoto()).resolves.toEqual({
    uri: image.uri,
    width: 4032,
    height: 3024,
  });
  expect(launch).toHaveBeenCalledTimes(2);
});

it.each<ImagePicker.ImagePickerAsset[]>([
  [],
  [image, image],
  [{ ...image, uri: '' }],
  [{ ...image, type: 'video' }],
  [{ ...image, type: 'livePhoto' }],
  [{ ...image, pairedVideoAsset: { ...image, type: 'pairedVideo' } }],
  [{ ...image, mimeType: 'video/mp4' }],
  [{ ...image, width: 0 }],
  [{ ...image, width: NaN }],
  [{ ...image, height: Infinity }],
])('rejects unsupported or unreadable results before preprocessing (%#)', async (...assets) => {
  launch.mockResolvedValue({ canceled: false, assets });
  await expect(pickLibraryPhoto()).rejects.toEqual(new PhotoLibraryError('invalid-photo'));
});

it('returns only image input, discarding returned identifiers and private metadata', async () => {
  launch.mockResolvedValue({
    canceled: false,
    assets: [
      {
        ...image,
        assetId: 'private-library-identifier',
        fileName: 'private-filename.heic',
        exif: { GPSLatitude: 43.7, GPSLongitude: -79.4 },
        base64: 'not-for-upload',
      },
    ],
  });
  await expect(pickLibraryPhoto()).resolves.toEqual({
    uri: image.uri,
    width: 4032,
    height: 3024,
  });
});

it.each(['blob:https://langtify.com/photo', 'data:image/png;base64,iVBORw0KGgo='])(
  'preserves supported web picker input (%s) for shared JPEG preprocessing',
  async (uri) => {
    launch.mockResolvedValue({
      canceled: false,
      assets: [{ uri, width: 800, height: 600, mimeType: 'image/png' }],
    });
    await expect(pickLibraryPhoto()).resolves.toEqual({ uri, width: 800, height: 600 });
  },
);
