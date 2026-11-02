import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthContext } from './auth.types';
import { RequireScopes, ScopeGuard } from './scope.guard';

class Sample {
  @RequireScopes('invoices:write')
  write(): void {}
  @RequireScopes('invoices:read', 'payment_links:read')
  both(): void {}
  open(): void {}
}

function ctxFor(handler: () => void, auth?: Partial<AuthContext>): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => Sample,
    switchToHttp: () => ({ getRequest: () => ({ auth }) }),
  } as unknown as ExecutionContext;
}

const keyAuth = (scopes: string[]): Partial<AuthContext> => ({ via: 'api-key', merchantId: 'm', scopes });
const guard = new ScopeGuard(new Reflector());

describe('ScopeGuard', () => {
  it('lets a key through only with every required scope', () => {
    expect(guard.canActivate(ctxFor(Sample.prototype.write, keyAuth(['invoices:write'])))).toBe(true);
    expect(guard.canActivate(ctxFor(Sample.prototype.both, keyAuth(['payment_links:read', 'invoices:read'])))).toBe(true);
    expect(() => guard.canActivate(ctxFor(Sample.prototype.both, keyAuth(['invoices:read'])))).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'INSUFFICIENT_SCOPE' }) }),
    );
  });

  it('answers 403 INSUFFICIENT_SCOPE, naming only the missing scope', () => {
    try {
      guard.canActivate(ctxFor(Sample.prototype.write, keyAuth(['invoices:read'])));
      throw new Error('should have thrown');
    } catch (e) {
      const err = e as { getStatus(): number; response: { code: string; message: string } };
      expect(err.getStatus()).toBe(403);
      expect(err.response.code).toBe('INSUFFICIENT_SCOPE');
      expect(err.response.message).toContain('invoices:write');
    }
  });

  it('treats a key without any scopes as having none (fail closed)', () => {
    expect(() => guard.canActivate(ctxFor(Sample.prototype.write, { via: 'api-key', merchantId: 'm' }))).toThrow();
    expect(() => guard.canActivate(ctxFor(Sample.prototype.write, keyAuth([])))).toThrow();
  });

  it('does not scope-limit dashboard sessions', () => {
    expect(guard.canActivate(ctxFor(Sample.prototype.write, { via: 'session', merchantId: 'm' }))).toBe(true);
  });

  it('is a no-op on routes without declared scopes', () => {
    expect(guard.canActivate(ctxFor(Sample.prototype.open, keyAuth([])))).toBe(true);
  });

  it('is unauthenticated (401) if it somehow runs before authentication', () => {
    expect(() => guard.canActivate(ctxFor(Sample.prototype.write, undefined))).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'UNAUTHORIZED' }) }),
    );
  });
});
