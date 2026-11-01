import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

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
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    if (status >= 500) {
      code = 'INTERNAL_ERROR';
      message = 'Unexpected error.';
    }

    response.status(status).json({ success: false, error: { code, message } });
  }
}
