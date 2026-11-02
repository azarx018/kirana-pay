import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import { ApiKey } from '../entities/api-key.entity';
import { extractApiKeyCredential } from './api-key-credential';
import { AuthService } from './auth.service';
import type { AuthContext } from './auth.types';
import { SESSION_COOKIE, sha256 } from './tokens';

/** `last used` is informational: refresh at most this often instead of on every request. */
const LAST_USED_REFRESH = "interval '5 minutes'";

function invalidKey(): UnauthorizedException {
  // One generic message for missing/unknown/revoked/expired: no oracle for key state.
  return new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Invalid, revoked or expired API key.' });
}

/**
 * Programmatic access: `Authorization: Bearer <key>` or `x-api-key`, scoped to one merchant.
 * Also accepts a session cookie so the dashboard can reuse the same endpoint.
 * Lookup is by SHA-256 of the key (192-bit random secret); the secret itself is never
 * compared in application code and never logged.
 */
@Injectable()
export class ApiKeyOrSessionGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyOrSessionGuard.name);

  constructor(
    @InjectRepository(ApiKey) private readonly keys: Repository<ApiKey>,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { auth?: AuthContext }>();

    const credential = extractApiKeyCredential(req);
    if (credential.kind === 'invalid') throw invalidKey();

    if (credential.kind === 'key') {
      const key = await this.keys.findOne({ where: { keyHash: sha256(credential.key) } });
      if (!key || key.revokedAt || (key.expiresAt && key.expiresAt.getTime() <= Date.now())) {
        throw invalidKey();
      }
      this.touch(key.id);
      req.auth = {
        userId: '',
        merchantId: key.merchantId,
        role: 'OWNER',
        via: 'api-key',
        apiKeyId: key.id,
        scopes: key.scopes ?? [],
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

  private touch(id: string): void {
    void this.keys
      .query(
        `UPDATE "api_keys" SET "lastUsedAt" = now()
          WHERE "id" = $1 AND ("lastUsedAt" IS NULL OR "lastUsedAt" < now() - ${LAST_USED_REFRESH})`,
        [id],
      )
      .catch((error: Error) => this.logger.warn(`Could not refresh API key last-used time: ${error.message}`));
  }
}
