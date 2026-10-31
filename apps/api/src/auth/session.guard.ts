import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import type { AuthContext } from './auth.types';
import { SESSION_COOKIE } from './tokens';

/** Resolves the merchant context from the httpOnly session cookie. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { auth?: AuthContext }>();
    const ctx = await this.auth.resolveSession(req.cookies?.[SESSION_COOKIE]);
    if (!ctx) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Login required.' });
    }
    req.auth = ctx;
    return true;
  }
}
