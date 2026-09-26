import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat, type ImageRef } from 'expo-image-manipulator';
import { Platform } from 'react-native';
import { jpegDataUri, stripJpegMetadata } from './jpeg';

export type PreparedPhoto = { uri: string; bytes: Uint8Array; source?: 'library' };
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const PHOTO_MAX_EDGE = 1600;
export function resizeDimensions(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    throw new Error('We couldn’t read this photo. Choose or take another.');
  const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
function directory(userId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error('Invalid photo account.');
  return new Directory(Paths.cache, 'langtify-photos', userId);
}
function draftFiles(userId: string, assignmentId: string): File[] {
  if (!/^[0-9a-f-]{36}$/i.test(assignmentId)) throw new Error('Invalid assignment.');
  const dir = directory(userId);
  return dir.exists
    ? dir
        .list()
        .filter(
          (entry): entry is File =>
            entry instanceof File &&
            entry.name.startsWith(`${assignmentId}-`) &&
            entry.name.endsWith('.jpg'),
        )
    : [];
}
export function removeDraft(userId: string, assignmentId: string, uri?: string) {
  if (Platform.OS === 'web') return;
  for (const file of draftFiles(userId, assignmentId))
    if ((!uri || file.uri === uri) && file.exists) file.delete();
}
export async function loadDraft(
  userId: string,
  assignmentId: string,
): Promise<PreparedPhoto | null> {
  if (Platform.OS === 'web') return null;
  const dir = directory(userId);
  if (dir.exists)
    for (const entry of dir.list()) {
      if (entry instanceof File && (entry.modificationTime ?? 0) < Date.now() - 86400000)
        entry.delete();
    }
  const files = draftFiles(userId, assignmentId).sort(
    (a, b) => (b.modificationTime ?? 0) - (a.modificationTime ?? 0),
  );
  for (const file of files) {
    try {
      const bytes = stripJpegMetadata(new Uint8Array(await file.arrayBuffer()));
      if (bytes.length > PHOTO_MAX_BYTES) throw new Error('Invalid cached photo.');
      return file.name.startsWith(`${assignmentId}-library-`)
        ? { uri: file.uri, bytes, source: 'library' }
        : { uri: file.uri, bytes };
    } catch {
      file.delete();
    } // A killed write/cache eviction must still allow retaking.
  }
  return null;
}
export async function preparePhoto(
  image: { uri: string; width: number; height: number },
  userId: string,
  assignmentId: string,
  isCurrent: () => boolean = () => true,
  {
    removeSource = true,
    source,
  }: { removeSource?: boolean; source?: PreparedPhoto['source'] } = {},
): Promise<PreparedPhoto> {
  let context: ReturnType<typeof ImageManipulator.manipulate> | undefined;
  let savedUri: string | undefined;
  let oriented: ImageRef | undefined;
  let rendered: ImageRef | undefined;
  const requireCurrent = () => {
    if (!isCurrent()) throw new Error('Photo selection cancelled.');
  };
  try {
    requireCurrent();
    context = ImageManipulator.manipulate(image.uri);
    // The native decoder normalizes orientation before this first render. Picker
    // dimensions may describe the original EXIF orientation; using them here can
    // stretch portrait images. Resize the actual oriented pixels instead.
    oriented = await context.renderAsync();
    requireCurrent();
    context.resize(resizeDimensions(oriented.width, oriented.height));
    rendered = await context.renderAsync();
    requireCurrent();
    if (
      !Number.isFinite(rendered.width) ||
      !Number.isFinite(rendered.height) ||
      rendered.width > PHOTO_MAX_EDGE ||
      rendered.height > PHOTO_MAX_EDGE ||
      rendered.width <= 0 ||
      rendered.height <= 0
    )
      throw new Error('We couldn’t prepare this photo. Choose or take another.');
    const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
    savedUri = saved.uri;
    requireCurrent();
    const buffer =
      Platform.OS === 'web'
        ? await (await fetch(saved.uri)).arrayBuffer()
        : await new File(saved.uri).arrayBuffer();
    const bytes = stripJpegMetadata(new Uint8Array(buffer));
    if (bytes.length > PHOTO_MAX_BYTES)
      throw new Error('This photo is too large. Choose or take another.');
    requireCurrent();
    if (Platform.OS === 'web')
      return { uri: jpegDataUri(bytes), bytes, ...(source ? { source } : {}) };
    directory(userId).create({ intermediates: true, idempotent: true });
    const previous = draftFiles(userId, assignmentId);
    // A fresh URI prevents native image caches showing the previous retake.
    // This suffix is only a local cache identity, never an authorization token.
    const file = new File(
      directory(userId),
      `${assignmentId}-${source === 'library' ? 'library-' : ''}${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`,
    );
    file.create();
    file.write(bytes);
    for (const old of previous) old.delete();
    return { uri: file.uri, bytes, ...(source ? { source } : {}) };
  } finally {
    rendered?.release();
    oriented?.release();
    context?.release();
    if (Platform.OS !== 'web')
      // A library URI may refer to an original asset, not an app-owned camera
      // temporary file. Only dispose it when its caller owns that source.
      for (const uri of [removeSource ? image.uri : undefined, savedUri]) {
        if (uri) {
          const file = new File(uri);
          if (file.exists) file.delete();
        }
      }
  }
}
