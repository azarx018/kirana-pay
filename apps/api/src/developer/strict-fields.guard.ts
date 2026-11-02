import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

export const STRICT_FIELDS_KEY = 'kirana:strict-fields';

export interface StrictFieldsOptions {
  body?: readonly string[];
  query?: readonly string[];
}

/**
 * Declares the ONLY fields a Developer API route accepts. Unknown fields are rejected with
 * 400, never silently dropped: a developer who sends `status: "PAID"` must be told it is not
 * a thing, not left believing it worked. (The global ValidationPipe uses `whitelist`, which
 * strips unknown fields BEFORE any route-level pipe could see them, so this is a guard.)
 */
export const StrictFields = (options: StrictFieldsOptions) => SetMetadata(STRICT_FIELDS_KEY, options);

function describe(names: string[]): string {
  const shown = names.slice(0, 5).map((n) => (n.length > 40 ? `${n.slice(0, 40)}…` : n));
  return shown.join(', ') + (names.length > 5 ? ', …' : '');
}

@Injectable()
export class StrictFieldsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.get<StrictFieldsOptions | undefined>(STRICT_FIELDS_KEY, context.getHandler());
    if (!options) return true;
    const req = context.switchToHttp().getRequest<Request>();

    if (options.body) {
      const body: unknown = req.body;
      if (body !== undefined && (body === null || typeof body !== 'object' || Array.isArray(body))) {
        throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Request body must be a JSON object.' });
      }
      this.reject(Object.keys((body as Record<string, unknown> | undefined) ?? {}), options.body, 'field');
    }
    if (options.query) {
      this.reject(Object.keys(req.query ?? {}), options.query, 'query parameter');
    }
    return true;
  }

  private reject(provided: string[], allowed: readonly string[], what: string): void {
    const unknown = provided.filter((key) => !allowed.includes(key));
    if (unknown.length > 0) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: `Unknown ${what}${unknown.length > 1 ? 's' : ''}: ${describe(unknown)}. Allowed: ${allowed.join(', ')}.`,
      });
    }
  }
}
