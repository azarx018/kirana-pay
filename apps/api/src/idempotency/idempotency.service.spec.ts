import type { DataSource, EntityManager } from 'typeorm';
import { IdempotencyService } from './idempotency.service';

type Script = Array<(sql: string, params: unknown[]) => unknown>;

function build(script: Script) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  let i = 0;
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    const step = script[i];
    i += 1;
    if (!step) throw new Error(`unexpected query #${i}: ${sql.slice(0, 60)}`);
    return step(sql, params);
  });
  return { service: new IdempotencyService({ query } as unknown as DataSource), calls, query };
}

const existing = (over: Record<string, unknown> = {}) => ({
  id: 'rec-1',
  fingerprint: 'F'.repeat(64),
  state: 'IN_PROGRESS',
  invoiceId: null,
  expired: false,
  stale: false,
  ...over,
});
const FP = 'F'.repeat(64);

describe('IdempotencyService.begin', () => {
  it('lets the first caller own the slot and stores only hashes', async () => {
    const { service, calls } = build([() => [{ id: 'rec-1' }]]);
    await expect(service.begin('m-1', 'invoice.create', 'order-12345678', FP)).resolves.toEqual({
      kind: 'owner',
      recordId: 'rec-1',
    });
    expect(calls[0].sql).toContain('ON CONFLICT ("merchantId", "operation", "keyHash") DO NOTHING');
    expect(calls[0].params[0]).toBe('m-1');
    expect(calls[0].params[2]).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(calls[0].params)).not.toContain('order-12345678');
  });

  it('replays the original invoice for the same key and same request', async () => {
    const { service } = build([() => [], () => [existing({ state: 'COMPLETED', invoiceId: 'inv-9' })]]);
    await expect(service.begin('m-1', 'invoice.create', 'order-12345678', FP)).resolves.toEqual({
      kind: 'replay',
      invoiceId: 'inv-9',
    });
  });

  it('rejects the same key with a different request (409 IDEMPOTENCY_CONFLICT)', async () => {
    const { service } = build([() => [], () => [existing({ fingerprint: 'E'.repeat(64), state: 'COMPLETED', invoiceId: 'inv-9' })]]);
    await expect(service.begin('m-1', 'invoice.create', 'order-12345678', FP)).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_CONFLICT' },
    });
  });

  it('answers 409 IDEMPOTENCY_IN_PROGRESS while the first request is still running', async () => {
    const { service } = build([() => [], () => [existing()]]);
    await expect(service.begin('m-1', 'invoice.create', 'order-12345678', FP)).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_IN_PROGRESS' },
    });
  });

  it('takes over an abandoned (stale) IN_PROGRESS record, conditionally', async () => {
    const { service, calls } = build([() => [], () => [existing({ stale: true })], () => [[{ id: 'rec-1' }], 1]]);
    await expect(service.begin('m-1', 'invoice.create', 'order-12345678', FP)).resolves.toEqual({
      kind: 'owner',
      recordId: 'rec-1',
    });
    expect(calls[2].sql).toMatch(/"state" = 'IN_PROGRESS'[\s\S]*"createdAt" < now\(\)/);
  });

  it('does not take over when someone else already did (no double ownership)', async () => {
    const { service } = build([
      () => [],
      () => [existing({ stale: true })],
      () => [[], 0], // lost the takeover race
      () => [], // next loop: insert conflicts again
      () => [existing()], // now fresh and in progress
    ]);
    await expect(service.begin('m-1', 'invoice.create', 'order-12345678', FP)).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_IN_PROGRESS' },
    });
  });

  it('discards an expired record and claims the key again', async () => {
    const { service, calls } = build([
      () => [],
      () => [existing({ expired: true, state: 'COMPLETED', invoiceId: 'old' })],
      () => [[], 1],
      () => [{ id: 'rec-2' }],
    ]);
    await expect(service.begin('m-1', 'invoice.create', 'order-12345678', FP)).resolves.toEqual({
      kind: 'owner',
      recordId: 'rec-2',
    });
    expect(calls[2].sql).toContain('DELETE');
    expect(calls[2].sql).toContain(`"expiresAt" <= now()`);
  });
});

describe('IdempotencyService completion', () => {
  it('completes inside the caller transaction, only while IN_PROGRESS', async () => {
    const { service } = build([]);
    const managerQuery = jest.fn(async () => [[{ id: 'rec-1' }], 1]);
    await service.completeInTransaction({ query: managerQuery } as unknown as EntityManager, 'rec-1', 'inv-1');
    const [sql, params] = managerQuery.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/SET "state" = 'COMPLETED'[\s\S]*"state" = 'IN_PROGRESS'/);
    expect(params).toEqual(['rec-1', 'inv-1']);
  });

  it('aborts the transaction (no duplicate invoice) if the slot was taken over', async () => {
    const { service } = build([]);
    const managerQuery = jest.fn(async () => [[], 0]);
    await expect(
      service.completeInTransaction({ query: managerQuery } as unknown as EntityManager, 'rec-1', 'inv-1'),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_IN_PROGRESS' } });
  });

  it('abandon only frees IN_PROGRESS records (a completed one is kept)', async () => {
    const { service, calls } = build([() => [[], 0]]);
    await service.abandon('rec-1');
    expect(calls[0].sql).toMatch(/DELETE[\s\S]*"state" = 'IN_PROGRESS'/);
  });
});
