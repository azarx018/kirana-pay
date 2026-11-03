import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * MVP V4: webhooks. Tables:
 *  - webhook_endpoints      merchant-registered HTTPS receivers (signing secret stored ENCRYPTED)
 *  - webhook_endpoint_audit who changed what (host names only, never secrets)
 *  - webhook_events         the transactional OUTBOX (one row per business event, exact payload bytes)
 *  - webhook_deliveries     one row per (event, endpoint); claimed by workers with FOR UPDATE SKIP LOCKED
 *  - webhook_delivery_attempts  bounded history of every attempt
 * Foreign keys are RESTRICT (history is never cascaded away) except attempts -> deliveries,
 * which are removed together by the 30-day retention job.
 */
export class Webhooks1700000005000 implements MigrationInterface {
  name = 'Webhooks1700000005000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "webhook_endpoints" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "merchantId" uuid NOT NULL REFERENCES "merchants"("id") ON DELETE RESTRICT,
        "url" varchar(2048) NOT NULL,
        "description" varchar(120),
        "events" text[] NOT NULL,
        "status" varchar(12) NOT NULL DEFAULT 'ACTIVE',
        "secretCiphertext" text,
        "secretHint" varchar(8),
        "secretRotatedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "createdByUserId" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "updatedByUserId" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "chk_webhook_endpoints_status" CHECK ("status" IN ('ACTIVE', 'DISABLED', 'ARCHIVED')),
        CONSTRAINT "chk_webhook_endpoints_events" CHECK (
          cardinality("events") >= 1
          AND "events" <@ ARRAY['invoice.created', 'invoice.paid', 'invoice.expired']::text[]
        ),
        CONSTRAINT "chk_webhook_endpoints_secret" CHECK (("status" = 'ARCHIVED') = ("secretCiphertext" IS NULL))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_webhook_endpoints_merchant" ON "webhook_endpoints" ("merchantId", "status")`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_webhook_endpoints_unique_url"
      ON "webhook_endpoints" ("merchantId", "url") WHERE "status" <> 'ARCHIVED'
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "webhook_endpoint_audit" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "endpointId" uuid NOT NULL REFERENCES "webhook_endpoints"("id") ON DELETE RESTRICT,
        "merchantId" uuid NOT NULL REFERENCES "merchants"("id") ON DELETE RESTRICT,
        "action" varchar(24) NOT NULL,
        "actorUserId" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_webhook_audit_action" CHECK ("action" IN
          ('CREATED', 'URL_CHANGED', 'EVENTS_CHANGED', 'ENABLED', 'DISABLED', 'SECRET_ROTATED', 'ARCHIVED', 'DELIVERY_RETRIED'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_webhook_audit_endpoint" ON "webhook_endpoint_audit" ("endpointId", "createdAt" DESC)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "webhook_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "eventId" varchar(40) NOT NULL,
        "merchantId" uuid NOT NULL REFERENCES "merchants"("id") ON DELETE RESTRICT,
        "type" varchar(40) NOT NULL,
        "invoiceId" uuid NOT NULL REFERENCES "invoices"("id") ON DELETE RESTRICT,
        "payloadJson" text NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "fanoutStatus" varchar(8) NOT NULL DEFAULT 'PENDING',
        "fanoutLockedUntil" timestamptz,
        "fanoutDoneAt" timestamptz,
        CONSTRAINT "chk_webhook_events_type" CHECK ("type" IN ('invoice.created', 'invoice.paid', 'invoice.expired')),
        CONSTRAINT "chk_webhook_events_fanout" CHECK ("fanoutStatus" IN ('PENDING', 'DONE'))
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "idx_webhook_events_event_id" ON "webhook_events" ("eventId")`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_webhook_events_fanout"
      ON "webhook_events" ("createdAt") WHERE "fanoutStatus" = 'PENDING'
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_webhook_events_created" ON "webhook_events" ("createdAt")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "eventRowId" uuid NOT NULL REFERENCES "webhook_events"("id") ON DELETE RESTRICT,
        "endpointId" uuid NOT NULL REFERENCES "webhook_endpoints"("id") ON DELETE RESTRICT,
        "merchantId" uuid NOT NULL REFERENCES "merchants"("id") ON DELETE RESTRICT,
        "status" varchar(12) NOT NULL DEFAULT 'PENDING',
        "attemptCount" integer NOT NULL DEFAULT 0,
        "nextAttemptAt" timestamptz NOT NULL DEFAULT now(),
        "lockedUntil" timestamptz,
        "manualRetry" boolean NOT NULL DEFAULT false,
        "lastResultCategory" varchar(24),
        "lastHttpStatus" integer,
        "lastAttemptAt" timestamptz,
        "completedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_webhook_deliveries_status" CHECK ("status" IN ('PENDING', 'IN_FLIGHT', 'SUCCEEDED', 'FAILED', 'CANCELLED'))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_webhook_deliveries_event_endpoint" ON "webhook_deliveries" ("eventRowId", "endpointId")`,
    );
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_webhook_deliveries_claim"
      ON "webhook_deliveries" ("nextAttemptAt") WHERE "status" IN ('PENDING', 'IN_FLIGHT')
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_webhook_deliveries_endpoint" ON "webhook_deliveries" ("endpointId", "createdAt" DESC, "id" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_webhook_deliveries_merchant" ON "webhook_deliveries" ("merchantId", "createdAt" DESC)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "webhook_delivery_attempts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "deliveryId" uuid NOT NULL REFERENCES "webhook_deliveries"("id") ON DELETE CASCADE,
        "attemptNumber" integer NOT NULL,
        "trigger" varchar(8) NOT NULL DEFAULT 'AUTO',
        "startedAt" timestamptz NOT NULL,
        "durationMs" integer NOT NULL,
        "resultCategory" varchar(24) NOT NULL,
        "httpStatus" integer,
        "responseExcerpt" varchar(256),
        "errorCode" varchar(40),
        "retryAt" timestamptz,
        CONSTRAINT "chk_webhook_attempts_trigger" CHECK ("trigger" IN ('AUTO', 'MANUAL'))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_webhook_attempts_delivery" ON "webhook_delivery_attempts" ("deliveryId", "attemptNumber")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "webhook_delivery_attempts"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "webhook_deliveries"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "webhook_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "webhook_endpoint_audit"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "webhook_endpoints"`);
  }
}
