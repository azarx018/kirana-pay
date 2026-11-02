/**
 * Verifies migration 1700000003000 (V4 API key scopes) on a SCRATCH database:
 * pre-existing keys are backfilled with exactly their old abilities, the CHECK
 * constraint rejects bad scopes, and up/down/up is safe.
 *
 *   pnpm --filter @kirana-pay/api build
 *   DB_HOST=127.0.0.1 DB_PORT=5432 DB_USER=… DB_PASSWORD=… DB_NAME=scratch_db \
 *     node scripts/check-migration-api-keys.cjs
 *
 * Refuses to run unless DB_NAME contains "test" or "scratch" (never point it at real data).
 */
const path = require('node:path');
const assert = require('node:assert/strict');
const dist = path.join(__dirname, '..', 'apps', 'api', 'dist');
const { DataSource } = require(require.resolve('typeorm', { paths: [path.join(__dirname, '..', 'apps', 'api')] }));
const { InitialMultiTenant1700000000000 } = require(path.join(dist, 'migrations', '1700000000000-InitialMultiTenant.js'));
const { Invoices1700000001000 } = require(path.join(dist, 'migrations', '1700000001000-Invoices.js'));
const { PaymentLinks1700000002000 } = require(path.join(dist, 'migrations', '1700000002000-PaymentLinks.js'));
const { DeveloperApiKeys1700000003000 } = require(path.join(dist, 'migrations', '1700000003000-DeveloperApiKeys.js'));

const name = process.env.DB_NAME ?? '';
if (!/test|scratch/i.test(name)) {
  console.error('Refusing to run: DB_NAME must contain "test" or "scratch".');
  process.exit(2);
}

async function expectFail(ds, sql, params, label) {
  try {
    await ds.query(sql, params);
  } catch {
    return;
  }
  assert.fail(`${label}: should have been rejected by the database`);
}

(async () => {
  const ds = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 5432),
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: name,
    migrations: [],
    synchronize: false,
  });
  await ds.initialize();
  const qr = ds.createQueryRunner();
  try {
    // 1. schema as it was BEFORE V4
    for (const M of [InitialMultiTenant1700000000000, Invoices1700000001000, PaymentLinks1700000002000]) {
      await new M().up(qr);
    }
    const [merchant] = await ds.query(`INSERT INTO merchants (name) VALUES ('Legacy Shop') RETURNING id`);
    await ds.query(
      `INSERT INTO api_keys ("merchantId", name, prefix, "keyHash", "revokedAt")
       VALUES ($1, 'old active', 'kp_live_aaaaaa', repeat('a', 64), NULL),
              ($1, 'old revoked', 'kp_live_bbbbbb', repeat('b', 64), now())`,
      [merchant.id],
    );

    // 2. apply V4 migration
    const migration = new DeveloperApiKeys1700000003000();
    await migration.up(qr);
    const rows = await ds.query(`SELECT name, scopes, "expiresAt", "createdByUserId", "rotatedFromId" FROM api_keys ORDER BY name`);
    assert.equal(rows.length, 2);
    for (const r of rows) {
      assert.deepEqual([...r.scopes].sort(), ['invoices:read', 'invoices:write', 'qr:convert'], `${r.name} backfill`);
      assert.equal(r.expiresAt, null);
    }
    const revoked = await ds.query(`SELECT "revokedAt" FROM api_keys WHERE name = 'old revoked'`);
    assert.ok(revoked[0].revokedAt, 'a revoked key must stay revoked');

    // 3. constraint behaviour
    await ds.query(
      `INSERT INTO api_keys ("merchantId", name, prefix, "keyHash", scopes)
       VALUES ($1, 'new', 'kp_live_cccccc', repeat('c', 64), ARRAY['invoices:read']::text[])`,
      [merchant.id],
    );
    await expectFail(ds, `INSERT INTO api_keys ("merchantId", name, prefix, "keyHash", scopes) VALUES ($1,'x','p',repeat('d',64),'{}')`, [merchant.id], 'empty scopes');
    await expectFail(ds, `INSERT INTO api_keys ("merchantId", name, prefix, "keyHash", scopes) VALUES ($1,'x','p',repeat('e',64),ARRAY['invoices:confirm']::text[])`, [merchant.id], 'unknown scope');
    await expectFail(ds, `INSERT INTO api_keys ("merchantId", name, prefix, "keyHash", scopes) VALUES ($1,'x','p',repeat('f',64),ARRAY['invoices:read','admin']::text[])`, [merchant.id], 'mixed scopes');

    // 4. idempotent re-run keeps data; down then up round-trips
    await migration.up(qr);
    const again = await ds.query(`SELECT count(*)::int AS n FROM api_keys`);
    assert.equal(again[0].n, 3);
    await migration.down(qr);
    const cols = await ds.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'api_keys' AND column_name = 'scopes'`);
    assert.equal(cols.length, 0, 'down removes scopes');
    await migration.up(qr);
    const final = await ds.query(`SELECT count(*)::int AS n FROM api_keys WHERE cardinality(scopes) >= 1`);
    assert.equal(final[0].n, 3, 'up after down backfills every surviving key');

    console.log('MIGRATION CHECK PASSED');
  } finally {
    await qr.release();
    await ds.destroy();
  }
})().catch((error) => {
  console.error('MIGRATION CHECK FAILED:', error.message);
  process.exit(1);
});
