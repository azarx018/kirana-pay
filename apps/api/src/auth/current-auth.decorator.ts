import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthContext } from './auth.types';

export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const request = ctx.switchToHttp().getRequest<{ auth?: AuthContext }>();
    if (!request.auth) {
      throw new Error('CurrentAuth used without an auth guard');
    }
    return request.auth;
  },
);
