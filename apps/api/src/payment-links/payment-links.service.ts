import {
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { AuthContext } from '../auth/auth.types';
import { InvoicesService } from '../invoices/invoices.service';
import { FILE_STORAGE, type FileStorage } from '../storage/storage.interface';
import { describePaymentLinkConfigProblems, resolvePaymentLinkSecret, resolvePublicBaseUrl } from './payment-link.config';
import { buildToken, newNonce, verifyToken } from './payment-link.token';
import {
  derivePublicState,
  toLinkView,
  toPublicView,
  type LinkRow,
  type PaymentLinkView,
  type PublicPaymentView,
  type PublicRow,
} from './payment-link.view';

interface LinkDbRow extends LinkRow {
  id: string;
}

const LINK_SELECT = `
  SELECT l."id", l."tokenNonce", l."status", l."createdAt", l."revokedAt",
         cu."email" AS "createdByEmail", ru."email" AS "revokedByEmail"
    FROM "payment_links" l
    LEFT JOIN "users" cu ON cu."id" = l."createdByUserId"
    LEFT JOIN "users" ru ON ru."id" = l."revokedByUserId"`;

const MAX_CREATE_ATTEMPTS = 3;

function unavailable(): NotFoundException {
  return new NotFoundException({
    code: 'PAYMENT_LINK_UNAVAILABLE',
    message: 'Payment link is unavailable.',
  });
}

/** TypeORM returns [rows, count] for UPDATE/DELETE and plain rows for SELECT/INSERT. */
function rowsOf<T>(result: unknown): T[] {
  if (!Array.isArray(result)) return [];
  if (result.length === 2 && Array.isArray(result[0]) && typeof result[1] === 'number') {
    return result[0] as T[];
  }
  return result as T[];
}

@Injectable()
export class PaymentLinksService {
  private readonly logger = new Logger(PaymentLinksService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly invoices: InvoicesService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {
    const problems = describePaymentLinkConfigProblems();
    if (problems.length > 0) {
      this.logger.warn(`Payment links are disabled until configured: ${problems.join(' ')}`);
    }
  }

  /** Create the active link for an owned invoice, or return the one that already exists. */
  async create(ctx: AuthContext, idOrPublicId: string): Promise<{ created: boolean; link: PaymentLinkView }> {
    this.requireConfig();
    await this.invoices.sweepExpired(ctx.merchantId);
    const invoice = await this.invoices.findOwned(ctx.merchantId, idOrPublicId);

    if (invoice.status === 'PAID') {
      throw new ConflictException({ code: 'INVOICE_ALREADY_PAID', message: 'Invoice is already paid.' });
    }
    if (invoice.status !== 'PENDING' || invoice.expiresAt.getTime() <= Date.now()) {
      throw new GoneException({ code: 'INVOICE_EXPIRED', message: 'Invoice has expired.' });
    }

    for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
      const active = await this.findActive(invoice.id);
      if (active) return { created: false, link: this.view(active) };

      // The partial unique index makes concurrent creators converge on ONE active row.
      const inserted = rowsOf<{ id: string }>(
        await this.dataSource.query(
          `INSERT INTO "payment_links" ("invoiceId", "tokenNonce", "createdByUserId")
           VALUES ($1, $2, $3)
           ON CONFLICT ("invoiceId") WHERE "status" = 'ACTIVE' DO NOTHING
           RETURNING "id"`,
          [invoice.id, newNonce(), ctx.userId || null],
        ),
      );
      if (inserted.length > 0) {
        const row = await this.findById(inserted[0].id);
        if (row) return { created: true, link: this.view(row) };
      }
    }
    throw new ConflictException({
      code: 'PAYMENT_LINK_CONFLICT',
      message: 'Could not create the payment link. Please retry.',
    });
  }

  /** Latest link for an owned invoice (active, otherwise the most recently revoked), or null. */
  async get(ctx: AuthContext, idOrPublicId: string): Promise<{ link: PaymentLinkView | null }> {
    const invoice = await this.invoices.findOwned(ctx.merchantId, idOrPublicId);
    const rows = await this.dataSource.query(
      `${LINK_SELECT} WHERE l."invoiceId" = $1 ORDER BY l."createdAt" DESC, l."id" DESC LIMIT 1`,
      [invoice.id],
    );
    const row = rowsOf<LinkDbRow>(rows)[0];
    return { link: row ? this.view(row) : null };
  }

  /** Permanently revoke the active link. The old token can never become valid again. */
  async revoke(ctx: AuthContext, idOrPublicId: string): Promise<{ link: PaymentLinkView }> {
    const invoice = await this.invoices.findOwned(ctx.merchantId, idOrPublicId);
    const revoked = rowsOf<{ id: string }>(
      await this.dataSource.query(
        `UPDATE "payment_links"
            SET "status" = 'REVOKED', "revokedAt" = now(), "revokedByUserId" = $2
          WHERE "invoiceId" = $1 AND "status" = 'ACTIVE'
        RETURNING "id"`,
        [invoice.id, ctx.userId || null],
      ),
    );
    if (revoked.length === 0) {
      throw new NotFoundException({
        code: 'PAYMENT_LINK_NOT_FOUND',
        message: 'There is no active payment link for this invoice.',
      });
    }
    const row = await this.findById(revoked[0].id);
    if (!row) throw unavailable();
    return { link: this.view(row) };
  }

  /**
   * Public, read-only resolution. Never writes (expiry is judged with the database clock
   * without persisting EXPIRED) and never distinguishes invalid / revoked / unknown tokens.
   */
  async resolvePublic(token: string): Promise<PublicPaymentView> {
    const secret = resolvePaymentLinkSecret();
    const nonce = secret ? verifyToken(secret, token) : null;
    if (!nonce) throw unavailable();

    const row = rowsOf<PublicRow & { qrPath: string | null; serverNow: Date }>(
      await this.dataSource.query(
        `SELECT l."status" AS "linkStatus", i."status" AS "invoiceStatus",
                (i."expiresAt" <= now()) AS "expired", now() AS "serverNow",
                m."name" AS "merchantName", i."publicId", i."description", i."amount",
                i."currency", i."createdAt", i."expiresAt", i."paidAt", i."qrPath"
           FROM "payment_links" l
           JOIN "invoices" i ON i."id" = l."invoiceId"
           JOIN "merchants" m ON m."id" = i."merchantId"
          WHERE l."tokenNonce" = $1`,
        [nonce],
      ),
    )[0];
    if (!row) throw unavailable();

    const state = derivePublicState(row);
    if (!state) throw unavailable();

    let qr: Buffer | null = null;
    if (state === 'PAYABLE') {
      qr = await this.readQr(row.qrPath, row.publicId);
    }
    return toPublicView(row, state, qr, row.serverNow);
  }

  private async readQr(qrPath: string | null, publicId: string): Promise<Buffer> {
    const fail = (): ServiceUnavailableException =>
      new ServiceUnavailableException({
        code: 'PAYMENT_LINK_QR_UNAVAILABLE',
        message: 'The payment QR is temporarily unavailable. Please try again.',
      });
    if (!qrPath) {
      this.logger.error(`Invoice ${publicId} has no stored QR path`);
      throw fail();
    }
    try {
      return await this.storage.read(qrPath);
    } catch (error) {
      this.logger.error(`QR read failed for invoice ${publicId}: ${error instanceof Error ? error.message : 'unknown'}`);
      throw fail();
    }
  }

  private async findActive(invoiceId: string): Promise<LinkDbRow | undefined> {
    const rows = await this.dataSource.query(`${LINK_SELECT} WHERE l."invoiceId" = $1 AND l."status" = 'ACTIVE'`, [
      invoiceId,
    ]);
    return rowsOf<LinkDbRow>(rows)[0];
  }

  private async findById(id: string): Promise<LinkDbRow | undefined> {
    const rows = await this.dataSource.query(`${LINK_SELECT} WHERE l."id" = $1`, [id]);
    return rowsOf<LinkDbRow>(rows)[0];
  }

  private view(row: LinkRow): PaymentLinkView {
    if (row.status !== 'ACTIVE') return toLinkView(row, null);
    const { secret, baseUrl } = this.requireConfig();
    return toLinkView(row, `${baseUrl}/pay/${buildToken(secret, row.tokenNonce)}`);
  }

  private requireConfig(): { secret: string; baseUrl: string } {
    const secret = resolvePaymentLinkSecret();
    const baseUrl = resolvePublicBaseUrl();
    if (!secret || !baseUrl) {
      throw new ServiceUnavailableException({
        code: 'PAYMENT_LINK_NOT_CONFIGURED',
        message: 'Payment links are not configured on this server.',
      });
    }
    return { secret, baseUrl };
  }
}
