import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ConvertQrDto } from './dto/convert-qr.dto';
import { QrService, type ConvertResult } from './qr.service';

@ApiTags('qr')
@Controller('v1/qr')
export class QrController {
  constructor(private readonly qr: QrService) {}

  @Post('convert')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: Number(process.env.MAX_UPLOAD_BYTES ?? 5 * 1024 * 1024) },
      fileFilter: (_req, file, cb) => {
        if (!/^image\/(png|jpe?g)$/.test(file.mimetype)) {
          cb(new BadRequestException({ code: 'INVALID_FILE_TYPE', message: 'Only PNG or JPEG images are accepted.' }), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'amount'],
      properties: {
        file: { type: 'string', format: 'binary' },
        amount: { type: 'integer', example: 2300 },
        note: { type: 'string', nullable: true, example: 'INV-001' },
      },
    },
  })
  @ApiOperation({ summary: 'Convert a static QRIS image into an amount-specific QR' })
  async convert(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: ConvertQrDto,
  ): Promise<{ success: true; data: ConvertResult }> {
    const data = await this.qr.convert(file, dto.amount, dto.note);
    return { success: true, data };
  }

  @Get()
  @ApiOperation({ summary: 'List recent QR jobs (metadata only)' })
  async findAll(@Query('limit') limit?: string): Promise<{
    success: true;
    data: Array<{
      id: string;
      status: string;
      amount: number;
      currency: string;
      merchant: { nmid: string; name: string };
      createdAt: string;
    }>;
  }> {
    const take = Math.min(Math.max(Number(limit ?? 10) || 10, 1), 50);
    const rows = await this.qr.findAll(take);
    return {
      success: true,
      data: rows.map((job) => ({
        id: job.id,
        status: job.status,
        amount: Number(job.amount),
        currency: job.currency,
        merchant: { nmid: job.nmid, name: job.merchantName },
        createdAt: job.createdAt.toISOString(),
      })),
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read processing metadata for a generated QR' })
  async findOne(@Param('id', new ParseUUIDPipe()) id: string): Promise<{
    success: true;
    data: {
      id: string;
      status: string;
      amount: number;
      currency: string;
      merchant: { nmid: string; name: string };
      createdAt: string;
    };
  }> {
    const job = await this.qr.findOne(id);
    return {
      success: true,
      data: {
        id: job.id,
        status: job.status,
        amount: Number(job.amount),
        currency: job.currency,
        merchant: { nmid: job.nmid, name: job.merchantName },
        createdAt: job.createdAt.toISOString(),
      },
    };
  }
}
