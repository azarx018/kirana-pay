import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

export interface ClientError {
  status: number;
  code: string;
  message: string;
}

/**
 * Errors raised by Express middleware (body-parser) before Nest routing are not
 * HttpExceptions, so they used to surface as 500. They are client mistakes: map them to
 * 4xx with FIXED messages (the library message can quote the offending request body).
 */
export function clientErrorOf(exception: unknown): ClientError | null {
  if (typeof exception !== 'object' || exception === null) return null;
  const e = exception as { status?: unknown; statusCode?: unknown; type?: unknown };
  const status = typeof e.status === 'number' ? e.status : typeof e.statusCode === 'number' ? e.statusCode : undefined;
  if (status === undefined || status < 400 || status > 499 || typeof e.type !== 'string') return null;
  switch (e.type) {
    case 'entity.too.large':
      return { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' };
    case 'entity.parse.failed':
      return { status: 400, code: 'BAD_REQUEST', message: 'Request body is not valid JSON.' };
    case 'encoding.unsupported':
    case 'charset.unsupported':
      return { status: 415, code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Unsupported content encoding.' };
    default:
      return { status, code: 'BAD_REQUEST', message: 'Invalid request.' };
  }
}

/**
 * Normalizes every error into the contract:
 * { success: false, error: { code, message } }
 * Stack traces and internal details are never returned to the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Unexpected error.';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === 'string') {
        message = payload;
        code = HttpStatus[status] ?? 'ERROR';
      } else if (typeof payload === 'object' && payload !== null) {
        const body = payload as Record<string, unknown>;
        const nested = body.error as { code?: string; message?: string } | undefined;
        if (nested?.code) {
          code = nested.code;
          message = nested.message ?? message;
        } else {
          const raw = body.message;
          message = Array.isArray(raw) ? raw.join('; ') : ((raw as string | undefined) ?? message);
          code = (body.code as string) ?? (HttpStatus[status] as string) ?? 'ERROR';
        }
      }
      if (status === HttpStatus.UNAUTHORIZED) {
        code = 'UNAUTHORIZED';
      }
      if (status === HttpStatus.TOO_MANY_REQUESTS) {
        code = 'RATE_LIMITED';
        message = 'Too many requests. Please retry later.';
      }
    } else {
      const client = clientErrorOf(exception);
      if (client) {
        ({ status, code, message } = client);
      } else {
        this.logger.error(exception instanceof Error ? exception.stack : String(exception));
      }
    }

    if (status >= 500) {
      code = 'INTERNAL_ERROR';
      message = 'Unexpected error.';
    }

    response.status(status).json({ success: false, error: { code, message } });
  }
}
