import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { WebhookEventsService } from './webhook-events.service';
import { WebhookEndpointsService } from './webhook-endpoints.service';
import { effectiveDelaySeconds, shouldRetry } from './webhook-backoff';
import { WEBHOOK_CONFIG, type WebhookConfig } from './webhook.config';
import { WEBHOOK_RETENTION_DAYS } from './webhook.constants';
import { sendWebhook } from './webhook-sender';

/**
 * TypeORM returns rows for SELECT but `[rows, affectedCount]` for UPDATE/INSERT/DELETE with
 * RETURNING. Normalise both so claim queries can be written with RETURNING.
 */
function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result) && Array.isArray(result[0])) return result[0] as T[];
  return (result as T[]) ?? [];
}

interface ClaimedEvent {
  id: string;
  eventId: string;
  merchantId: string;
  type: string;
  payloadJson: string;
  createdAt: Date;
}

interface ClaimedDelivery {
  id: string;
  eventRowId: string;
  endpointId: string;
  merchantId: string;
  attemptCount: number;
  manualRetry: boolean;
  createdAt: Date;
}

/**
 * Outbox worker: fan-out events to subscribed endpoints, deliver with retry/backoff, sweep
 * expiries and prune history. Safe with multiple instances thanks to FOR UPDATE SKIP LOCKED
 * plus a lease; a crashed worker's deliveries are reclaimed when the lease expires.
 */
@Injectable()
export class WebhookWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookWorkerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly events: WebhookEventsService,
    private readonly endpoints: WebhookEndpointsService,
    @Inject(WEBHOOK_CONFIG) private readonly config: WebhookConfig,
  ) {}

  onModuleInit(): void {
    if (!this.config.workerEnabled) {
      this.logger.log('Webhook worker disabled (WEBHOOK_WORKER_ENABLED=false).');
      return;
    }
    this.timer = setInterval(() => void this.tick(), this.config.pollIntervalMs);
    this.timer.unref?.();
    void this.tick();
    this.logger.log(`Webhook worker started (poll ${this.config.pollIntervalMs}ms, concurrency ${this.config.workerConcurrency}).`);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  /** One cycle. Exposed for tests. */
  async tick(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      await this.fanout();
      await this.deliverDue();
      await this.sweepExpiredInvoices();
      await this.prune();
    } catch (error) {
      this.logger.error(`Webhook worker cycle failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Turn outbox rows into one delivery per subscribed, active endpoint. */
  private async fanout(): Promise<void> {
    const claimed = rowsOf<ClaimedEvent>(await this.dataSource.query(
      `WITH claimed AS (
         SELECT "id" FROM "webhook_events"
          WHERE "fanoutStatus" = 'PENDING'
            AND ("fanoutLockedUntil" IS NULL OR "fanoutLockedUntil" < now())
          ORDER BY "createdAt"
          LIMIT 50
          FOR UPDATE SKIP LOCKED
       )
       UPDATE "webhook_events" e
          SET "fanoutLockedUntil" = now() + interval '1 minute'
         FROM claimed c
        WHERE e."id" = c."id"
        RETURNING e."id", e."eventId", e."merchantId", e."type", e."payloadJson", e."createdAt"`,
    ));

    for (const event of claimed) {
      await this.dataSource.transaction(async (manager) => {
        await manager.query(
          `INSERT INTO "webhook_deliveries" ("eventRowId", "endpointId", "merchantId")
           SELECT $1, ep."id", $2
             FROM "webhook_endpoints" ep
            WHERE ep."merchantId" = $2
              AND ep."status" = 'ACTIVE'
              AND $3 = ANY(ep."events")
           ON CONFLICT ("eventRowId", "endpointId") DO NOTHING`,
          [event.id, event.merchantId, event.type],
        );
        await manager.query(
          `UPDATE "webhook_events" SET "fanoutStatus" = 'DONE', "fanoutDoneAt" = now(), "fanoutLockedUntil" = NULL WHERE "id" = $1`,
          [event.id],
        );
      });
    }
  }

  /** Claim due deliveries (bounded by concurrency) and attempt them. */
  private async deliverDue(): Promise<void> {
    const claimed = rowsOf<ClaimedDelivery>(await this.dataSource.query(
      `WITH claimed AS (
         SELECT "id" FROM "webhook_deliveries"
          WHERE "status" IN ('PENDING', 'IN_FLIGHT')
            AND "nextAttemptAt" <= now()
            AND ("lockedUntil" IS NULL OR "lockedUntil" < now())
          ORDER BY "nextAttemptAt"
          LIMIT $1
          FOR UPDATE SKIP LOCKED
       )
       UPDATE "webhook_deliveries" d
          SET "status" = 'IN_FLIGHT', "lockedUntil" = now() + interval '2 minutes'
         FROM claimed c
        WHERE d."id" = c."id"
        RETURNING d."id", d."eventRowId", d."endpointId", d."merchantId",
                  d."attemptCount", d."manualRetry", d."createdAt"`,
      [this.config.workerConcurrency],
    ));

    await Promise.all(claimed.map((delivery) => this.attempt(delivery)));
  }

  private async attempt(delivery: ClaimedDelivery): Promise<void> {
    const [event] = (await this.dataSource.query(
      `SELECT "eventId", "payloadJson" FROM "webhook_events" WHERE "id" = $1`,
      [delivery.eventRowId],
    )) as Array<{ eventId: string; payloadJson: string }>;

    if (!event) {
      await this.markCancelled(delivery.id, 'EVENT_MISSING');
      return;
    }

    const startedAt = new Date();
    const startedMs = Date.now();

    let endpoint: { url: string };
    let secret: string;
    try {
      const loaded = await this.endpoints.loadForDelivery(delivery.endpointId);
      endpoint = { url: loaded.endpoint.url };
      secret = loaded.secret;
    } catch (error) {
      await this.markCancelled(delivery.id, (error as Error).message.includes('not active') ? 'ENDPOINT_DISABLED' : 'ENDPOINT_UNAVAILABLE');
      return;
    }

    const result = await sendWebhook({
      url: endpoint.url,
      secret,
      eventId: event.eventId,
      payloadJson: event.payloadJson,
      config: this.config,
    });

    const durationMs = Date.now() - startedMs;
    const attemptNumber = delivery.attemptCount + 1;
    const firstAttemptAt = delivery.createdAt;
    const retryable = result.category === 'RETRYABLE';
    const canRetry =
      retryable &&
      !delivery.manualRetry &&
      shouldRetry({
        attemptCount: attemptNumber,
        maxAttempts: this.config.maxAttempts,
        firstAttemptAt,
        maxAgeHours: this.config.maxAgeHours,
      });

    const retryAt = canRetry
      ? new Date(Date.now() + effectiveDelaySeconds(attemptNumber, result.retryAfterSeconds) * 1000)
      : null;

    const status = result.category === 'SUCCESS' ? 'SUCCEEDED' : canRetry ? 'PENDING' : 'FAILED';

    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO "webhook_delivery_attempts"
           ("deliveryId", "attemptNumber", "trigger", "startedAt", "durationMs", "resultCategory",
            "httpStatus", "responseExcerpt", "errorCode", "retryAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT ("deliveryId", "attemptNumber") DO NOTHING`,
        [
          delivery.id,
          attemptNumber,
          delivery.manualRetry ? 'MANUAL' : 'AUTO',
          startedAt,
          durationMs,
          result.category,
          result.httpStatus,
          result.excerpt,
          result.errorCode,
          retryAt,
        ],
      );

      await manager.query(
        `UPDATE "webhook_deliveries"
            SET "status" = $2,
                "attemptCount" = $3,
                "nextAttemptAt" = COALESCE($4, "nextAttemptAt"),
                "lockedUntil" = NULL,
                "manualRetry" = false,
                "lastResultCategory" = $5,
                "lastHttpStatus" = $6,
                "lastAttemptAt" = $7,
                "completedAt" = $8
          WHERE "id" = $1`,
        [
          delivery.id,
          status,
          attemptNumber,
          retryAt,
          result.category,
          result.httpStatus,
          startedAt,
          status === 'PENDING' ? null : new Date(),
        ],
      );
    });
  }

  private async markCancelled(deliveryId: string, reason: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE "webhook_deliveries"
          SET "status" = 'CANCELLED', "lockedUntil" = NULL, "lastResultCategory" = $2, "completedAt" = now()
        WHERE "id" = $1`,
      [deliveryId, reason.slice(0, 24)],
    );
  }

  /**
   * Explicit expiry (the plan's K3): a batch of PENDING invoices past `expiresAt` becomes
   * EXPIRED in one transaction together with its invoice event and outbox row.
   */
  private async sweepExpiredInvoices(): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const rows = (await manager.query(
        `SELECT "id", "publicId", "merchantId", "amount", "currency", "createdAt", "expiresAt"
           FROM "invoices"
          WHERE "status" = 'PENDING' AND "expiresAt" <= now()
          ORDER BY "expiresAt"
          LIMIT 200
          FOR UPDATE SKIP LOCKED`,
      )) as Array<{
        id: string;
        publicId: string;
        merchantId: string;
        amount: string;
        currency: string;
        createdAt: Date;
        expiresAt: Date;
      }>;

      if (rows.length === 0) return;
      const ids = rows.map((row) => row.id);

      await manager.query(
        `UPDATE "invoices" SET "status" = 'EXPIRED', "updatedAt" = now() WHERE "id" = ANY($1::uuid[])`,
        [ids],
      );
      await manager.query(
        `INSERT INTO "invoice_events" ("invoiceId", "type", "actorUserId", "metadata")
         SELECT unnest($1::uuid[]), 'EXPIRED', NULL, NULL`,
        [ids],
      );

      for (const row of rows) {
        await this.events.enqueue(manager, {
          merchantId: row.merchantId,
          type: 'invoice.expired',
          invoiceId: row.id,
          invoice: {
            reference: row.publicId,
            amount: Number(row.amount),
            currency: row.currency,
            status: 'EXPIRED',
            createdAt: new Date(row.createdAt).toISOString(),
            expiresAt: new Date(row.expiresAt).toISOString(),
            paidAt: null,
          },
        });
      }
    });
  }

  /** 30-day retention: attempts go with their delivery; old events and deliveries go too. */
  private async prune(): Promise<void> {
    await this.dataSource.query(
      `DELETE FROM "webhook_delivery_attempts" a
        USING "webhook_deliveries" d
        WHERE a."deliveryId" = d."id" AND d."createdAt" < now() - interval '${WEBHOOK_RETENTION_DAYS} days'`,
    );
    await this.dataSource.query(
      `DELETE FROM "webhook_deliveries" WHERE "createdAt" < now() - interval '${WEBHOOK_RETENTION_DAYS} days'`,
    );
    await this.dataSource.query(
      `DELETE FROM "webhook_events"
        WHERE "createdAt" < now() - interval '${WEBHOOK_RETENTION_DAYS} days'
          AND NOT EXISTS (SELECT 1 FROM "webhook_deliveries" d WHERE d."eventRowId" = "webhook_events"."id")`,
    );
  }
}
