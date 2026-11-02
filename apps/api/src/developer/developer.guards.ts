import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthContext } from '../auth/auth.types';

/** The Developer API is server-to-server: a dashboard session cookie is not accepted. */
@Injectable()
export class RequireApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const auth = context.switchToHttp().getRequest<Request & { auth?: AuthContext }>().auth;
    if (auth?.via !== 'api-key') {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'An API key is required.' });
    }
    return true;
  }
}

/** Runs before body validation: a JSON endpoint must be called with a JSON content type. */
@Injectable()
export class JsonContentTypeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (!req.is('application/json')) {
      throw new UnsupportedMediaTypeException({
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Content-Type must be application/json.',
      });
    }
    return true;
  }
}
