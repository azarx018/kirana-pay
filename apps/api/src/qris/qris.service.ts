import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { MerchantQris, QrisStatus } from '../entities/merchant-qris.entity';
import { PaymentProvider } from '../entities/payment-provider.entity';
import { sniffImageType } from '../qr/image-signature';
import { QrEngineClient, QrEngineError } from '../qr/qr-engine.client';
import { FILE_STORAGE, type FileStorage } from '../storage/storage.interface';

export interface QrisView {
  id: string;
  displayName: string;
  status: QrisStatus;
  provider: { code: string; name: string };
  nmid: string | null;
  merchantName: string | null;
  imageUrl: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class QrisService {
  private readonly maxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES ?? 5 * 1024 * 1024);

  constructor(
    @InjectRepository(MerchantQris) private readonly qris: Repository<MerchantQris>,
    @InjectRepository(PaymentProvider) private readonly providers: Repository<PaymentProvider>,
    private readonly engine: QrEngineClient,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  async create(
    merchantId: string,
    file: Express.Multer.File | undefined,
    providerCode: string,
    displayName: string,
  ): Promise<QrisView> {
    const { mime, buffer } = this.validateFile(file);
    const provider = await this.requireProvider(providerCode);
    const name = (displayName ?? '').trim();
    if (name.length < 1 || name.length > 80) {
      throw new BadRequestException({
        code: 'INVALID_DISPLAY_NAME',
        message: 'QR display name is required (max 80 characters).',
      });
    }

    const meta = await this.inspect(buffer);

    const id = randomUUID();
    const ext = mime === 'image/png' ? 'png' : 'jpg';
    const imagePath = await this.storage.save(`qris/${merchantId}/${id}.${ext}`, buffer, mime);

    const record = await this.qris.save(
      this.qris.create({
        id,
        merchantId,
        providerId: provider.id,
        displayName: name,
        imagePath,
        imageSha256: createHash('sha256').update(buffer).digest('hex'),
        status: 'ACTIVE',
        nmid: meta.nmid,
        merchantName: meta.merchantName,
      }),
    );

    return this.toView(record, provider);
  }

  async list(merchantId: string): Promise<QrisView[]> {
    const rows = await this.qris.find({
      where: { merchantId },
      order: { createdAt: 'DESC' },
    });
    const providers = await this.providerMap(rows.map((r) => r.providerId));
    return rows.map((r) => this.toView(r, providers.get(r.providerId)!));
  }

  async findOne(merchantId: string, id: string): Promise<MerchantQris> {
    const record = await this.qris.findOne({ where: { id, merchantId } });
    if (!record) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'QRIS not found.' });
    }
    return record;
  }

  async detail(merchantId: string, id: string): Promise<QrisView> {
    const record = await this.findOne(merchantId, id);
    const provider = await this.providers.findOneOrFail({ where: { id: record.providerId } });
    return this.toView(record, provider);
  }

  async readImage(merchantId: string, id: string): Promise<{ buffer: Buffer; path: string }> {
    const record = await this.findOne(merchantId, id);
    const buffer = await this.storage.read(record.imagePath);
    return { buffer, path: record.imagePath };
  }

  async replaceImage(merchantId: string, id: string, file: Express.Multer.File | undefined): Promise<QrisView> {
    const record = await this.findOne(merchantId, id);
    const { mime, buffer } = this.validateFile(file);
    const meta = await this.inspect(buffer);

    const ext = mime === 'image/png' ? 'png' : 'jpg';
    const imagePath = await this.storage.save(`qris/${merchantId}/${record.id}-${Date.now()}.${ext}`, buffer, mime);

    record.imagePath = imagePath;
    record.imageSha256 = createHash('sha256').update(buffer).digest('hex');
    record.nmid = meta.nmid;
    record.merchantName = meta.merchantName;
    await this.qris.save(record);

    const provider = await this.providers.findOneOrFail({ where: { id: record.providerId } });
    return this.toView(record, provider);
  }

  async archive(merchantId: string, id: string): Promise<void> {
    const record = await this.findOne(merchantId, id);
    record.status = 'ARCHIVED';
    await this.qris.save(record);
  }

  private validateFile(file: Express.Multer.File | undefined): { mime: 'image/png' | 'image/jpeg'; buffer: Buffer } {
    if (!file) {
      throw new BadRequestException({ code: 'INVALID_FILE_TYPE', message: 'file is required.' });
    }
    if (file.size === 0) {
      throw new BadRequestException({ code: 'INVALID_FILE_TYPE', message: 'file is empty.' });
    }
    if (file.size > this.maxUploadBytes) {
      throw new BadRequestException({ code: 'FILE_TOO_LARGE', message: 'file exceeds the size limit.' });
    }
    const mime = sniffImageType(file.buffer);
    if (!mime) {
      throw new BadRequestException({
        code: 'INVALID_FILE_TYPE',
        message: 'Only PNG or JPEG images are accepted.',
      });
    }
    return { mime, buffer: file.buffer };
  }

  private async inspect(buffer: Buffer): Promise<{ nmid: string; merchantName: string }> {
    try {
      const meta = await this.engine.inspect(buffer.toString('base64'));
      return { nmid: meta.nmid, merchantName: meta.merchantName };
    } catch (error) {
      const e = error as QrEngineError;
      const code = ['QR_NOT_READABLE', 'UNSUPPORTED_QR_FORMAT', 'QR_VALIDATION_FAILED'].includes(e.code)
        ? e.code
        : 'QR_VALIDATION_FAILED';
      throw new BadRequestException({ code, message: e.message });
    }
  }

  private async requireProvider(code: string): Promise<PaymentProvider> {
    const provider = await this.providers.findOne({ where: { code, isActive: true } });
    if (!provider) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_PROVIDER',
        message: `Provider '${code}' is not supported.`,
      });
    }
    return provider;
  }

  private async providerMap(ids: string[]): Promise<Map<string, PaymentProvider>> {
    const unique = [...new Set(ids)];
    const rows = unique.length ? await this.providers.find({ where: { id: In(unique) } }) : [];
    return new Map(rows.map((p) => [p.id, p]));
  }

  private toView(record: MerchantQris, provider: PaymentProvider): QrisView {
    return {
      id: record.id,
      displayName: record.displayName,
      status: record.status,
      provider: { code: provider.code, name: provider.name },
      nmid: record.nmid,
      merchantName: record.merchantName,
      imageUrl: `/v1/qris/${record.id}/image`,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
