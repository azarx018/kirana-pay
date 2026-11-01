import {
  describePaymentLinkConfigProblems,
  resolvePaymentLinkSecret,
  resolvePublicBaseUrl,
} from './payment-link.config';

const prod = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({ NODE_ENV: 'production', ...extra });
const dev = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({ NODE_ENV: 'development', ...extra });

describe('payment link config', () => {
  it('has a dev fallback secret/base URL outside production only', () => {
    expect(resolvePaymentLinkSecret(dev())).toBeTruthy();
    expect(resolvePublicBaseUrl(dev())).toBe('http://localhost:3100');
    expect(resolvePaymentLinkSecret(prod())).toBeNull();
    expect(resolvePublicBaseUrl(prod())).toBeNull();
  });

  it('rejects a short secret even in development', () => {
    expect(resolvePaymentLinkSecret(dev({ PAYMENT_LINK_SECRET: 'short' }))).toBeNull();
    expect(resolvePaymentLinkSecret(prod({ PAYMENT_LINK_SECRET: 'x'.repeat(32) }))).toBe('x'.repeat(32));
  });

  it('normalises a valid base URL and strips trailing slashes', () => {
    expect(resolvePublicBaseUrl(prod({ PUBLIC_BASE_URL: 'https://pay.example.com/' }))).toBe('https://pay.example.com');
    expect(resolvePublicBaseUrl(prod({ PUBLIC_BASE_URL: 'https://example.com/app//' }))).toBe('https://example.com/app');
    expect(resolvePublicBaseUrl(prod({ PUBLIC_BASE_URL: 'http://100.1.2.3:3100' }))).toBe('http://100.1.2.3:3100');
  });

  it.each([
    'javascript:alert(1)',
    'ftp://example.com',
    'not a url',
    'https://user:pw@example.com',
    'https://example.com/?x=1',
    'https://example.com/#frag',
  ])('rejects unsafe base URL %s', (value) => {
    expect(resolvePublicBaseUrl(prod({ PUBLIC_BASE_URL: value }))).toBeNull();
  });

  it('reports problems without echoing secret values', () => {
    const problems = describePaymentLinkConfigProblems(prod({ PAYMENT_LINK_SECRET: 'tiny-secret-value' }));
    expect(problems).toHaveLength(2);
    expect(problems.join(' ')).not.toContain('tiny-secret-value');
    expect(describePaymentLinkConfigProblems(dev())).toEqual([]);
  });
});
