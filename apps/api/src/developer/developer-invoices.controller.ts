import {
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
  Body,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiPropertyOptional, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { Response } from 'express';
import { ApiKeyOrSessionGuard } from '../auth/api-key.guard';
import type { AuthContext } from '../auth/auth.types';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { RequireScopes, ScopeGuard } from '../auth/scope.guard';
import { IdempotencyInputError, parseIdempotencyKey } from '../idempotency/idempotency.util';
import { CreateInvoiceDto } from '../invoices/dto/invoice.dto';
import { PaymentLinksService } from '../payment-links/payment-links.service';
import { JsonContentTypeGuard, RequireApiKeyGuard } from './developer.guards';
import { StrictFields, StrictFieldsGuard } from './strict-fields.guard';
import { DeveloperInvoicesService, MAX_PAGE_SIZE, assertReference } from './developer-invoices.service';
import {
  toDeveloperPaymentLink,
  type DeveloperInvoice,
  type DeveloperPaymentLink,
} from './developer.view';

class DeveloperListQueryDto {
  @ApiPropertyOptional({ enum: ['PENDING', 'PAID', 'EXPIRED'] })
  @IsOptional()
  @IsIn(['PENDING', 'PAID', 'EXPIRED'])
  status?: 'PENDING' | 'PAID' | 'EXPIRED';

  @ApiPropertyOptional({ description: 'ISO 8601; only invoices created strictly before this instant' })
  @IsOptional()
  @IsISO8601()
  createdBefore?: string;

  @ApiPropertyOptional({ description: 'ISO 8601; only invoices created strictly after this instant' })
  @IsOptional()
  @IsISO8601()
  createdAfter?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_SIZE, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;

  @ApiPropertyOptional({ description: 'Opaque `nextCursor` from the previous page' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;
}

export const INVOICE_CREATE_FIELDS = ['amount', 'description', 'qrisId', 'expiresInMinutes'] as const;
export const LIST_QUERY_FIELDS = ['status', 'createdBefore', 'createdAfter', 'limit', 'cursor'] as const;

/**
 * Developer API (server-to-server). Merchant identity comes only from the API key.
 * Business logic lives in the V2 / V3 services; nothing here can mark an invoice paid.
 */
@ApiTags('developer')
@ApiBearerAuth('bearer')
@ApiSecurity('x-api-key')
@Controller('v1/developer/invoices')
@UseGuards(ApiKeyOrSessionGuard, RequireApiKeyGuard, ScopeGuard, StrictFieldsGuard)
export class DeveloperInvoicesController {
  constructor(
    private readonly invoices: DeveloperInvoicesService,
    private readonly paymentLinks: PaymentLinksService,
  ) {}

  @Post()
  @UseGuards(JsonContentTypeGuard)
  @RequireScopes('invoices:write')
  @StrictFields({ body: INVOICE_CREATE_FIELDS })
  @Throttle({ default: { limit: 120, ttl: 60_000 }, apikey: { limit: 30, ttl: 60_000 } })
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: '8-128 chars; retries return the original invoice (24 h)' })
  @ApiOperation({ summary: 'Create a PENDING invoice (scope invoices:write)' })
  async create(
    @CurrentAuth() ctx: AuthContext,
    @Body() dto: CreateInvoiceDto,
    @Headers('idempotency-key') idempotencyHeader: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: true; data: DeveloperInvoice }> {
    let key: string | null;
    try {
      key = parseIdempotencyKey(idempotencyHeader);
    } catch (error) {
      if (error instanceof IdempotencyInputError) {
        throw new BadRequestException({ code: error.code, message: error.message });
      }
      throw error;
    }

    try {
      const result = await this.invoices.create(ctx, dto, key);
      if (!result.created) {
        res.status(200);
        res.setHeader('Idempotent-Replayed', 'true');
      }
      return { success: true, data: result.invoice };
    } catch (error) {
      if ((error as { response?: { code?: string } }).response?.code === 'IDEMPOTENCY_IN_PROGRESS') {
        res.setHeader('Retry-After', '1');
      }
      throw error;
    }
  }

  @Get()
  @RequireScopes('invoices:read')
  @StrictFields({ query: LIST_QUERY_FIELDS })
  @ApiOperation({ summary: 'List your invoices, newest first (scope invoices:read)' })
  async list(
    @CurrentAuth() ctx: AuthContext,
    @Query() query: DeveloperListQueryDto,
  ): Promise<{ success: true; data: { items: DeveloperInvoice[]; nextCursor: string | null } }> {
    return { success: true, data: await this.invoices.list(ctx, query) };
  }

  @Get(':reference')
  @RequireScopes('invoices:read')
  @ApiOperation({ summary: 'Retrieve one of your invoices by reference, e.g. INV-… (scope invoices:read)' })
  async get(
    @CurrentAuth() ctx: AuthContext,
    @Param('reference') reference: string,
  ): Promise<{ success: true; data: DeveloperInvoice }> {
    return { success: true, data: await this.invoices.get(ctx, reference) };
  }

  @Post(':reference/payment-link')
  @RequireScopes('payment_links:write')
  @Throttle({ default: { limit: 120, ttl: 60_000 }, apikey: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create or return the active payment link (scope payment_links:write)' })
  async createPaymentLink(
    @CurrentAuth() ctx: AuthContext,
    @Param('reference') reference: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: true; data: { created: boolean; link: DeveloperPaymentLink } }> {
    assertReference(reference);
    const result = await this.paymentLinks.create(ctx, reference);
    res.status(result.created ? 201 : 200);
    return { success: true, data: { created: result.created, link: toDeveloperPaymentLink(result.link) } };
  }

  @Get(':reference/payment-link')
  @RequireScopes('payment_links:read')
  @ApiOperation({ summary: 'Latest payment link of an invoice, or null (scope payment_links:read)' })
  async getPaymentLink(
    @CurrentAuth() ctx: AuthContext,
    @Param('reference') reference: string,
  ): Promise<{ success: true; data: { link: DeveloperPaymentLink | null } }> {
    assertReference(reference);
    const { link } = await this.paymentLinks.get(ctx, reference);
    return { success: true, data: { link: link ? toDeveloperPaymentLink(link) : null } };
  }
}
