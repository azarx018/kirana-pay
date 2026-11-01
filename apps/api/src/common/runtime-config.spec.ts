import {
  assertProductionConfig,
  isCookieSecure,
  isSwaggerEnabled,
  parseTrustProxy,
} from './runtime-config';

const env = (v: Record<string, string>): NodeJS.ProcessEnv => v as NodeJS.ProcessEnv;

describe('isCookieSecure', () => {
  it('is secure by default in production, open in dev', () => {
    expect(isCookieSecure(env({ NODE_ENV: 'production' }))).toBe(true);
    expect(isCookieSecure(env({}))).toBe(false);
  });
  it('respects an explicit COOKIE_SECURE', () => {
    expect(isCookieSecure(env({ NODE_ENV: 'production', COOKIE_SECURE: 'false' }))).toBe(false);
    expect(isCookieSecure(env({ COOKIE_SECURE: 'true' }))).toBe(true);
  });
});

describe('isSwaggerEnabled', () => {
  it('is off in production unless opted in', () => {
    expect(isSwaggerEnabled(env({ NODE_ENV: 'production' }))).toBe(false);
    expect(isSwaggerEnabled(env({ NODE_ENV: 'production', ENABLE_SWAGGER: 'true' }))).toBe(true);
    expect(isSwaggerEnabled(env({}))).toBe(true);
  });
});

describe('parseTrustProxy', () => {
  it('parses hop counts and keywords', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('2')).toBe(2);
    expect(parseTrustProxy('loopback')).toBe('loopback');
  });
});

describe('assertProductionConfig', () => {
  it('ignores non-production', () => {
    expect(() => assertProductionConfig(env({}))).not.toThrow();
  });
  it('rejects a missing or default DB password in production', () => {
    expect(() => assertProductionConfig(env({ NODE_ENV: 'production' }))).toThrow(/DB_PASSWORD/);
    expect(() =>
      assertProductionConfig(env({ NODE_ENV: 'production', DB_PASSWORD: 'kirana' })),
    ).toThrow(/default/);
  });
  it('accepts a real password, or the explicit escape hatch', () => {
    expect(() =>
      assertProductionConfig(env({ NODE_ENV: 'production', DB_PASSWORD: 'x'.repeat(24) })),
    ).not.toThrow();
    expect(() =>
      assertProductionConfig(env({ NODE_ENV: 'production', ALLOW_INSECURE_DEFAULTS: 'true' })),
    ).not.toThrow();
  });
});
