import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * MVP V2: merchant-scoped invoices + append-only invoice audit events.
 * Financial history is preserved: merchants/QRIS rows are referenced with
 * ON DELETE RESTRICT, so an invoice can never lose its origin.
 */
export class Invoices1700000001000 implements MigrationInterface {
  name = 'Invoices1700000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "invoices" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "publicId" varchar(32) NOT NULL,
        "merchantId" uuid NOT NULL REFERENCES "merchants"("id") ON DELETE RESTRICT,
        "qrisId" uuid NOT NULL REFERENCES "merchant_qris"("id") ON DELETE RESTRICT,
        "amount" bigint NOT NULL,
        "currency" varchar(8) NOT NULL DEFAULT 'IDR',
        "description" varchar(200),
        "status" varchar(16) NOT NULL DEFAULT 'PENDING',
        "qrPath" varchar(255),
        "qrSha256" varchar(64),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "expiresAt" timestamptz NOT NULL,
        "paidAt" timestamptz,
        "confirmedByUserId" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "confirmationMethod" varchar(32),
        CONSTRAINT "chk_invoices_amount_positive" CHECK ("amount" > 0),
        CONSTRAINT "chk_invoices_status" CHECK ("status" IN ('PENDING', 'PAID', 'EXPIRED')),
        CONSTRAINT "chk_invoices_confirmation" CHECK (
          ("status" = 'PAID' AND "paidAt" IS NOT NULL AND "confirmedByUserId" IS NOT NULL AND "confirmationMethod" = 'MANUAL_MERCHANT')
          OR ("status" <> 'PAID' AND "paidAt" IS NULL AND "confirmedByUserId" IS NULL AND "confirmationMethod" IS NULL)
        ),
        CONSTRAINT "chk_invoices_expiry_after_creation" CHECK ("expiresAt" > "createdAt")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "idx_invoices_public_id" ON "invoices" ("publicId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_invoices_merchant" ON "invoices" ("merchantId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_invoices_qris" ON "invoices" ("qrisId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_invoices_status" ON "invoices" ("status")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_invoices_expires_at" ON "invoices" ("expiresAt")`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_invoices_merchant_created"
      ON "invoices" ("merchantId", "createdAt" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_invoices_merchant_status_created"
      ON "invoices" ("merchantId", "status", "createdAt" DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "invoice_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "invoiceId" uuid NOT NULL REFERENCES "invoices"("id") ON DELETE CASCADE,
        "type" varchar(32) NOT NULL,
        "actorUserId" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "metadata" jsonb,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_invoice_events_type" CHECK ("type" IN ('CREATED', 'PAYMENT_CONFIRMED', 'EXPIRED'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_invoice_events_invoice"
      ON "invoice_events" ("invoiceId", "createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "invoice_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "invoices"`);
  }
}
