import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat, type ImageRef } from 'expo-image-manipulator';
import { Platform } from 'react-native';
import { jpegDataUri, stripJpegMetadata } from './jpeg';

export type PreparedPhoto = { uri: string; bytes: Uint8Array };
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const PHOTO_MAX_EDGE = 1600;
export function resizeDimensions(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    throw new Error('Invalid camera dimensions.');
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
      return { uri: file.uri, bytes };
    } catch {
      file.delete();
    } // A killed write/cache eviction must still allow retaking.
  }
  return null;
}
export async function preparePhoto(
  captured: { uri: string; width: number; height: number },
  userId: string,
  assignmentId: string,
  isCurrent: () => boolean = () => true,
): Promise<PreparedPhoto> {
  let context: ReturnType<typeof ImageManipulator.manipulate> | undefined;
  let savedUri: string | undefined;
  let rendered: ImageRef | undefined;
  try {
    context = ImageManipulator.manipulate(captured.uri);
    context.resize(resizeDimensions(captured.width, captured.height));
    rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
    savedUri = saved.uri;
    const buffer =
      Platform.OS === 'web'
        ? await (await fetch(saved.uri)).arrayBuffer()
        : await new File(saved.uri).arrayBuffer();
    const bytes = stripJpegMetadata(new Uint8Array(buffer));
    if (bytes.length > PHOTO_MAX_BYTES)
      throw new Error('The photo is too large. Please retake it.');
    if (!isCurrent()) throw new Error('Photo capture cancelled.');
    if (Platform.OS === 'web') return { uri: jpegDataUri(bytes), bytes };
    directory(userId).create({ intermediates: true, idempotent: true });
    const previous = draftFiles(userId, assignmentId);
    // A fresh URI prevents native image caches showing the previous retake.
    // This suffix is only a local cache identity, never an authorization token.
    const file = new File(
      directory(userId),
      `${assignmentId}-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`,
    );
    file.create();
    file.write(bytes);
    for (const old of previous) old.delete();
    return { uri: file.uri, bytes };
  } finally {
    rendered?.release();
    context?.release();
    if (Platform.OS !== 'web')
      for (const uri of [captured.uri, savedUri]) {
        if (uri) {
          const file = new File(uri);
          if (file.exists) file.delete();
        }
      }
  }
}
