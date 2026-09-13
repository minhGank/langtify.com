import { readFileSync } from 'node:fs';
import {
  loadDraft,
  preparePhoto,
  removeDraft,
  resizeDimensions,
} from '@/features/photos/photo-files';
import { stripJpegMetadata } from '@/features/photos/jpeg';
import { photoAssignment, photoUser } from './photo-fixtures';
const mockFiles = new Map<string, Uint8Array>();
const mockTimes = new Map<string, number>();
const mockResize = jest.fn(),
  mockSave = jest.fn(),
  mockRelease = jest.fn();
jest.mock('expo-file-system', () => {
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
    }
    get exists() {
      return true;
    }
    create() {}
    list() {
      return [...mockFiles.keys()]
        .filter((path) => path.startsWith(`${this.uri}/`))
        .map((path) => new File(path));
    }
  }
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
    }
    get name() {
      return this.uri.split('/').at(-1) ?? '';
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
    get modificationTime() {
      return mockTimes.get(this.uri) ?? Date.now();
    }
    create() {
      mockFiles.set(this.uri, new Uint8Array());
    }
    write(bytes: Uint8Array) {
      mockFiles.set(this.uri, bytes);
    }
    delete() {
      mockFiles.delete(this.uri);
    }
    async arrayBuffer() {
      return Uint8Array.from(mockFiles.get(this.uri) ?? []).buffer;
    }
  }
  return { Directory, File, Paths: { cache: 'file:///cache' } };
});
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: () => ({
      resize: mockResize,
      renderAsync: async () => ({ saveAsync: mockSave, release: mockRelease }),
      release: mockRelease,
    }),
  },
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockFiles.clear();
  mockTimes.clear();
  mockSave.mockResolvedValue({ uri: 'file:///normalized.jpg', width: 1600, height: 1200 });
});
it.each([
  [4000, 3000, 1600, 1200],
  [3000, 4000, 1200, 1600],
  [640, 480, 640, 480],
])('caps dimensions without upscaling %i x %i', (width, height, expectedWidth, expectedHeight) => {
  expect(resizeDimensions(width, height)).toEqual({ width: expectedWidth, height: expectedHeight });
});
it('re-encodes at JPEG quality 0.8, strips metadata, deletes raw/intermediate files, and restores only the owner draft', async () => {
  const jpeg = readFileSync(`${__dirname}/fixtures/photo.jpg`);
  mockFiles.set('file:///camera.jpg', jpeg);
  mockFiles.set('file:///normalized.jpg', jpeg);
  const photo = await preparePhoto(
    { uri: 'file:///camera.jpg', width: 4000, height: 3000 },
    photoUser,
    photoAssignment,
  );
  expect(mockResize).toHaveBeenCalledWith({ width: 1600, height: 1200 });
  expect(mockSave).toHaveBeenCalledWith({ format: 'jpeg', compress: 0.8 });
  expect(photo.bytes).toEqual(stripJpegMetadata(jpeg));
  expect(mockFiles.has('file:///camera.jpg')).toBe(false);
  expect(mockFiles.has('file:///normalized.jpg')).toBe(false);
  expect(await loadDraft(photoUser, photoAssignment)).toEqual(photo);
  expect(await loadDraft('45000000-0000-4000-8000-000000000099', photoAssignment)).toBeNull();
  removeDraft(photoUser, photoAssignment);
  expect(await loadDraft(photoUser, photoAssignment)).toBeNull();
});
it('removes partial cached writes and expired drafts so the user can retake', async () => {
  const partial = `file:///cache/langtify-photos/${photoUser}/${photoAssignment}-partial.jpg`;
  mockFiles.set(partial, new Uint8Array([255, 216, 1]));
  expect(await loadDraft(photoUser, photoAssignment)).toBeNull();
  expect(mockFiles.has(partial)).toBe(false);
  mockFiles.set(partial, readFileSync(`${__dirname}/fixtures/photo.jpg`));
  mockTimes.set(partial, Date.now() - 90000000);
  expect(await loadDraft(photoUser, photoAssignment)).toBeNull();
  expect(mockFiles.has(partial)).toBe(false);
});

it('cancelled preprocessing cannot overwrite or delete a newer draft', async () => {
  const jpeg = readFileSync(`${__dirname}/fixtures/photo.jpg`);
  const newer = `file:///cache/langtify-photos/${photoUser}/${photoAssignment}-newer.jpg`;
  mockFiles.set(newer, jpeg);
  mockFiles.set('file:///camera.jpg', jpeg);
  mockFiles.set('file:///normalized.jpg', jpeg);
  await expect(
    preparePhoto(
      { uri: 'file:///camera.jpg', width: 16, height: 16 },
      photoUser,
      photoAssignment,
      () => false,
    ),
  ).rejects.toThrow('cancelled');
  expect(mockFiles.has(newer)).toBe(true);
  expect(mockFiles.has('file:///camera.jpg')).toBe(false);
  expect(mockFiles.has('file:///normalized.jpg')).toBe(false);
  removeDraft(photoUser, photoAssignment, 'file:///an-obsolete-draft.jpg');
  expect(mockFiles.has(newer)).toBe(true);
});
