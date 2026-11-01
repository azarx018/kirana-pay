import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * MVP V3: payment links. One ACTIVE link per invoice is enforced by a partial
 * unique index, so concurrent "create" calls can never produce two live links.
 * Rows are never deleted: revoking keeps history and the token stays dead forever.
 * Invoices are referenced with ON DELETE RESTRICT (same history rule as V2).
 */
export class PaymentLinks1700000002000 implements MigrationInterface {
  name = 'PaymentLinks1700000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "payment_links" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "invoiceId" uuid NOT NULL REFERENCES "invoices"("id") ON DELETE RESTRICT,
        "tokenNonce" varchar(22) NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'ACTIVE',
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "createdByUserId" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "revokedAt" timestamptz,
        "revokedByUserId" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "chk_payment_links_status" CHECK ("status" IN ('ACTIVE', 'REVOKED')),
        CONSTRAINT "chk_payment_links_revocation" CHECK (
          ("status" = 'ACTIVE' AND "revokedAt" IS NULL AND "revokedByUserId" IS NULL)
          OR ("status" = 'REVOKED' AND "revokedAt" IS NOT NULL)
        )
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_payment_links_token_nonce" ON "payment_links" ("tokenNonce")`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_payment_links_one_active_per_invoice"
      ON "payment_links" ("invoiceId") WHERE "status" = 'ACTIVE'
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_payment_links_invoice_created"
      ON "payment_links" ("invoiceId", "createdAt" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "payment_links"`);
  }
}
