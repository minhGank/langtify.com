import * as ImagePicker from 'expo-image-picker';

export type LibraryPhoto = { uri: string; width: number; height: number };
type LibraryErrorCode = 'permission' | 'unavailable' | 'invalid-photo';

export class PhotoLibraryError extends Error {
  constructor(public readonly code: LibraryErrorCode) {
    super(
      code === 'permission'
        ? 'Photo access is unavailable. Choose another photo or check access in Settings.'
        : code === 'invalid-photo'
          ? 'This photo could not be opened. Please choose another photo.'
          : 'The photo library could not be opened. Please try again.',
    );
    this.name = 'PhotoLibraryError';
  }
}

export async function pickLibraryPhoto(): Promise<LibraryPhoto | null> {
  let selection: ImagePicker.ImagePickerResult;
  try {
    // SDK 57's image-only system picker grants access to the selected photo, even
    // when broad library access is denied/limited. Do not request broad permission.
    // Call before any await to preserve browser user activation as well.
    selection = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
      allowsEditing: false,
      legacy: false,
      exif: false,
      base64: false,
      quality: 1,
      shouldDownloadFromNetwork: true,
    });
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
    throw new PhotoLibraryError(
      code === 'ERR_USER_REJECTED_PERMISSIONS' || code === 'E_NO_LIBRARY_PERMISSION'
        ? 'permission'
        : 'unavailable',
    );
  }
  if (selection.canceled) return null;
  const image = selection.assets[0];
  if (
    selection.assets.length !== 1 ||
    !image ||
    !image.uri.trim() ||
    (image.type != null && image.type !== 'image') ||
    (image.mimeType != null && !image.mimeType.startsWith('image/')) ||
    image.pairedVideoAsset != null ||
    !Number.isFinite(image.width) ||
    !Number.isFinite(image.height) ||
    image.width <= 0 ||
    image.height <= 0
  )
    throw new PhotoLibraryError('invalid-photo');

  // Never use an asset ID to reopen/delete a library original, or pass its EXIF,
  // filename or other metadata into the submission pipeline. preparePhoto owns
  // JPEG normalization; its cleanup must only remove app-owned temporary files.
  return { uri: image.uri, width: image.width, height: image.height };
}
