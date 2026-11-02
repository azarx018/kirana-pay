import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthContext } from './auth.types';
import type { ApiKeyScope } from './scopes';

export const REQUIRED_SCOPES_KEY = 'kirana:required-scopes';

/** Declares the scopes an API key needs. Sessions (dashboard users) are not scope-limited. */
export const RequireScopes = (...scopes: ApiKeyScope[]) => SetMetadata(REQUIRED_SCOPES_KEY, scopes);

/**
 * Must run AFTER an authentication guard (`@UseGuards(ApiKeyOrSessionGuard, ScopeGuard)`),
 * so permission is decided before any business logic or database work.
 */
@Injectable()
export class ScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<ApiKeyScope[] | undefined>(REQUIRED_SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const auth = context.switchToHttp().getRequest<Request & { auth?: AuthContext }>().auth;
    if (!auth) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Login required.' });
    }
    if (auth.via !== 'api-key') return true;

    const granted = new Set(auth.scopes ?? []);
    const missing = required.filter((scope) => !granted.has(scope));
    if (missing.length > 0) {
      throw new ForbiddenException({
        code: 'INSUFFICIENT_SCOPE',
        message: `This API key is missing the required scope: ${missing.join(', ')}.`,
      });
    }
    return true;
  }
}
