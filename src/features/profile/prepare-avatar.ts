import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat, type ImageRef } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import { jpegDataUri, stripJpegMetadata } from '@/features/photos/jpeg';

export type PreparedAvatar = { bytes: Uint8Array; uri: string };
export function avatarCrop(width: number, height: number) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 1 ||
    height < 1 ||
    width > 20000 ||
    height > 20000 ||
    width * height > 32000000
  )
    throw new Error('Choose a smaller photo.');
  const edge = Math.floor(Math.min(width, height));
  return {
    originX: Math.floor((width - edge) / 2),
    originY: Math.floor((height - edge) / 2),
    width: edge,
    height: edge,
  };
}
export async function pickAvatar(isCurrent: () => boolean): Promise<PreparedAvatar | null> {
  // The system picker exposes only the explicitly selected image; no broad library scan.
  const selected = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    allowsEditing: false,
    exif: false,
    quality: 1,
  });
  if (selected.canceled || !isCurrent()) return null;
  const image = selected.assets[0];
  if (!image) return null;
  const context = ImageManipulator.manipulate(image.uri);
  let rendered: ImageRef | undefined;
  let savedUri: string | undefined;
  try {
    const crop = avatarCrop(image.width, image.height);
    context
      .crop(crop)
      .resize({ width: Math.min(512, crop.width), height: Math.min(512, crop.height) });
    rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
    savedUri = saved.uri;
    const buffer =
      Platform.OS === 'web'
        ? await (await fetch(saved.uri)).arrayBuffer()
        : await new File(saved.uri).arrayBuffer();
    const bytes = stripJpegMetadata(new Uint8Array(buffer));
    if (bytes.length > 1048576) throw new Error('Choose a smaller photo.');
    if (!isCurrent()) return null;
    return { bytes, uri: jpegDataUri(bytes) };
  } finally {
    rendered?.release();
    context.release();
    if (Platform.OS !== 'web' && savedUri) {
      const file = new File(savedUri);
      if (file.exists) file.delete();
    }
  }
}
