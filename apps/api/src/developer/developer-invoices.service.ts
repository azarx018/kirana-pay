import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { AuthContext } from '../auth/auth.types';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { OPERATION_INVOICE_CREATE, fingerprintInvoiceCreate } from '../idempotency/idempotency.util';
import { isPublicId } from '../invoices/invoice.util';
import type { CreateInvoiceDto } from '../invoices/dto/invoice.dto';
import { InvoicesService } from '../invoices/invoices.service';
import {
  decodeCursor,
  encodeCursor,
  toDeveloperInvoice,
  type DeveloperInvoice,
  type InvoiceLike,
} from './developer.view';

export interface DeveloperListQuery {
  status?: 'PENDING' | 'PAID' | 'EXPIRED';
  createdBefore?: string;
  createdAfter?: string;
  limit?: number;
  cursor?: string;
}

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;

/** Same answer for malformed, unknown and foreign references: no existence leak. */
export function assertReference(reference: string): void {
  if (!isPublicId(reference)) {
    throw new NotFoundException({ code: 'NOT_FOUND', message: 'Invoice not found.' });
  }
}

function parseInstant(value: string | undefined, field: string): string | null {
  if (value === undefined) return null;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) {
    throw new BadRequestException({ code: 'BAD_REQUEST', message: `${field} is not a valid ISO 8601 timestamp.` });
  }
  return at.toISOString();
}

interface ListRow extends InvoiceLike {
  cursorTs: string;
  id: string;
}

@Injectable()
export class DeveloperInvoicesService {
  private readonly logger = new Logger(DeveloperInvoicesService.name);

  constructor(
    private readonly invoices: InvoicesService,
    private readonly idempotency: IdempotencyService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Delegates ALL business rules to the V2 InvoicesService (amount, expiry, QRIS ownership,
   * engine, QR storage). With an Idempotency-Key the slot is claimed first and completed in
   * the same transaction as the invoice insert, so a retry can never create a second invoice.
   */
  async create(
    ctx: AuthContext,
    dto: CreateInvoiceDto,
    idempotencyKey: string | null,
  ): Promise<{ created: boolean; invoice: DeveloperInvoice }> {
    if (!idempotencyKey) {
      return { created: true, invoice: toDeveloperInvoice(await this.fromCreate(ctx, dto)) };
    }

    const started = await this.idempotency.begin(
      ctx.merchantId,
      OPERATION_INVOICE_CREATE,
      idempotencyKey,
      fingerprintInvoiceCreate(dto),
    );
    if (started.kind === 'replay') {
      const original = await this.invoices.findOwned(ctx.merchantId, started.invoiceId);
      return { created: false, invoice: toDeveloperInvoice(original) };
    }

    try {
      const view = await this.fromCreate(ctx, dto, started.recordId);
      return { created: true, invoice: toDeveloperInvoice(view) };
    } catch (error) {
      await this.idempotency.abandon(started.recordId).catch((cleanup: Error) => {
        this.logger.error(`Could not release idempotency slot ${started.recordId}: ${cleanup.message}`);
      });
      throw error;
    }
  }

  async get(ctx: AuthContext, reference: string): Promise<DeveloperInvoice> {
    assertReference(reference);
    await this.invoices.sweepExpired(ctx.merchantId);
    return toDeveloperInvoice(await this.invoices.findOwned(ctx.merchantId, reference));
  }

  /** Keyset pagination on (createdAt DESC, id DESC): stable, no skips or duplicates. */
  async list(
    ctx: AuthContext,
    query: DeveloperListQuery,
  ): Promise<{ items: DeveloperInvoice[]; nextCursor: string | null }> {
    const limit = Math.min(Math.max(Math.trunc(query.limit ?? DEFAULT_PAGE_SIZE), 1), MAX_PAGE_SIZE);
    const before = parseInstant(query.createdBefore, 'createdBefore');
    const after = parseInstant(query.createdAfter, 'createdAfter');

    let cursor = null;
    if (query.cursor !== undefined) {
      cursor = decodeCursor(query.cursor);
      if (!cursor) {
        throw new BadRequestException({ code: 'INVALID_CURSOR', message: 'cursor is not valid.' });
      }
    }

    await this.invoices.sweepExpired(ctx.merchantId);

    const params: unknown[] = [ctx.merchantId];
    const where: string[] = ['i."merchantId" = $1'];
    const add = (sql: string, value: unknown): void => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (query.status) add('i."status" = ?', query.status);
    if (before) add('i."createdAt" < ?::timestamptz', before);
    if (after) add('i."createdAt" > ?::timestamptz', after);
    if (cursor) {
      params.push(cursor.t, cursor.id);
      where.push(`(i."createdAt", i."id") < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
    }
    params.push(limit + 1);

    const rows = (await this.dataSource.query(
      `SELECT i."id", i."publicId", i."amount", i."currency", i."description", i."status",
              i."createdAt", i."expiresAt", i."paidAt",
              to_char(i."createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorTs"
         FROM "invoices" i
        WHERE ${where.join(' AND ')}
        ORDER BY i."createdAt" DESC, i."id" DESC
        LIMIT $${params.length}`,
      params,
    )) as ListRow[];

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      items: page.map(toDeveloperInvoice),
      nextCursor: hasMore && last ? encodeCursor({ t: last.cursorTs, id: last.id }) : null,
    };
  }

  private fromCreate(ctx: AuthContext, dto: CreateInvoiceDto, idempotencyRecordId?: string) {
    return this.invoices.create(
      ctx,
      dto,
      idempotencyRecordId
        ? {
            inTransaction: (manager, invoice) =>
              this.idempotency.completeInTransaction(manager, idempotencyRecordId, invoice.id),
          }
        : undefined,
    );
  }
}
