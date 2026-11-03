import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, In, Repository } from 'typeorm';
import { assertOwner } from '../common/roles';
import type { AuthContext } from '../auth/auth.types';
import { WebhookEndpointAudit } from '../entities/webhook-endpoint-audit.entity';
import { WebhookEndpoint } from '../entities/webhook-endpoint.entity';
import { decryptSecret, encryptSecret, newSigningSecret } from './webhook-crypto';
import { WEBHOOK_CONFIG, type WebhookConfig } from './webhook.config';
import { WEBHOOK_EVENT_TYPES, isWebhookEventType, type EndpointStatus } from './webhook.constants';
import { validateWebhookUrl } from './webhook-url';

export interface EndpointView {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  status: EndpointStatus;
  secretHint: string | null;
  secretRotatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEndpointDto {
  url: string;
  description?: string;
  events?: string[];
}

export interface UpdateEndpointDto {
  url?: string;
  description?: string;
  events?: string[];
  status?: 'ACTIVE' | 'DISABLED';
}

export interface DeliveryView {
  id: string;
  eventId: string;
  type: string;
  status: string;
  attemptCount: number;
  nextAttemptAt: string;
  lastAttemptAt: string | null;
  lastHttpStatus: number | null;
  lastResultCategory: string | null;
  createdAt: string;
}

function view(endpoint: WebhookEndpoint): EndpointView {
  return {
    id: endpoint.id,
    url: endpoint.url,
    description: endpoint.description,
    events: endpoint.events,
    status: endpoint.status,
    secretHint: endpoint.secretHint,
    secretRotatedAt: endpoint.secretRotatedAt ? endpoint.secretRotatedAt.toISOString() : null,
    createdAt: endpoint.createdAt.toISOString(),
    updatedAt: endpoint.updatedAt.toISOString(),
  };
}

@Injectable()
export class WebhookEndpointsService {
  constructor(
    @InjectRepository(WebhookEndpoint) private readonly endpoints: Repository<WebhookEndpoint>,
    @InjectRepository(WebhookEndpointAudit) private readonly audit: Repository<WebhookEndpointAudit>,
    @Inject(WEBHOOK_CONFIG) private readonly config: WebhookConfig,
    private readonly dataSource: DataSource,
  ) {}

  private assertAvailable(): void {
    if (!this.config.encryptionKey) {
      throw new ServiceUnavailableException({
        code: 'WEBHOOKS_UNAVAILABLE',
        message: 'Webhooks are not configured on this server.',
      });
    }
  }

  private normalizeEvents(events: unknown): string[] {
    if (events === undefined) return [...WEBHOOK_EVENT_TYPES];
    if (!Array.isArray(events) || events.length === 0) {
      throw new BadRequestException({ code: 'INVALID_EVENTS', message: 'events must be a non-empty array.' });
    }
    const unique = [...new Set(events)];
    if (unique.length !== events.length || !unique.every(isWebhookEventType)) {
      throw new BadRequestException({
        code: 'INVALID_EVENTS',
        message: `events must be a subset of: ${WEBHOOK_EVENT_TYPES.join(', ')}.`,
      });
    }
    return unique as string[];
  }

  private checkedUrl(raw: string): { url: string; host: string } {
    const result = validateWebhookUrl(raw, this.config);
    if (!result.ok) {
      throw new BadRequestException({ code: result.code, message: result.message });
    }
    return { url: result.url, host: result.host };
  }

  async list(ctx: AuthContext): Promise<EndpointView[]> {
    this.assertAvailable();
    const rows = await this.endpoints.find({
      where: { merchantId: ctx.merchantId, status: In(['ACTIVE', 'DISABLED'] as EndpointStatus[]) },
      order: { createdAt: 'ASC' },
    });
    return rows.map(view);
  }

  async get(ctx: AuthContext, id: string): Promise<EndpointView> {
    return view(await this.findOwned(ctx.merchantId, id));
  }

  async create(ctx: AuthContext, dto: CreateEndpointDto): Promise<EndpointView & { secret: string }> {
    this.assertAvailable();
    assertOwner(ctx);
    const { url, host } = this.checkedUrl(dto.url);
    const events = this.normalizeEvents(dto.events);

    const active = await this.endpoints.count({
      where: { merchantId: ctx.merchantId, status: In(['ACTIVE', 'DISABLED'] as EndpointStatus[]) },
    });
    if (active >= this.config.maxEndpoints) {
      throw new ConflictException({
        code: 'ENDPOINT_LIMIT_REACHED',
        message: `At most ${this.config.maxEndpoints} webhook endpoints are allowed.`,
      });
    }

    // The ciphertext binds the endpoint id as AAD, so the id is generated before the row exists.
    const endpointId = randomUUID();
    const { secret, hint } = newSigningSecret();
    const ciphertext = encryptSecret(this.config.encryptionKey as Buffer, secret, endpointId);

    await this.dataSource.transaction(async (manager) => {
      await manager.insert(WebhookEndpoint, {
        id: endpointId,
        merchantId: ctx.merchantId,
        url,
        description: dto.description?.trim() ? dto.description.trim().slice(0, 120) : null,
        events,
        status: 'ACTIVE' as EndpointStatus,
        secretCiphertext: ciphertext,
        secretHint: hint,
        secretRotatedAt: null,
        createdByUserId: ctx.userId || null,
        updatedByUserId: ctx.userId || null,
      });
      await manager.query(
        `INSERT INTO "webhook_endpoint_audit" ("endpointId", "merchantId", "action", "actorUserId", "metadata")
         VALUES ($1, $2, 'CREATED', $3, $4)`,
        [endpointId, ctx.merchantId, ctx.userId || null, JSON.stringify({ host, events })],
      );
    });

    const created = await this.endpoints.findOneOrFail({ where: { id: endpointId } });
    return { ...view(created), secret };
  }

  async update(ctx: AuthContext, id: string, dto: UpdateEndpointDto): Promise<EndpointView> {
    this.assertAvailable();
    assertOwner(ctx);
    const endpoint = await this.findOwned(ctx.merchantId, id);
    if (endpoint.status === 'ARCHIVED') {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Endpoint not found.' });
    }

    const patch: Partial<WebhookEndpoint> = { updatedByUserId: ctx.userId || null };
    const auditRows: Array<{ action: string; metadata: Record<string, unknown> }> = [];

    if (dto.url !== undefined) {
      const { url, host } = this.checkedUrl(dto.url);
      if (url !== endpoint.url) {
        patch.url = url;
        auditRows.push({ action: 'URL_CHANGED', metadata: { host } });
      }
    }
    if (dto.description !== undefined) {
      patch.description = dto.description.trim() ? dto.description.trim().slice(0, 120) : null;
    }
    if (dto.events !== undefined) {
      const events = this.normalizeEvents(dto.events);
      if (events.join(',') !== endpoint.events.join(',')) {
        patch.events = events;
        auditRows.push({ action: 'EVENTS_CHANGED', metadata: { events } });
      }
    }
    if (dto.status !== undefined) {
      if (dto.status !== endpoint.status) {
        patch.status = dto.status;
        auditRows.push({ action: dto.status === 'ACTIVE' ? 'ENABLED' : 'DISABLED', metadata: {} });
        if (dto.status === 'DISABLED') {
          await this.cancelPending(endpoint.id, 'ENDPOINT_DISABLED');
        }
      }
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.update(WebhookEndpoint, { id: endpoint.id, merchantId: ctx.merchantId }, patch);
      for (const row of auditRows) {
        await manager.query(
          `INSERT INTO "webhook_endpoint_audit" ("endpointId", "merchantId", "action", "actorUserId", "metadata")
           VALUES ($1, $2, $3, $4, $5)`,
          [endpoint.id, ctx.merchantId, row.action, ctx.userId || null, JSON.stringify(row.metadata)],
        );
      }
    });

    return view(await this.endpoints.findOneOrFail({ where: { id: endpoint.id } }));
  }

  async archive(ctx: AuthContext, id: string): Promise<void> {
    this.assertAvailable();
    assertOwner(ctx);
    const endpoint = await this.findOwned(ctx.merchantId, id);

    await this.dataSource.transaction(async (manager) => {
      await manager.update(
        WebhookEndpoint,
        { id: endpoint.id, merchantId: ctx.merchantId },
        { status: 'ARCHIVED' as EndpointStatus, secretCiphertext: null, updatedByUserId: ctx.userId || null },
      );
      await manager.query(
        `INSERT INTO "webhook_endpoint_audit" ("endpointId", "merchantId", "action", "actorUserId", "metadata")
         VALUES ($1, $2, 'ARCHIVED', $3, '{}'::jsonb)`,
        [endpoint.id, ctx.merchantId, ctx.userId || null],
      );
    });
    await this.cancelPending(endpoint.id, 'ENDPOINT_ARCHIVED');
  }

  async rotateSecret(ctx: AuthContext, id: string): Promise<{ secret: string; secretHint: string }> {
    this.assertAvailable();
    assertOwner(ctx);
    const endpoint = await this.findOwned(ctx.merchantId, id);
    if (endpoint.status === 'ARCHIVED') {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Endpoint not found.' });
    }

    const { secret, hint } = newSigningSecret();
    const ciphertext = encryptSecret(this.config.encryptionKey as Buffer, secret, endpoint.id);
    await this.dataSource.transaction(async (manager) => {
      await manager.update(
        WebhookEndpoint,
        { id: endpoint.id },
        {
          secretCiphertext: ciphertext,
          secretHint: hint,
          secretRotatedAt: new Date(),
          updatedByUserId: ctx.userId || null,
        },
      );
      await manager.query(
        `INSERT INTO "webhook_endpoint_audit" ("endpointId", "merchantId", "action", "actorUserId", "metadata")
         VALUES ($1, $2, 'SECRET_ROTATED', $3, '{}'::jsonb)`,
        [endpoint.id, ctx.merchantId, ctx.userId || null],
      );
    });
    return { secret, secretHint: hint };
  }

  /** Delivery-time read: current URL + decrypted secret (rotation applies immediately). */
  async loadForDelivery(endpointId: string): Promise<{ endpoint: WebhookEndpoint; secret: string }> {
    const endpoint = await this.endpoints.findOne({ where: { id: endpointId } });
    if (!endpoint || endpoint.status !== 'ACTIVE' || !endpoint.secretCiphertext) {
      throw new NotFoundException({ code: 'ENDPOINT_UNAVAILABLE', message: 'Endpoint is not active.' });
    }
    const secret = decryptSecret(this.config.encryptionKey as Buffer, endpoint.secretCiphertext, endpoint.id);
    return { endpoint, secret };
  }

  async deliveries(ctx: AuthContext, endpointId: string, limit: number, before?: string): Promise<DeliveryView[]> {
    await this.findOwned(ctx.merchantId, endpointId);
    const params: unknown[] = [endpointId, ctx.merchantId];
    let cursor = '';
    if (before) {
      const parsed = new Date(before);
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException({ code: 'INVALID_CURSOR', message: 'before is not a valid date.' });
      }
      params.push(parsed);
      cursor = `AND d."createdAt" < $${params.length}`;
    }
    params.push(Math.min(Math.max(limit, 1), 50));

    const rows = (await this.dataSource.query(
      `SELECT d."id", d."status", d."attemptCount", d."nextAttemptAt", d."lastAttemptAt",
              d."lastHttpStatus", d."lastResultCategory", d."createdAt",
              e."eventId", e."type"
         FROM "webhook_deliveries" d
         JOIN "webhook_events" e ON e."id" = d."eventRowId"
        WHERE d."endpointId" = $1 AND d."merchantId" = $2 ${cursor}
        ORDER BY d."createdAt" DESC, d."id" DESC
        LIMIT $${params.length}`,
      params,
    )) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: String(row.id),
      eventId: String(row.eventId),
      type: String(row.type),
      status: String(row.status),
      attemptCount: Number(row.attemptCount),
      nextAttemptAt: new Date(row.nextAttemptAt as string).toISOString(),
      lastAttemptAt: row.lastAttemptAt ? new Date(row.lastAttemptAt as string).toISOString() : null,
      lastHttpStatus: row.lastHttpStatus === null ? null : Number(row.lastHttpStatus),
      lastResultCategory: row.lastResultCategory ? String(row.lastResultCategory) : null,
      createdAt: new Date(row.createdAt as string).toISOString(),
    }));
  }

  /** Manual retry: only FAILED deliveries, only events younger than 7 days (constants). */
  async retryDelivery(ctx: AuthContext, deliveryId: string): Promise<{ status: string }> {
    assertOwner(ctx);
    const rows = (await this.dataSource.query(
      `UPDATE "webhook_deliveries" d
          SET "status" = 'PENDING', "nextAttemptAt" = now(), "manualRetry" = true, "lockedUntil" = NULL
         FROM "webhook_events" e
        WHERE d."id" = $1
          AND d."merchantId" = $2
          AND d."eventRowId" = e."id"
          AND d."status" = 'FAILED'
          AND e."createdAt" > now() - interval '7 days'
        RETURNING d."id", d."status"`,
      [deliveryId, ctx.merchantId],
    )) as Array<{ id: string; status: string }>;

    if (rows.length === 0) {
      throw new NotFoundException({
        code: 'DELIVERY_NOT_RETRYABLE',
        message: 'Delivery not found, not FAILED, or its event is older than 7 days.',
      });
    }
    return { status: rows[0].status };
  }

  private async cancelPending(endpointId: string, reason: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE "webhook_deliveries"
          SET "status" = 'CANCELLED', "lockedUntil" = NULL, "lastResultCategory" = $2, "completedAt" = now()
        WHERE "endpointId" = $1 AND "status" IN ('PENDING', 'IN_FLIGHT')`,
      [endpointId, reason.slice(0, 24)],
    );
  }

  private async findOwned(merchantId: string, id: string): Promise<WebhookEndpoint> {
    const endpoint = await this.endpoints.findOne({ where: { id, merchantId, status: In(['ACTIVE', 'DISABLED', 'ARCHIVED'] as EndpointStatus[]) } });
    if (!endpoint) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Webhook endpoint not found.' });
    }
    return endpoint;
  }
}


