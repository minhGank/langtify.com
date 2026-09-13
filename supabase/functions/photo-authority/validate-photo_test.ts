import { validatePhoto } from './validate-photo.ts';
import { stripJpegMetadata } from '../../../src/features/photos/jpeg.ts';

const fixture = stripJpegMetadata(
  await Deno.readFile(new URL('../../../tests/fixtures/photo.jpg', import.meta.url)),
);
function rejects(bytes: Uint8Array) {
  try {
    validatePhoto(bytes);
  } catch {
    return;
  }
  throw new Error('Invalid image was accepted');
}
Deno.test('decodes a real normalized JPEG', () => {
  const result = validatePhoto(fixture);
  if (result.width !== 16 || result.height !== 16) throw new Error('Unexpected image dimensions');
});
Deno.test('rejects arbitrary bytes, signature-only fakes and truncated pixels', () => {
  rejects(new TextEncoder().encode('not an image'));
  rejects(new Uint8Array([255, 216, 255, 218, 0, 2, 1, 2, 3, 255, 217]));
  rejects(fixture.slice(0, fixture.length - 12));
});
Deno.test(
  'rejects EXIF, XMP, comments and trailing metadata instead of silently saving them',
  () => {
    for (const marker of [0xe1, 0xed, 0xfe]) {
      rejects(
        new Uint8Array([
          ...fixture.slice(0, 2),
          255,
          marker,
          0,
          6,
          71,
          80,
          83,
          0,
          ...fixture.slice(2),
        ]),
      );
    }
    rejects(new Uint8Array([...fixture, 71, 80, 83]));
  },
);
Deno.test('bounds compressed bytes and decoded memory/dimensions', () => {
  rejects(new Uint8Array(5242881));
  const giant = fixture.slice();
  for (let i = 0; i < giant.length - 10; i++) {
    if (giant[i] === 255 && [0xc0, 0xc1, 0xc2].includes(giant[i + 1])) {
      giant[i + 5] = 255;
      giant[i + 6] = 255;
      giant[i + 7] = 255;
      giant[i + 8] = 255;
      break;
    }
  }
  rejects(giant);
});
