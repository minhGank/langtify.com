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
  mockRender = jest.fn(),
  mockOrientedRelease = jest.fn(),
  mockRenderedRelease = jest.fn(),
  mockContextRelease = jest.fn();
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
      renderAsync: mockRender,
      release: mockContextRelease,
    }),
  },
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockRender.mockReset();
  mockSave.mockReset();
  mockFiles.clear();
  mockTimes.clear();
  mockRender.mockImplementation(async () => {
    const dimensions = mockResize.mock.lastCall?.[0];
    return dimensions
      ? { ...dimensions, saveAsync: mockSave, release: mockRenderedRelease }
      : {
          width: 4000,
          height: 3000,
          saveAsync: mockSave,
          release: mockOrientedRelease,
        };
  });
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
  expect(mockOrientedRelease).toHaveBeenCalledTimes(1);
  expect(mockRenderedRelease).toHaveBeenCalledTimes(1);
  expect(mockContextRelease).toHaveBeenCalledTimes(1);
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
  let current = true;
  mockSave.mockImplementation(async () => {
    current = false;
    return { uri: 'file:///normalized.jpg', width: 1600, height: 1200 };
  });
  await expect(
    preparePhoto(
      { uri: 'file:///camera.jpg', width: 16, height: 16 },
      photoUser,
      photoAssignment,
      () => current,
    ),
  ).rejects.toThrow('cancelled');
  expect(mockFiles.has(newer)).toBe(true);
  expect(mockFiles.has('file:///camera.jpg')).toBe(false);
  expect(mockFiles.has('file:///normalized.jpg')).toBe(false);
  removeDraft(photoUser, photoAssignment, 'file:///an-obsolete-draft.jpg');
  expect(mockFiles.has(newer)).toBe(true);
});

it('sizes library pixels after orientation normalization and never deletes the source asset', async () => {
  const jpeg = readFileSync(`${__dirname}/fixtures/photo.jpg`);
  mockFiles.set('file:///library-original.heic', jpeg);
  mockFiles.set('file:///normalized.jpg', jpeg);
  mockRender.mockResolvedValueOnce({
    width: 3000,
    height: 4000,
    saveAsync: mockSave,
    release: mockOrientedRelease,
  });
  const photo = await preparePhoto(
    // The native picker reports the stored landscape dimensions, but the image
    // has a portrait EXIF transform that the decoder has already applied.
    { uri: 'file:///library-original.heic', width: 4000, height: 3000 },
    photoUser,
    photoAssignment,
    () => true,
    { removeSource: false, source: 'library' },
  );
  expect(mockResize).toHaveBeenCalledWith({ width: 1200, height: 1600 });
  expect(mockSave).toHaveBeenCalledWith({ format: 'jpeg', compress: 0.8 });
  expect(mockFiles.get('file:///library-original.heic')).toEqual(jpeg);
  expect(mockFiles.has('file:///normalized.jpg')).toBe(false);
  expect(photo.source).toBe('library');
  expect(photo.uri).toContain(`${photoAssignment}-library-`);
  expect(await loadDraft(photoUser, photoAssignment)).toEqual(photo);
  expect(mockOrientedRelease).toHaveBeenCalledTimes(1);
  expect(mockRenderedRelease).toHaveBeenCalledTimes(1);
  expect(mockContextRelease).toHaveBeenCalledTimes(1);
});

it('strips location, EXIF, comments and trailing metadata before the library preview and draft are written', async () => {
  const jpeg = readFileSync(`${__dirname}/fixtures/photo.jpg`);
  const metadata = Array.from(new TextEncoder().encode('Exif GPS private location'));
  const annotated = Uint8Array.from([
    ...jpeg.slice(0, 2),
    255,
    225,
    0,
    metadata.length + 2,
    ...metadata,
    255,
    254,
    0,
    metadata.length + 2,
    ...metadata,
    ...jpeg.slice(2),
    ...metadata,
  ]);
  mockFiles.set('file:///library-original.jpg', annotated);
  mockFiles.set('file:///normalized.jpg', annotated);
  const photo = await preparePhoto(
    { uri: 'file:///library-original.jpg', width: 4000, height: 3000 },
    photoUser,
    photoAssignment,
    () => true,
    { removeSource: false },
  );
  expect(photo.bytes).toEqual(stripJpegMetadata(jpeg));
  expect(mockFiles.get(photo.uri)).toEqual(photo.bytes);
  expect(new TextDecoder().decode(mockFiles.get(photo.uri))).not.toContain('GPS');
  expect(mockFiles.get('file:///library-original.jpg')).toEqual(annotated);
});

it('cancellation while decoding a library photo releases native resources without replacing an existing draft', async () => {
  const jpeg = readFileSync(`${__dirname}/fixtures/photo.jpg`);
  const previous = `file:///cache/langtify-photos/${photoUser}/${photoAssignment}-previous.jpg`;
  mockFiles.set(previous, jpeg);
  mockFiles.set('file:///library-original.jpg', jpeg);
  let current = true;
  mockRender.mockImplementationOnce(async () => {
    current = false;
    return { width: 4000, height: 3000, release: mockOrientedRelease };
  });
  await expect(
    preparePhoto(
      { uri: 'file:///library-original.jpg', width: 4000, height: 3000 },
      photoUser,
      photoAssignment,
      () => current,
      { removeSource: false },
    ),
  ).rejects.toThrow('cancelled');
  expect(mockSave).not.toHaveBeenCalled();
  expect(mockFiles.get(previous)).toEqual(jpeg);
  expect(mockFiles.get('file:///library-original.jpg')).toEqual(jpeg);
  expect(mockOrientedRelease).toHaveBeenCalledTimes(1);
  expect(mockContextRelease).toHaveBeenCalledTimes(1);
});

it.each([0, NaN, Infinity])(
  'rejects invalid decoded dimensions %s before writing a draft',
  async (width) => {
    mockRender.mockResolvedValueOnce({ width, height: 4000, release: mockOrientedRelease });
    await expect(
      preparePhoto(
        { uri: 'file:///library-original.jpg', width: 4000, height: 3000 },
        photoUser,
        photoAssignment,
        () => true,
        { removeSource: false },
      ),
    ).rejects.toThrow('We couldn’t read this photo');
    expect(mockSave).not.toHaveBeenCalled();
    expect(await loadDraft(photoUser, photoAssignment)).toBeNull();
    expect(mockOrientedRelease).toHaveBeenCalledTimes(1);
    expect(mockContextRelease).toHaveBeenCalledTimes(1);
  },
);

it('failed resizing releases both render resources and never writes an oversized draft', async () => {
  mockRender.mockResolvedValueOnce({ width: 4000, height: 3000, release: mockOrientedRelease });
  mockRender.mockResolvedValueOnce({ width: 4000, height: 3000, release: mockRenderedRelease });
  await expect(
    preparePhoto(
      { uri: 'file:///library-original.jpg', width: 4000, height: 3000 },
      photoUser,
      photoAssignment,
      () => true,
      { removeSource: false },
    ),
  ).rejects.toThrow('We couldn’t prepare this photo');
  expect(mockSave).not.toHaveBeenCalled();
  expect(await loadDraft(photoUser, photoAssignment)).toBeNull();
  expect(mockOrientedRelease).toHaveBeenCalledTimes(1);
  expect(mockRenderedRelease).toHaveBeenCalledTimes(1);
  expect(mockContextRelease).toHaveBeenCalledTimes(1);
});
