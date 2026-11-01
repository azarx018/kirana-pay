import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { ApiKeyOrSessionGuard } from '../auth/api-key.guard';
import type { AuthContext } from '../auth/auth.types';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { SessionGuard } from '../auth/session.guard';
import { CreateInvoiceDto, ListInvoicesQueryDto } from './dto/invoice.dto';
import {
  InvoicesService,
  type InvoiceDetailView,
  type InvoiceListResult,
  type InvoiceView,
} from './invoices.service';

@ApiTags('invoices')
@Controller('v1/invoices')
@UseGuards(ApiKeyOrSessionGuard)
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Post()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create a PENDING invoice and its amount-specific QR (session or API key)' })
  async create(
    @CurrentAuth() ctx: AuthContext,
    @Body() dto: CreateInvoiceDto,
  ): Promise<{ success: true; data: InvoiceView }> {
    return { success: true, data: await this.invoices.create(ctx, dto) };
  }

  @Get()
  @ApiOperation({ summary: 'List the current merchant invoices (bounded pagination)' })
  async list(
    @CurrentAuth() ctx: AuthContext,
    @Query() query: ListInvoicesQueryDto,
  ): Promise<{ success: true; data: InvoiceListResult }> {
    return { success: true, data: await this.invoices.list(ctx, query) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Invoice detail by public id (or uuid), merchant scoped' })
  async detail(
    @CurrentAuth() ctx: AuthContext,
    @Param('id') id: string,
  ): Promise<{ success: true; data: InvoiceDetailView }> {
    return { success: true, data: await this.invoices.detail(ctx, id) };
  }

  @Get(':id/qr')
  @ApiOperation({ summary: 'Download the invoice QR image (merchant scoped)' })
  async readQr(
    @CurrentAuth() ctx: AuthContext,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer } = await this.invoices.readQr(ctx, id);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(buffer);
  }

  @Post(':id/confirm-payment')
  @UseGuards(SessionGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Manually mark a PENDING invoice as paid (session only; recorded with the acting user)',
  })
  async confirmPayment(
    @CurrentAuth() ctx: AuthContext,
    @Param('id') id: string,
  ): Promise<{ success: true; data: InvoiceDetailView }> {
    return { success: true, data: await this.invoices.confirmPayment(ctx, id) };
  }
}
