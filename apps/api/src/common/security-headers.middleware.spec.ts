import type { Request, Response } from 'express';
import { securityHeaders } from './security-headers.middleware';

function run(env: Record<string, string>): Record<string, string> {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  const headers: Record<string, string> = {};
  const res = { setHeader: (k: string, v: string) => (headers[k] = v) } as unknown as Response;
  const next = jest.fn();
  try {
    securityHeaders({} as Request, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  } finally {
    process.env = saved;
  }
  return headers;
}

describe('securityHeaders', () => {
  it('always sets the basic hardening headers', () => {
    const h = run({ NODE_ENV: 'test', COOKIE_SECURE: 'false' });
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['X-Frame-Options']).toBe('DENY');
    expect(h['Strict-Transport-Security']).toBeUndefined();
  });
  it('adds HSTS only when running over HTTPS', () => {
    const h = run({ NODE_ENV: 'production' });
    expect(h['Strict-Transport-Security']).toContain('max-age=');
  });
});
