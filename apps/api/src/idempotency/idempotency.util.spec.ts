import { fingerprintInvoiceCreate, hashIdempotencyKey, parseIdempotencyKey } from './idempotency.util';

describe('parseIdempotencyKey', () => {
  it('is null when the header is absent', () => {
    expect(parseIdempotencyKey(undefined)).toBeNull();
  });
  it('accepts 8-128 safe characters and trims whitespace', () => {
    expect(parseIdempotencyKey('order-2026_11.02:abc')).toBe('order-2026_11.02:abc');
    expect(parseIdempotencyKey('  12345678  ')).toBe('12345678');
    expect(parseIdempotencyKey('a'.repeat(128))).toHaveLength(128);
  });
  it.each(['', 'short', 'a'.repeat(129), 'has space inside', 'semi;colon1', 'comma,separated', 'üñíçødé123', 'a/b/c/d/e/f'])(
    'rejects %j instead of ignoring it',
    (value) => {
      expect(() => parseIdempotencyKey(value)).toThrow(/Idempotency-Key/);
    },
  );
  it('hashes the key (the raw key is never stored)', () => {
    expect(hashIdempotencyKey('order-12345678')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashIdempotencyKey('order-12345678')).not.toContain('order');
  });
});

describe('fingerprintInvoiceCreate', () => {
  const base = { amount: 25000, qrisId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', description: 'Kopi', expiresInMinutes: 30 };
  it('ignores formatting that does not change the request', () => {
    const a = fingerprintInvoiceCreate(base);
    expect(fingerprintInvoiceCreate({ ...base, amount: '25000' })).toBe(a);
    expect(fingerprintInvoiceCreate({ ...base, qrisId: base.qrisId.toLowerCase() })).toBe(a);
    expect(fingerprintInvoiceCreate({ ...base, description: '  Kopi  ' })).toBe(a);
  });
  it('treats an absent and a blank description the same', () => {
    expect(fingerprintInvoiceCreate({ ...base, description: undefined })).toBe(
      fingerprintInvoiceCreate({ ...base, description: '   ' }),
    );
  });
  it.each([
    ['amount', { amount: 25001 }],
    ['qris', { qrisId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }],
    ['description', { description: 'Teh' }],
    ['expiry', { expiresInMinutes: 31 }],
  ])('differs when %s differs', (_n, patch) => {
    expect(fingerprintInvoiceCreate({ ...base, ...patch })).not.toBe(fingerprintInvoiceCreate(base));
  });
});
