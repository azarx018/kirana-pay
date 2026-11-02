import {
  API_KEY_SCOPES,
  ApiKeyInputError,
  LEGACY_DEFAULT_SCOPES,
  MAX_KEY_LIFETIME_DAYS,
  isApiKeyScope,
  normalizeScopes,
  resolveKeyExpiry,
} from './scopes';

describe('api key scopes', () => {
  it('has no scope that could mark an invoice paid or confirm payments', () => {
    for (const scope of API_KEY_SCOPES) expect(scope).not.toMatch(/paid|confirm|payment:|status/i);
    expect(API_KEY_SCOPES).not.toContain('invoices:confirm');
  });

  it('keeps the legacy default to exactly what pre-V4 keys could do', () => {
    expect([...LEGACY_DEFAULT_SCOPES]).toEqual(['invoices:read', 'invoices:write', 'qr:convert']);
    for (const s of LEGACY_DEFAULT_SCOPES) expect(isApiKeyScope(s)).toBe(true);
  });

  it('normalizes: de-duplicates and orders canonically', () => {
    expect(normalizeScopes(['qr:convert', 'invoices:read', 'invoices:read'])).toEqual(['invoices:read', 'qr:convert']);
  });

  it.each([[[]], [undefined], [null], ['invoices:read'], [['nope']], [['invoices:read', 'admin']], [[1]], [[{}]]])(
    'rejects %j',
    (input) => {
      expect(() => normalizeScopes(input)).toThrow(ApiKeyInputError);
      try {
        normalizeScopes(input);
      } catch (e) {
        expect((e as ApiKeyInputError).code).toBe('INVALID_SCOPE');
      }
    },
  );

  describe('resolveKeyExpiry', () => {
    const now = new Date('2026-11-02T00:00:00Z');
    it('is optional', () => {
      expect(resolveKeyExpiry(undefined, now)).toBeNull();
      expect(resolveKeyExpiry(null, now)).toBeNull();
      expect(resolveKeyExpiry('', now)).toBeNull();
    });
    it('accepts a future date within the limit', () => {
      expect(resolveKeyExpiry('2026-12-01T00:00:00Z', now)?.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    });
    it.each(['2026-11-01T00:00:00Z', '2026-11-02T00:00:00Z', 'not-a-date', 12345, {}])('rejects %j', (value) => {
      expect(() => resolveKeyExpiry(value, now)).toThrow(ApiKeyInputError);
    });
    it('rejects an expiry beyond the maximum lifetime', () => {
      const far = new Date(now.getTime() + (MAX_KEY_LIFETIME_DAYS + 1) * 86_400_000).toISOString();
      expect(() => resolveKeyExpiry(far, now)).toThrow(/within/);
    });
  });
});
