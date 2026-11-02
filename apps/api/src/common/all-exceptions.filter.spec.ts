import type { ArgumentsHost } from '@nestjs/common';
import { ForbiddenException, HttpException, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { AllExceptionsFilter, clientErrorOf } from './all-exceptions.filter';

function run(exception: unknown) {
  let status = 0;
  let body: { success: boolean; error: { code: string; message: string } } | undefined;
  const res = {
    status(code: number) {
      status = code;
      return {
        json(payload: typeof body) {
          body = payload;
        },
      };
    },
  };
  new AllExceptionsFilter().catch(exception, { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost);
  return { status, body: body as NonNullable<typeof body> };
}

describe('AllExceptionsFilter', () => {
  it('keeps explicit error codes', () => {
    const { status, body } = run(new ForbiddenException({ code: 'INSUFFICIENT_SCOPE', message: 'nope' }));
    expect(status).toBe(403);
    expect(body).toEqual({ success: false, error: { code: 'INSUFFICIENT_SCOPE', message: 'nope' } });
  });

  it('forces UNAUTHORIZED for every 401', () => {
    expect(run(new UnauthorizedException({ code: 'WHATEVER', message: 'x' })).body.error.code).toBe('UNAUTHORIZED');
  });

  it('maps throttling to 429 RATE_LIMITED with a fixed message', () => {
    const { status, body } = run(new ThrottlerException());
    expect(status).toBe(429);
    expect(body.error).toEqual({ code: 'RATE_LIMITED', message: 'Too many requests. Please retry later.' });
  });

  it('masks 5xx details', () => {
    const { body } = run(new InternalServerErrorException('database password is hunter2'));
    expect(body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'Unexpected error.' });
  });

  it('answers an unknown error as a generic 500 without leaking it', () => {
    const { status, body } = run(new Error('secret stack detail'));
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('turns body-parser errors into 4xx instead of 500', () => {
    const tooLarge = Object.assign(new Error('request entity too large'), { status: 413, statusCode: 413, type: 'entity.too.large' });
    expect(run(tooLarge)).toMatchObject({ status: 413, body: { error: { code: 'PAYLOAD_TOO_LARGE' } } });
    const badJson = Object.assign(new SyntaxError(`Unexpected token 'x' in {"card":"4111"}`), {
      status: 400,
      statusCode: 400,
      type: 'entity.parse.failed',
    });
    const { status, body } = run(badJson);
    expect(status).toBe(400);
    expect(body.error).toEqual({ code: 'BAD_REQUEST', message: 'Request body is not valid JSON.' });
    expect(JSON.stringify(body)).not.toContain('4111'); // the library message can quote the body
  });

  it('only treats well-formed client errors as client errors', () => {
    expect(clientErrorOf(new Error('boom'))).toBeNull();
    expect(clientErrorOf({ status: 500, type: 'x' })).toBeNull();
    expect(clientErrorOf({ status: 413 })).toBeNull();
    expect(clientErrorOf('string')).toBeNull();
    expect(clientErrorOf(null)).toBeNull();
    expect(clientErrorOf(new HttpException('x', 400))).toBeNull();
  });
});
