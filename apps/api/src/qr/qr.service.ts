import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  async convert(file: Express.Multer.File | undefined, rawAmount: unknown, note?: string): Promise<ConvertResult> {
    if (!file) {
      throw new BadRequestException({ code: 'INVALID_FILE_TYPE', message: 'file is required.' });
    }
    if (file.size === 0) {
      throw new BadRequestException({ code: 'INVALID_FILE_TYPE', message: 'file is empty.' });
    }
    if (file.size > this.maxUploadBytes) {
      throw new BadRequestException({ code: 'FILE_TOO_LARGE', message: 'file exceeds the size limit.' });
    }

    const mimeType = sniffImageType(file.buffer);
    if (!mimeType) {
      throw new BadRequestException({
        code: 'INVALID_FILE_TYPE',
        message: 'Only PNG or JPEG images are accepted.',
      });
    }

    let amount: number;
    try {
      amount = parseAmount(rawAmount, { min: this.minAmount, max: this.maxAmount });
    } catch (error) {
      throw new BadRequestException({ code: 'INVALID_AMOUNT', message: (error as Error).message });
    }

    let result;
    try {
      result = await this.engine.convert(file.buffer.toString('base64'), amount, note);
    } catch (error) {
      const engineError = error as QrEngineError;
      throw new BadRequestException({
        code: engineError.code ?? 'QR_ENGINE_UNAVAILABLE',
        message: engineError.message,
      });
    }

    const png = Buffer.from(result.qrPngBase64, 'base64');
    const id = randomUUID();
    const key = `${id}.png`;
    const qrPath = await this.storage.save(key, png, 'image/png');

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

  async findAll(limit = 10): Promise<QrJob[]> {
    return this.jobs.find({ order: { createdAt: 'DESC' }, take: limit });
  }

  async findOne(id: string): Promise<QrJob> {
    const job = await this.jobs.findOne({ where: { id } });
    if (!job) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'QR job not found.' });
    }
    return job;
  }
}
