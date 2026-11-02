import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * MVP V4: scopes, optional expiry and audit columns for API keys.
 * Existing keys are backfilled with EXACTLY what they can do today
 * (invoices read/write and /v1/qr/*): no privilege is added or removed.
 * No scope ever grants "mark invoice paid"; that stays session-only.
 */
export class DeveloperApiKeys1700000003000 implements MigrationInterface {
  name = 'DeveloperApiKeys1700000003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "api_keys"
        ADD COLUMN IF NOT EXISTS "scopes" text[] NOT NULL DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS "expiresAt" timestamptz,
        ADD COLUMN IF NOT EXISTS "createdByUserId" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS "revokedByUserId" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS "rotatedFromId" uuid REFERENCES "api_keys"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      UPDATE "api_keys"
         SET "scopes" = ARRAY['invoices:read', 'invoices:write', 'qr:convert']::text[]
       WHERE cardinality("scopes") = 0
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_api_keys_scopes') THEN
          ALTER TABLE "api_keys" ADD CONSTRAINT "chk_api_keys_scopes" CHECK (
            cardinality("scopes") >= 1
            AND "scopes" <@ ARRAY['invoices:read', 'invoices:write', 'payment_links:read',
                                  'payment_links:write', 'qr:convert']::text[]
          );
        END IF;
      END $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "api_keys" DROP CONSTRAINT IF EXISTS "chk_api_keys_scopes"`);
    await queryRunner.query(`
      ALTER TABLE "api_keys"
        DROP COLUMN IF EXISTS "rotatedFromId",
        DROP COLUMN IF EXISTS "revokedByUserId",
        DROP COLUMN IF EXISTS "createdByUserId",
        DROP COLUMN IF EXISTS "expiresAt",
        DROP COLUMN IF EXISTS "scopes"
    `);
  }
}
