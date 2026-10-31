import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Minimal MVP auth: a single development/service API key.
 * If API_KEY is empty the guard allows traffic (local development only) and the
 * bootstrap logs a warning, per docs/api.md.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const expected = process.env.API_KEY;
    if (!expected) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.header('x-api-key');
    if (!provided || provided !== expected) {
      throw new UnauthorizedException({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing or invalid API key.' },
      });
    }
    return true;
  }
}
