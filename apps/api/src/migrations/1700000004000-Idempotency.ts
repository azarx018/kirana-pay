import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * MVP V4: idempotency records for POST /v1/developer/invoices.
 * Only a hash of the client key and a fingerprint of the normalized request are kept
 * (never the key itself or the request body). A COMPLETED record always points at its
 * invoice; the link is written in the SAME transaction that creates the invoice.
 */
export class Idempotency1700000004000 implements MigrationInterface {
  name = 'Idempotency1700000004000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "idempotency_records" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "merchantId" uuid NOT NULL REFERENCES "merchants"("id") ON DELETE RESTRICT,
        "operation" varchar(40) NOT NULL,
        "keyHash" char(64) NOT NULL,
        "fingerprint" char(64) NOT NULL,
        "state" varchar(12) NOT NULL DEFAULT 'IN_PROGRESS',
        "invoiceId" uuid REFERENCES "invoices"("id") ON DELETE RESTRICT,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "completedAt" timestamptz,
        "expiresAt" timestamptz NOT NULL,
        CONSTRAINT "chk_idempotency_state" CHECK ("state" IN ('IN_PROGRESS', 'COMPLETED')),
        CONSTRAINT "chk_idempotency_completion" CHECK (
          ("state" = 'COMPLETED') = ("invoiceId" IS NOT NULL)
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_idempotency_scope"
      ON "idempotency_records" ("merchantId", "operation", "keyHash")
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_idempotency_expires" ON "idempotency_records" ("expiresAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "idempotency_records"`);
  }
}
