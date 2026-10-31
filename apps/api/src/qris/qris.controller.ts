import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthContext } from '../auth/auth.types';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { SessionGuard } from '../auth/session.guard';
import { QrisService, type QrisView } from './qris.service';

const uploadInterceptor = FileInterceptor('file', {
  limits: { fileSize: Number(process.env.MAX_UPLOAD_BYTES ?? 5 * 1024 * 1024) },
});

const uploadBody = {
  schema: {
    type: 'object',
    required: ['file', 'providerCode', 'displayName'],
    properties: {
      file: { type: 'string', format: 'binary' },
      providerCode: { type: 'string', example: 'DANA_BUSINESS' },
      displayName: { type: 'string', example: 'QR Toko Utama' },
    },
  },
};

@ApiTags('qris')
@Controller('v1/qris')
@UseGuards(SessionGuard)
export class QrisController {
  constructor(private readonly qris: QrisService) {}

  @Post()
  @UseInterceptors(uploadInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiBody(uploadBody)
  @ApiOperation({ summary: 'Upload a merchant-owned static QRIS with provider and display name' })
  async create(
    @CurrentAuth() ctx: AuthContext,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('providerCode') providerCode: string,
    @Body('displayName') displayName: string,
  ): Promise<{ success: true; data: QrisView }> {
    if (!providerCode) {
      throw new BadRequestException({ code: 'UNSUPPORTED_PROVIDER', message: 'providerCode is required.' });
    }
    return { success: true, data: await this.qris.create(ctx.merchantId, file, providerCode, displayName) };
  }

  @Get()
  @ApiOperation({ summary: 'List QRIS records for the current merchant' })
  async list(@CurrentAuth() ctx: AuthContext): Promise<{ success: true; data: QrisView[] }> {
    return { success: true, data: await this.qris.list(ctx.merchantId) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'QRIS detail (provider + display name)' })
  async detail(
    @CurrentAuth() ctx: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<{ success: true; data: QrisView }> {
    return { success: true, data: await this.qris.detail(ctx.merchantId, id) };
  }

  @Get(':id/image')
  @ApiOperation({ summary: 'Download the stored QRIS image (merchant scoped)' })
  async image(
    @CurrentAuth() ctx: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, path } = await this.qris.readImage(ctx.merchantId, id);
    res.setHeader('Content-Type', path.endsWith('.png') ? 'image/png' : 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(buffer);
  }

  @Put(':id/image')
  @UseInterceptors(uploadInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Replace a QRIS image (validated again by the QR engine)' })
  async replace(
    @CurrentAuth() ctx: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<{ success: true; data: QrisView }> {
    return { success: true, data: await this.qris.replaceImage(ctx.merchantId, id, file) };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Archive a QRIS (soft delete)' })
  async archive(
    @CurrentAuth() ctx: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<{ success: true }> {
    await this.qris.archive(ctx.merchantId, id);
    return { success: true };
  }
}
