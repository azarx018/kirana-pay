import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { ApiKeyOrSessionGuard } from '../auth/api-key.guard';
import { AuthContext } from '../auth/auth.types';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { QrService, type ConvertResult } from './qr.service';

@ApiTags('qr')
@Controller('v1/qr')
@UseGuards(ApiKeyOrSessionGuard)
export class QrController {
  constructor(private readonly qr: QrService) {}

  @Post('convert')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: Number(process.env.MAX_UPLOAD_BYTES ?? 5 * 1024 * 1024) },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        qrisId: { type: 'string', format: 'uuid' },
        amount: { type: 'integer', example: 2300 },
        note: { type: 'string', nullable: true },
      },
    },
  })
  @ApiOperation({ summary: 'Convert a stored QRIS (qrisId) or an uploaded image into an amount-specific QR' })
  async convert(
    @CurrentAuth() ctx: AuthContext,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('qrisId') qrisId: string | undefined,
    @Body('amount') amount: string,
    @Body('note') note?: string,
  ): Promise<{ success: true; data: ConvertResult }> {
    if (!qrisId && !file) {
      throw new BadRequestException({ code: 'INVALID_FILE_TYPE', message: 'Provide qrisId or file.' });
    }
    const data = await this.qr.convert(ctx, { file, qrisId, amount, note });
    return { success: true, data };
  }

  @Get()
  @ApiOperation({ summary: 'List recent QR jobs for the current merchant' })
  async findAll(
    @CurrentAuth() ctx: AuthContext,
    @Query('limit') limit?: string,
  ): Promise<{ success: true; data: unknown[] }> {
    const take = Math.min(Math.max(Number(limit ?? 10) || 10, 1), 50);
    const rows = await this.qr.findAll(ctx.merchantId, take);
    return {
      success: true,
      data: rows.map((job) => ({
        id: job.id,
        status: job.status,
        amount: Number(job.amount),
        currency: job.currency,
        qrisId: job.qrisId,
        merchant: { nmid: job.nmid, name: job.merchantName },
        createdAt: job.createdAt.toISOString(),
      })),
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read processing metadata for a generated QR' })
  async findOne(
    @CurrentAuth() ctx: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<{ success: true; data: unknown }> {
    const job = await this.qr.findOne(ctx.merchantId, id);
    return {
      success: true,
      data: {
        id: job.id,
        status: job.status,
        amount: Number(job.amount),
        currency: job.currency,
        qrisId: job.qrisId,
        merchant: { nmid: job.nmid, name: job.merchantName },
        createdAt: job.createdAt.toISOString(),
      },
    };
  }

  @Get(':id/image')
  @ApiOperation({ summary: 'Download the generated QR image (merchant scoped)' })
  async image(
    @CurrentAuth() ctx: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer } = await this.qr.readOutput(ctx.merchantId, id);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(buffer);
  }
}
