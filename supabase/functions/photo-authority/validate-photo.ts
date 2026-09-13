import jpeg from 'jpeg-js';
import { stripJpegMetadata } from '../../../src/features/photos/jpeg.ts';

// Decode pixels on the trusted side; a MIME header or SOI/EOI signature is not proof.
// Reject metadata rather than rewriting an object after the owner reviewed it.
export function validatePhoto(bytes: Uint8Array) {
  if (bytes.length === 0 || bytes.length > 5 * 1024 * 1024) throw new Error('invalid_photo');
  const clean = stripJpegMetadata(bytes);
  if (clean.length !== bytes.length || clean.some((byte, i) => byte !== bytes[i]))
    throw new Error('invalid_photo');
  const decoded = jpeg.decode(bytes, {
    useTArray: true,
    tolerantDecoding: false,
    maxResolutionInMP: 2.56,
    maxMemoryUsageInMB: 64,
  });
  if (!decoded.width || !decoded.height || decoded.width > 1600 || decoded.height > 1600)
    throw new Error('invalid_photo');
  return { width: decoded.width, height: decoded.height };
}
