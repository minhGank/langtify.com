import { readFileSync } from 'node:fs';
import { stripJpegMetadata } from '@/features/photos/jpeg';
function segment(marker: number, payload: number[]) {
  return [255, marker, 0, payload.length + 2, ...payload];
}
it('strips EXIF/GPS, XMP, comments and trailing data from a real JPEG', () => {
  const original = readFileSync(`${__dirname}/fixtures/photo.jpg`);
  const metadata = Array.from(new TextEncoder().encode('Exif GPS Latitude private location'));
  const annotated = Uint8Array.from([
    ...original.slice(0, 2),
    ...segment(0xe1, metadata),
    ...segment(0xed, metadata),
    ...segment(0xfe, metadata),
    ...original.slice(2),
    ...metadata,
  ]);
  const clean = stripJpegMetadata(annotated);
  expect(new TextDecoder().decode(clean)).not.toContain('GPS');
  expect(clean).toEqual(stripJpegMetadata(original));
  expect(stripJpegMetadata(clean)).toEqual(clean);
});
it('preserves progressive scans, byte stuffing and restart markers while removing inter-scan metadata', () => {
  const first = [...segment(0xda, [1, 2]), 4, 255, 0, 6, 255, 0xd0, 7];
  const second = [...segment(0xda, [3, 4]), 8, 9];
  const image = [255, 216, ...first, ...segment(0xe1, [8, 8]), ...second, 255, 217];
  expect(stripJpegMetadata(Uint8Array.from(image))).toEqual(
    Uint8Array.from([255, 216, ...first, ...second, 255, 217]),
  );
});
it.each([
  [1, 2, 3],
  [255, 216, 255, 225, 0, 20, 1],
  [255, 216, 255, 217],
  [255, 216, 255, 218, 0, 2, 1],
])('rejects malformed/truncated camera output %#', (...input) => {
  expect(() => stripJpegMetadata(Uint8Array.from(input))).toThrow('We couldn’t read this photo');
});
