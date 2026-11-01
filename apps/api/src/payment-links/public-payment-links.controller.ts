import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../common/public.decorator';
import type { PublicPaymentView } from './payment-link.view';
import { PaymentLinksService } from './payment-links.service';

/**
 * Anonymous, read-only customer view. There is deliberately no mutating route here:
 * opening, scanning or refreshing a link never changes an invoice.
 */
@ApiTags('public')
@Controller('v1/public/payment-links')
export class PublicPaymentLinksController {
  constructor(private readonly links: PaymentLinksService) {}

  @Public()
  @Get(':token')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Public payment page data for an opaque payment link token' })
  async resolve(
    @Param('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: true; data: PublicPaymentView }> {
    // Set before resolving so error responses are also uncacheable / unindexable.
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    return { success: true, data: await this.links.resolvePublic(token) };
  }
}
