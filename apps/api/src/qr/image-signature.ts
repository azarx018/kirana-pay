export type SupportedImage = 'image/png' | 'image/jpeg';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];

/** Sniff the real image type from magic bytes; never trust the client filename. */
export function sniffImageType(buffer: Buffer): SupportedImage | null {
  if (buffer.length >= 8 && PNG.every((b, i) => buffer[i] === b)) {
    return 'image/png';
  }
  if (buffer.length >= 3 && JPEG.every((b, i) => buffer[i] === b)) {
    return 'image/jpeg';
  }
  return null;
}
