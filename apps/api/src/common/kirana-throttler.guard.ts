import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { ThrottlerLimitDetail } from '@nestjs/throttler/dist/throttler.guard.interface';
import type { Response } from 'express';

/**
 * With several NAMED throttlers (per IP + per API key) @nestjs/throttler suffixes its
 * headers (`Retry-After-apikey`). Clients and SDKs look for the standard `Retry-After`,
 * so always send it, in whole seconds (>= 1), from whichever limit was hit.
 */
export function retryAfterSeconds(detail: { timeToExpire: number; timeToBlockExpire?: number; isBlocked?: boolean }): number {
  const seconds = detail.isBlocked && detail.timeToBlockExpire ? detail.timeToBlockExpire : detail.timeToExpire;
  return Math.max(1, Math.ceil(seconds || 0));
}

@Injectable()
export class KiranaThrottlerGuard extends ThrottlerGuard {
  protected override async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    context
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Retry-After', String(retryAfterSeconds(throttlerLimitDetail)));
    return super.throwThrottlingException(context, throttlerLimitDetail);
  }
}
