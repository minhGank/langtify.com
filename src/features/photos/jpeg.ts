// Remove every JPEG APP segment (EXIF/XMP/IPTC/ICC/thumbnails) and comment.
// Preserve encoded pixels, including progressive scans, stuffing and restart markers.
// Trailing bytes after EOI are discarded. Malformed input fails closed.
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  const fail = () => {
    throw new Error('The image returned an invalid JPEG. Please choose or take another photo.');
  };
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return fail();
  const chunks: Uint8Array[] = [bytes.slice(0, 2)];
  let offset = 2,
    scan = false,
    sawScan = false;
  while (offset < bytes.length) {
    if (scan) {
      const start = offset;
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset++;
          continue;
        }
        const next = bytes[offset + 1];
        if (next === 0 || (next >= 0xd0 && next <= 0xd7)) {
          offset += 2;
          continue;
        }
        break;
      }
      chunks.push(bytes.slice(start, offset));
      scan = false;
    }
    const start = offset;
    if (bytes[offset++] !== 0xff) return fail();
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      if (!sawScan) return fail();
      chunks.push(new Uint8Array([0xff, 0xd9]));
      const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
      let position = 0;
      for (const chunk of chunks) {
        result.set(chunk, position);
        position += chunk.length;
      }
      return result;
    }
    if (
      marker === undefined ||
      marker === 0 ||
      marker === 0xd8 ||
      (marker >= 0xd0 && marker <= 0xd7)
    )
      return fail();
    const length = bytes[offset] * 256 + bytes[offset + 1];
    if (!Number.isInteger(length) || length < 2 || offset + length > bytes.length) return fail();
    offset += length;
    if (!(marker >= 0xe0 && marker <= 0xef) && marker !== 0xfe)
      chunks.push(bytes.slice(start, offset));
    if (marker === 0xda) {
      scan = true;
      sawScan = true;
    }
  }
  return fail();
}
export function jpegDataUri(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return `data:image/jpeg;base64,${btoa(binary)}`;
}
