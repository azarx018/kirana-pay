import { Controller, Delete, Get, Param, Post, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { AuthContext } from '../auth/auth.types';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { SessionGuard } from '../auth/session.guard';
import type { PaymentLinkView } from './payment-link.view';
import { PaymentLinksService } from './payment-links.service';

/**
 * Merchant-facing management. Session only: API keys are out of scope for V3 and the
 * audit trail needs a real user. Ownership always comes from the session, never the body.
 */
@ApiTags('payment-links')
@Controller('v1/invoices')
@UseGuards(SessionGuard)
export class PaymentLinksController {
  constructor(private readonly links: PaymentLinksService) {}

  @Post(':id/payment-link')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create (or return) the active public payment link of an invoice' })
  async create(
    @CurrentAuth() ctx: AuthContext,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: true; data: { created: boolean; link: PaymentLinkView } }> {
    const data = await this.links.create(ctx, id);
    res.status(data.created ? 201 : 200);
    return { success: true, data };
  }

  @Get(':id/payment-link')
  @ApiOperation({ summary: 'Latest payment link of an invoice (link is null if none was ever created)' })
  async get(
    @CurrentAuth() ctx: AuthContext,
    @Param('id') id: string,
  ): Promise<{ success: true; data: { link: PaymentLinkView | null } }> {
    return { success: true, data: await this.links.get(ctx, id) };
  }

  @Delete(':id/payment-link')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Permanently revoke the active payment link of an invoice' })
  async revoke(
    @CurrentAuth() ctx: AuthContext,
    @Param('id') id: string,
  ): Promise<{ success: true; data: { link: PaymentLinkView } }> {
    return { success: true, data: await this.links.revoke(ctx, id) };
  }
}
