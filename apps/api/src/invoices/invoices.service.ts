import {
  BadRequestException,
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DataSource, In, Repository } from 'typeorm';
import { AuthContext } from '../auth/auth.types';
import { InvoiceEvent, InvoiceEventType } from '../entities/invoice-event.entity';
import { Invoice, InvoiceStatus } from '../entities/invoice.entity';
import { MerchantQris } from '../entities/merchant-qris.entity';
import { PaymentProvider } from '../entities/payment-provider.entity';
import { User } from '../entities/user.entity';
import { parseAmount } from '../qr/amount.util';
import { QrEngineClient, QrEngineError } from '../qr/qr-engine.client';
import { FILE_STORAGE, type FileStorage } from '../storage/storage.interface';
import {
  buildExpiresAt,
  buildPublicId,
  DEFAULT_EXPIRY_POLICY,
  InvoiceInputError,
  normalizeDescription,
  resolveExpiryMinutes,
} from './invoice.util';
import type { CreateInvoiceDto, ListInvoicesQueryDto } from './dto/invoice.dto';

export interface InvoiceEventView {
  type: InvoiceEventType;
  actorEmail: string | null;
  createdAt: string;
}

export interface InvoiceView {
  id: string;
  publicId: string;
  amount: number;
  currency: string;
  description: string | null;
  status: InvoiceStatus;
  qris: { id: string; displayName: string; provider: { code: string; name: string } };
  createdAt: string;
  expiresAt: string;
  paidAt: string | null;
  confirmationMethod: string | null;
  confirmedBy: { email: string } | null;
  qrUrl: string | null;
}

export interface InvoiceDetailView extends InvoiceView {
  events: InvoiceEventView[];
}

export interface InvoiceListResult {
  items: InvoiceView[];
  nextCursor: string | null;
}

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);
  private readonly minAmount = Number(process.env.MIN_AMOUNT ?? 1);
  private readonly maxAmount = Number(process.env.MAX_AMOUNT ?? 100_000_000);
  private readonly expiryPolicy = {
    defaultMinutes: Number(
      process.env.INVOICE_DEFAULT_TTL_MINUTES ?? DEFAULT_EXPIRY_POLICY.defaultMinutes,
    ),
    minMinutes: Number(process.env.INVOICE_MIN_TTL_MINUTES ?? DEFAULT_EXPIRY_POLICY.minMinutes),
    maxMinutes: Number(process.env.INVOICE_MAX_TTL_MINUTES ?? DEFAULT_EXPIRY_POLICY.maxMinutes),
  };

  constructor(
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    @InjectRepository(InvoiceEvent) private readonly events: Repository<InvoiceEvent>,
    @InjectRepository(MerchantQris) private readonly qris: Repository<MerchantQris>,
    @InjectRepository(PaymentProvider) private readonly providers: Repository<PaymentProvider>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    private readonly engine: QrEngineClient,
    private readonly dataSource: DataSource,
  ) {}

  async create(ctx: AuthContext, dto: CreateInvoiceDto): Promise<InvoiceView> {
    let amount: number;
    try {
      amount = parseAmount(dto.amount, { min: this.minAmount, max: this.maxAmount });
    } catch (error) {
      throw new BadRequestException({ code: 'INVALID_AMOUNT', message: (error as Error).message });
    }

    let description: string | null;
    try {
      description = normalizeDescription(dto.description);
    } catch (error) {
      const e = error as InvoiceInputError;
      throw new BadRequestException({ code: e.code, message: e.message });
    }

    let expiresAt: Date;
    try {
      expiresAt = buildExpiresAt(dto.expiresInMinutes, this.expiryPolicy);
    } catch (error) {
      const e = error as InvoiceInputError;
      throw new BadRequestException({ code: e.code, message: e.message });
    }

    const qris = await this.qris.findOne({ where: { id: dto.qrisId, merchantId: ctx.merchantId } });
    if (!qris) {
      // Same response for "missing" and "someone else's": no existence leak.
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'QRIS not found.' });
    }
    if (qris.status !== 'ACTIVE') {
      throw new BadRequestException({ code: 'QRIS_ARCHIVED', message: 'QRIS is archived.' });
    }

    const image = await this.storage.read(qris.imagePath);

    let converted;
    try {
      converted = await this.engine.convert(image.toString('base64'), amount);
    } catch (error) {
      const e = error as QrEngineError;
      throw new BadRequestException({
        code: e.code ?? 'QR_ENGINE_UNAVAILABLE',
        message: e.message,
      });
    }

    const invoiceId = randomUUID();
    const publicId = await this.uniquePublicId();
    const png = Buffer.from(converted.qrPngBase64, 'base64');
    const qrPath = await this.storage.save(
      `invoices/${ctx.merchantId}/${invoiceId}.png`,
      png,
      'image/png',
    );

    const actorUserId = ctx.userId ? ctx.userId : null;

    try {
      await this.dataSource.transaction(async (manager) => {
        await manager.insert(Invoice, {
          id: invoiceId,
          publicId,
          merchantId: ctx.merchantId,
          qrisId: qris.id,
          amount: String(amount),
          currency: 'IDR',
          description,
          status: 'PENDING' as InvoiceStatus,
          qrPath,
          qrSha256: createHash('sha256').update(png).digest('hex'),
          expiresAt,
          paidAt: null,
          confirmedByUserId: null,
          confirmationMethod: null,
        });
        await manager.insert(InvoiceEvent, {
          invoiceId,
          type: 'CREATED' as InvoiceEventType,
          actorUserId,
          metadata: { amount, qrisId: qris.id, expiresAt: expiresAt.toISOString() },
        });
      });
    } catch (error) {
      // Never leave an orphan PNG behind when the row cannot be persisted.
      await this.storage.delete(qrPath).catch((cleanupError: Error) => {
        this.logger.error(`Failed to clean up orphan invoice QR ${qrPath}: ${cleanupError.message}`);
      });
      throw error;
    }

    const created = await this.invoices.findOneOrFail({ where: { id: invoiceId } });
    const view = await this.toViews([created]);
    return view[0];
  }

  async list(ctx: AuthContext, query: ListInvoicesQueryDto): Promise<InvoiceListResult> {
    await this.sweepExpired(ctx.merchantId);

    const limit = Math.min(Math.max(Number(query.limit ?? 20) || 20, 1), 50);
    const qb = this.invoices
      .createQueryBuilder('i')
      .where('i."merchantId" = :merchantId', { merchantId: ctx.merchantId });

    if (query.status) qb.andWhere('i."status" = :status', { status: query.status });
    if (query.qrisId) qb.andWhere('i."qrisId" = :qrisId', { qrisId: query.qrisId });
    if (query.before) {
      const before = new Date(query.before);
      if (Number.isNaN(before.getTime())) {
        throw new BadRequestException({ code: 'INVALID_CURSOR', message: 'before is not a valid date.' });
      }
      qb.andWhere('i."createdAt" < :before', { before });
    }

    const rows = await qb
      .orderBy('i."createdAt"', 'DESC')
      .addOrderBy('i."id"', 'DESC')
      .take(limit + 1)
      .getMany();

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const items = await this.toViews(page);

    return {
      items,
      nextCursor: hasMore ? page[page.length - 1].createdAt.toISOString() : null,
    };
  }

  async detail(ctx: AuthContext, idOrPublicId: string): Promise<InvoiceDetailView> {
    await this.sweepExpired(ctx.merchantId);
    const invoice = await this.findOwned(ctx.merchantId, idOrPublicId);
    const [view] = await this.toViews([invoice]);
    const events = await this.events.find({
      where: { invoiceId: invoice.id },
      order: { createdAt: 'ASC' },
      take: 50,
    });
    const actorIds = [...new Set(events.map((e) => e.actorUserId).filter((v): v is string => !!v))];
    const actors = actorIds.length ? await this.users.find({ where: { id: In(actorIds) } }) : [];
    const emailById = new Map(actors.map((u) => [u.id, u.email]));

    return {
      ...view,
      events: events.map((e) => ({
        type: e.type,
        actorEmail: e.actorUserId ? (emailById.get(e.actorUserId) ?? null) : null,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  async readQr(ctx: AuthContext, idOrPublicId: string): Promise<{ buffer: Buffer; path: string }> {
    const invoice = await this.findOwned(ctx.merchantId, idOrPublicId);
    if (!invoice.qrPath) {
      throw new NotFoundException({ code: 'QR_NOT_AVAILABLE', message: 'This invoice has no QR.' });
    }
    return { buffer: await this.storage.read(invoice.qrPath), path: invoice.qrPath };
  }

  /**
   * Manual merchant confirmation. This is the ONLY path to PAID and it is
   * deliberately not reachable with an API key (no user identity to audit).
   */
  async confirmPayment(ctx: AuthContext, idOrPublicId: string): Promise<InvoiceDetailView> {
    await this.sweepExpired(ctx.merchantId);
    const invoice = await this.findOwned(ctx.merchantId, idOrPublicId);

    if (invoice.status === 'PAID') {
      throw new ConflictException({
        code: 'INVOICE_ALREADY_PAID',
        message: 'Invoice was already marked as paid.',
      });
    }
    if (invoice.status === 'EXPIRED' || invoice.expiresAt.getTime() <= Date.now()) {
      throw new GoneException({ code: 'INVOICE_EXPIRED', message: 'Invoice has expired.' });
    }

    const confirmed = await this.dataSource.transaction(async (manager) => {
      const rows = rowsOf<{ id: string }>(await manager.query(
        `UPDATE "invoices"
            SET "status" = 'PAID',
                "paidAt" = now(),
                "updatedAt" = now(),
                "confirmedByUserId" = $2,
                "confirmationMethod" = 'MANUAL_MERCHANT'
          WHERE "id" = $1
            AND "merchantId" = $3
            AND "status" = 'PENDING'
            AND "expiresAt" > now()
          RETURNING "id"`,
        [invoice.id, ctx.userId, ctx.merchantId],
      ));
      if (rows.length === 0) return false;

      await manager.query(
        `INSERT INTO "invoice_events" ("invoiceId", "type", "actorUserId", "metadata")
         VALUES ($1, 'PAYMENT_CONFIRMED', $2, $3)`,
        [invoice.id, ctx.userId, JSON.stringify({ method: 'MANUAL_MERCHANT' })],
      );
      return true;
    });

    if (!confirmed) {
      const fresh = await this.findOwned(ctx.merchantId, idOrPublicId);
      if (fresh.status === 'PAID') {
        throw new ConflictException({
          code: 'INVOICE_ALREADY_PAID',
          message: 'Invoice was already marked as paid.',
        });
      }
      throw new GoneException({ code: 'INVOICE_EXPIRED', message: 'Invoice has expired.' });
    }

    return this.detail(ctx, idOrPublicId);
  }

  /** Lazy, idempotent expiration: no scheduler/redis needed for this milestone. */
  async sweepExpired(merchantId: string): Promise<number> {
    const expired = rowsOf<{ id: string }>(
      await this.dataSource.query(
        `UPDATE "invoices"
          SET "status" = 'EXPIRED', "updatedAt" = now()
        WHERE "merchantId" = $1 AND "status" = 'PENDING' AND "expiresAt" <= now()
          RETURNING "id"`,
        [merchantId],
      ),
    );
    if (expired.length === 0) return 0;

    await this.events.insert(
      expired.map((row) => ({
        invoiceId: row.id,
        type: 'EXPIRED' as InvoiceEventType,
        actorUserId: null,
        metadata: null,
      })),
    );
    return expired.length;
  }

  async findOwned(merchantId: string, idOrPublicId: string): Promise<Invoice> {
    const invoice = await this.invoices.findOne({
      where: isUuid(idOrPublicId)
        ? { id: idOrPublicId, merchantId }
        : { publicId: idOrPublicId, merchantId },
    });
    if (!invoice) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Invoice not found.' });
    }
    return invoice;
  }

  private async uniquePublicId(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = buildPublicId(randomBytes(8));
      const exists = await this.invoices.exist({ where: { publicId: candidate } });
      if (!exists) return candidate;
    }
    throw new Error('Could not allocate a unique invoice public id');
  }

  private async toViews(rows: Invoice[]): Promise<InvoiceView[]> {
    if (rows.length === 0) return [];

    const qrisIds = [...new Set(rows.map((r) => r.qrisId))];
    const qrisRows = await this.qris.find({ where: { id: In(qrisIds) } });
    const providerIds = [...new Set(qrisRows.map((q) => q.providerId))];
    const providerRows = providerIds.length
      ? await this.providers.find({ where: { id: In(providerIds) } })
      : [];
    const providerById = new Map(providerRows.map((p) => [p.id, p]));
    const qrisById = new Map(qrisRows.map((q) => [q.id, q]));

    const confirmerIds = [
      ...new Set(rows.map((r) => r.confirmedByUserId).filter((v): v is string => !!v)),
    ];
    const confirmers = confirmerIds.length
      ? await this.users.find({ where: { id: In(confirmerIds) } })
      : [];
    const emailById = new Map(confirmers.map((u) => [u.id, u.email]));

    return rows.map((row) => {
      const qris = qrisById.get(row.qrisId);
      const provider = qris ? providerById.get(qris.providerId) : undefined;
      return {
        id: row.id,
        publicId: row.publicId,
        amount: Number(row.amount),
        currency: row.currency,
        description: row.description,
        status: row.status,
        qris: {
          id: row.qrisId,
          displayName: qris?.displayName ?? '(QRIS dihapus)',
          provider: { code: provider?.code ?? 'UNKNOWN', name: provider?.name ?? 'Unknown' },
        },
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        paidAt: row.paidAt ? row.paidAt.toISOString() : null,
        confirmationMethod: row.confirmationMethod,
        confirmedBy: row.confirmedByUserId
          ? { email: emailById.get(row.confirmedByUserId) ?? '(pengguna dihapus)' }
          : null,
        qrUrl: row.qrPath ? `/v1/invoices/${row.publicId}/qr` : null,
      };
    });
  }
}

/**
 * Postgres RETURNING results come back as rows, but some drivers wrap them as
 * [rows, affectedCount]. Normalise both shapes so ids are never dropped.
 */
function rowsOf<T>(result: unknown): T[] {
  if (!Array.isArray(result)) return [];
  if (
    result.length === 2 &&
    Array.isArray(result[0]) &&
    typeof result[1] === 'number'
  ) {
    return result[0] as T[];
  }
  return result as T[];
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export { resolveExpiryMinutes };
