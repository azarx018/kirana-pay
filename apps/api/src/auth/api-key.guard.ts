import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import { ApiKey } from '../entities/api-key.entity';
import { AuthService } from './auth.service';
import type { AuthContext } from './auth.types';
import { SESSION_COOKIE, sha256 } from './tokens';

/**
 * Programmatic access: `x-api-key`, scoped to one merchant.
 * Also accepts a session cookie so the dashboard can reuse the same endpoint.
 */
@Injectable()
export class ApiKeyOrSessionGuard implements CanActivate {
  constructor(
    @InjectRepository(ApiKey) private readonly keys: Repository<ApiKey>,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { auth?: AuthContext }>();

    const raw = req.header('x-api-key');
    if (raw) {
      const key = await this.keys.findOne({ where: { keyHash: sha256(raw) } });
      if (!key || key.revokedAt) {
        throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Invalid or revoked API key.' });
      }
      void this.keys.update({ id: key.id }, { lastUsedAt: new Date() });
      req.auth = {
        userId: '',
        merchantId: key.merchantId,
        role: 'OWNER',
        via: 'api-key',
        apiKeyId: key.id,
      };
      return true;
    }

    const ctx = await this.auth.resolveSession(req.cookies?.[SESSION_COOKIE]);
    if (!ctx) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Login required.' });
    }
    req.auth = ctx;
    return true;
  }
}
