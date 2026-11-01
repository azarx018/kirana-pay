import { ForbiddenException } from '@nestjs/common';
import type { AuthContext } from '../auth/auth.types';
import { assertOwner } from './roles';

const ctx = (role: 'OWNER' | 'STAFF'): AuthContext => ({
  userId: 'u1',
  merchantId: 'm1',
  role,
  via: 'session',
  sessionId: 's1',
});

describe('assertOwner', () => {
  it('allows the owner', () => {
    expect(() => assertOwner(ctx('OWNER'))).not.toThrow();
  });
  it('blocks staff with 403', () => {
    expect(() => assertOwner(ctx('STAFF'))).toThrow(ForbiddenException);
  });
});
