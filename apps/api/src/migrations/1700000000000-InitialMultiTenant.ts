import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the multi-tenant foundation. Written idempotently so it can be applied
 * both to a fresh database and to the original MVP database that already had
 * `qr_jobs` created by TypeORM synchronize.
 */
export class InitialMultiTenant1700000000000 implements MigrationInterface {
  name = 'InitialMultiTenant1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

    // --- original MVP table, recreated for fresh installs -------------------
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "qr_jobs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "status" varchar(32) NOT NULL,
        "amount" bigint NOT NULL,
        "currency" varchar(8) NOT NULL DEFAULT 'IDR',
        "nmid" varchar(32) NOT NULL,
        "merchantName" varchar(64) NOT NULL,
        "payloadSha256" varchar(64) NOT NULL,
        "qrPath" varchar(255) NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`ALTER TABLE "qr_jobs" ADD COLUMN IF NOT EXISTS "merchantId" uuid`);
    await queryRunner.query(`ALTER TABLE "qr_jobs" ADD COLUMN IF NOT EXISTS "qrisId" uuid`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_qr_jobs_merchant" ON "qr_jobs" ("merchantId")`);

    // --- auth / tenancy ----------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "email" varchar(254) NOT NULL,
        "passwordHash" varchar(255) NOT NULL,
        "displayName" varchar(80),
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "idx_users_email" ON "users" ("email")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "merchants" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(120) NOT NULL,
        "contactEmail" varchar(160),
        "phone" varchar(40),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "merchant_members" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "merchantId" uuid NOT NULL REFERENCES "merchants"("id") ON DELETE CASCADE,
        "userId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "role" varchar(16) NOT NULL DEFAULT 'OWNER',
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "idx_merchant_members_unique" ON "merchant_members" ("merchantId", "userId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_merchant_members_user" ON "merchant_members" ("userId")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "sessions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "tokenHash" varchar(64) NOT NULL,
        "expiresAt" timestamptz NOT NULL,
        "lastUsedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "idx_sessions_token" ON "sessions" ("tokenHash")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_sessions_user" ON "sessions" ("userId")`);

    // --- providers registry ------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "payment_providers" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "code" varchar(40) NOT NULL,
        "name" varchar(80) NOT NULL,
        "isActive" boolean NOT NULL DEFAULT true,
        "sortOrder" int NOT NULL DEFAULT 0,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "idx_payment_providers_code" ON "payment_providers" ("code")`);

    await queryRunner.query(`
      INSERT INTO "payment_providers" ("code", "name", "sortOrder")
      VALUES
        ('DANA_BUSINESS', 'DANA Business', 10),
        ('GOPAY_MERCHANT', 'GoPay Merchant', 20),
        ('SHOPEEPAY_MERCHANT', 'ShopeePay Merchant', 30)
      ON CONFLICT ("code") DO NOTHING
    `);

    // --- merchant QRIS -----------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "merchant_qris" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "merchantId" uuid NOT NULL REFERENCES "merchants"("id") ON DELETE CASCADE,
        "providerId" uuid NOT NULL REFERENCES "payment_providers"("id") ON DELETE RESTRICT,
        "displayName" varchar(80) NOT NULL,
        "imagePath" varchar(255) NOT NULL,
        "imageSha256" varchar(64) NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'ACTIVE',
        "nmid" varchar(32),
        "merchantName" varchar(120),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_merchant_qris_merchant" ON "merchant_qris" ("merchantId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_merchant_qris_provider" ON "merchant_qris" ("providerId")`);

    // --- merchant API keys -------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "api_keys" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "merchantId" uuid NOT NULL REFERENCES "merchants"("id") ON DELETE CASCADE,
        "name" varchar(60) NOT NULL,
        "prefix" varchar(16) NOT NULL,
        "keyHash" varchar(64) NOT NULL,
        "lastUsedAt" timestamptz,
        "revokedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "idx_api_keys_hash" ON "api_keys" ("keyHash")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_api_keys_merchant" ON "api_keys" ("merchantId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['api_keys', 'merchant_qris', 'payment_providers', 'sessions', 'merchant_members', 'merchants', 'users']) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}"`);
    }
    await queryRunner.query(`ALTER TABLE "qr_jobs" DROP COLUMN IF EXISTS "merchantId"`);
    await queryRunner.query(`ALTER TABLE "qr_jobs" DROP COLUMN IF EXISTS "qrisId"`);
  }
}
