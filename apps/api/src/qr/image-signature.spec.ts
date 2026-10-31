import { sniffImageType } from './image-signature';

describe('sniffImageType', () => {
  it('detects PNG magic bytes', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    expect(sniffImageType(png)).toBe('image/png');
  });

  it('detects JPEG magic bytes', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
    expect(sniffImageType(jpeg)).toBe('image/jpeg');
  });

  it('rejects anything else', () => {
    expect(sniffImageType(Buffer.from('GIF89a'))).toBeNull();
    expect(sniffImageType(Buffer.from('not an image'))).toBeNull();
  });
});
