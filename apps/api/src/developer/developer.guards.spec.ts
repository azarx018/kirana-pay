import type { ExecutionContext } from '@nestjs/common';
import { JsonContentTypeGuard, RequireApiKeyGuard } from './developer.guards';

const ctx = (req: Record<string, unknown>) =>
  ({ switchToHttp: () => ({ getRequest: () => req }) }) as unknown as ExecutionContext;

describe('RequireApiKeyGuard', () => {
  const guard = new RequireApiKeyGuard();
  it('accepts API key callers only', () => {
    expect(guard.canActivate(ctx({ auth: { via: 'api-key' } }))).toBe(true);
    expect(() => guard.canActivate(ctx({ auth: { via: 'session' } }))).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'UNAUTHORIZED' }) }),
    );
    expect(() => guard.canActivate(ctx({}))).toThrow();
  });
});

describe('JsonContentTypeGuard', () => {
  const guard = new JsonContentTypeGuard();
  it('requires application/json', () => {
    expect(guard.canActivate(ctx({ is: () => 'application/json' }))).toBe(true);
    for (const result of [false, null]) {
      try {
        guard.canActivate(ctx({ is: () => result }));
        throw new Error('should have thrown');
      } catch (e) {
        const err = e as { getStatus(): number; response: { code: string } };
        expect(err.getStatus()).toBe(415);
        expect(err.response.code).toBe('UNSUPPORTED_MEDIA_TYPE');
      }
    }
  });
});
