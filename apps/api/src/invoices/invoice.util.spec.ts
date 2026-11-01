import {
  buildExpiresAt,
  buildPublicId,
  DEFAULT_EXPIRY_POLICY,
  encodePublicIdBody,
  isPublicId,
  InvoiceInputError,
  normalizeDescription,
  resolveExpiryMinutes,
} from './invoice.util';

const policy = { defaultMinutes: 60, minMinutes: 5, maxMinutes: 7 * 24 * 60 };

describe('invoice expiry policy', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');

  it('uses the default when no lifetime is requested', () => {
    expect(resolveExpiryMinutes(undefined, policy)).toBe(60);
    expect(buildExpiresAt(undefined, policy, now).toISOString()).toBe('2026-01-01T01:00:00.000Z');
  });

  it('accepts the exact boundaries', () => {
    expect(resolveExpiryMinutes(5, policy)).toBe(5);
    expect(resolveExpiryMinutes(7 * 24 * 60, policy)).toBe(7 * 24 * 60);
  });

  it('rejects below the minimum, above the maximum and decimals', () => {
    expect(() => resolveExpiryMinutes(4, policy)).toThrow(InvoiceInputError);
    expect(() => resolveExpiryMinutes(7 * 24 * 60 + 1, policy)).toThrow(InvoiceInputError);
    expect(() => resolveExpiryMinutes(1.5, policy)).toThrow(InvoiceInputError);
  });

  it('computes expiry from the supplied clock', () => {
    expect(buildExpiresAt(5, policy, now).getTime() - now.getTime()).toBe(5 * 60_000);
  });

  it('keeps the production defaults aligned with the documented policy', () => {
    expect(DEFAULT_EXPIRY_POLICY).toEqual({ defaultMinutes: 60, minMinutes: 5, maxMinutes: 10080 });
  });
});

describe('public invoice id', () => {
  it('is prefixed, fixed-length and uses the unambiguous alphabet', () => {
    const id = buildPublicId(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));
    expect(id).toMatch(/^INV-[0-9A-HJKMNP-TV-Z]{12}$/);
    expect(isPublicId(id)).toBe(true);
  });

  it('does not emit I, L, O or U', () => {
    for (let i = 0; i < 200; i += 1) {
      const body = encodePublicIdBody(Buffer.alloc(8, i));
      expect(body).toHaveLength(12);
      expect(body).not.toMatch(/[ILOU]/);
    }
  });

  it('is deterministic for the same random bytes and differs otherwise', () => {
    const a = buildPublicId(Buffer.from('0000000000000000', 'hex'));
    const b = buildPublicId(Buffer.from('0000000000000000', 'hex'));
    const c = buildPublicId(Buffer.from('ffffffffffffffff', 'hex'));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('rejects wrong entropy sizes instead of truncating silently', () => {
    expect(() => buildPublicId(Buffer.alloc(4))).toThrow();
  });

  it('does not accept arbitrary strings as public ids', () => {
    expect(isPublicId('INV-123')).toBe(false);
    expect(isPublicId('INV-IIIIIIIIIIII')).toBe(false);
  });
});

describe('description normalisation', () => {
  it('trims, collapses whitespace and turns blanks into null', () => {
    expect(normalizeDescription('  Kopi   susu  ')).toBe('Kopi susu');
    expect(normalizeDescription('   ')).toBeNull();
    expect(normalizeDescription(undefined)).toBeNull();
    expect(normalizeDescription(null)).toBeNull();
  });

  it('rejects anything longer than 200 characters', () => {
    expect(normalizeDescription('a'.repeat(200))).toHaveLength(200);
    expect(() => normalizeDescription('a'.repeat(201))).toThrow(InvoiceInputError);
  });
});
