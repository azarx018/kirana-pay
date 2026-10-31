import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthContext } from '../auth/auth.types';
import { MerchantQris } from '../entities/merchant-qris.entity';
import { FILE_STORAGE, type FileStorage } from '../storage/storage.interface';
import { parseAmount } from './amount.util';
import { sniffImageType } from './image-signature';
import { QrEngineClient, QrEngineError } from './qr-engine.client';
import { QrJob } from './qr-job.entity';

export interface ConvertResult {
  id: string;
  status: string;
  amount: number;
  currency: string;
  merchant: { nmid: string; name: string };
  qrImage: { mimeType: string; data: string };
}

@Injectable()
export class QrService {
  private readonly maxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES ?? 5 * 1024 * 1024);
  private readonly minAmount = Number(process.env.MIN_AMOUNT ?? 1);
  private readonly maxAmount = Number(process.env.MAX_AMOUNT ?? 100_000_000);

  constructor(
    private readonly engine: QrEngineClient,
    @InjectRepository(QrJob) private readonly jobs: Repository<QrJob>,
    @InjectRepository(MerchantQris) private readonly qris: Repository<MerchantQris>,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  async convert(
    ctx: AuthContext,
    input: { file?: Express.Multer.File; qrisId?: string; amount: unknown; note?: string },
  ): Promise<ConvertResult> {
    let image: Buffer;

    if (input.qrisId) {
      const record = await this.qris.findOne({ where: { id: input.qrisId, merchantId: ctx.merchantId } });
      if (!record) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'QRIS not found.' });
      }
      if (record.status !== 'ACTIVE') {
        throw new BadRequestException({ code: 'QRIS_ARCHIVED', message: 'QRIS is archived.' });
      }
      image = await this.storage.read(record.imagePath);
    } else {
      image = this.validateUpload(input.file);
    }

    let amount: number;
    try {
      amount = parseAmount(input.amount, { min: this.minAmount, max: this.maxAmount });
    } catch (error) {
      throw new BadRequestException({ code: 'INVALID_AMOUNT', message: (error as Error).message });
    }

    let result;
    try {
      result = await this.engine.convert(image.toString('base64'), amount, input.note);
    } catch (error) {
      const engineError = error as QrEngineError;
      throw new BadRequestException({
        code: engineError.code ?? 'QR_ENGINE_UNAVAILABLE',
        message: engineError.message,
      });
    }

    const png = Buffer.from(result.qrPngBase64, 'base64');
    const id = randomUUID();
    const qrPath = await this.storage.save(`out/${ctx.merchantId}/${id}.png`, png, 'image/png');

    await this.jobs.save(
      this.jobs.create({
        id,
        status: 'generated',
        amount: String(amount),
        currency: 'IDR',
        nmid: result.meta.nmid,
        merchantName: result.meta.merchantName,
        payloadSha256: createHash('sha256').update(result.payload).digest('hex'),
        qrPath,
        merchantId: ctx.merchantId,
        qrisId: input.qrisId ?? null,
      }),
    );

    return {
      id,
      status: 'generated',
      amount,
      currency: 'IDR',
      merchant: { nmid: result.meta.nmid, name: result.meta.merchantName },
      qrImage: { mimeType: 'image/png', data: result.qrPngBase64 },
    };
  }

  async findAll(merchantId: string, limit = 10): Promise<QrJob[]> {
    return this.jobs.find({ where: { merchantId }, order: { createdAt: 'DESC' }, take: limit });
  }

  async findOne(merchantId: string, id: string): Promise<QrJob> {
    const job = await this.jobs.findOne({ where: { id, merchantId } });
    if (!job) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'QR job not found.' });
    }
    return job;
  }

  async readOutput(merchantId: string, id: string): Promise<{ buffer: Buffer; path: string }> {
    const job = await this.findOne(merchantId, id);
    const buffer = await this.storage.read(job.qrPath);
    return { buffer, path: job.qrPath };
  }

  private validateUpload(file: Express.Multer.File | undefined): Buffer {
    if (!file) {
      throw new BadRequestException({ code: 'INVALID_FILE_TYPE', message: 'file or qrisId is required.' });
    }
    if (file.size === 0) {
      throw new BadRequestException({ code: 'INVALID_FILE_TYPE', message: 'file is empty.' });
    }
    if (file.size > this.maxUploadBytes) {
      throw new BadRequestException({ code: 'FILE_TOO_LARGE', message: 'file exceeds the size limit.' });
    }
    if (!sniffImageType(file.buffer)) {
      throw new BadRequestException({ code: 'INVALID_FILE_TYPE', message: 'Only PNG or JPEG images are accepted.' });
    }
    return file.buffer;
  }
}
