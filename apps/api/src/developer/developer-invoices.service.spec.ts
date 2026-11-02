import type { DataSource } from 'typeorm';
import type { AuthContext } from '../auth/auth.types';
import type { IdempotencyService } from '../idempotency/idempotency.service';
import type { CreateInvoiceDto } from '../invoices/dto/invoice.dto';
import type { InvoicesService } from '../invoices/invoices.service';
import { DeveloperInvoicesService } from './developer-invoices.service';
import { encodeCursor } from './developer.view';

const ctx: AuthContext = { userId: '', merchantId: 'm-1', role: 'OWNER', via: 'api-key', scopes: ['invoices:write'] };
const dto = { amount: 25000, qrisId: 'q-1' } as unknown as CreateInvoiceDto;
const invoiceRow = (n: number) => ({
  id: `3f2c1b0a-1111-4222-8333-4444555566${String(n).padStart(2, '0')}`,
  publicId: `INV-ABCDEFGHJK${String(n).padStart(2, '0')}`,
  amount: '1000',
  currency: 'IDR',
  description: null,
  status: 'PENDING',
  createdAt: new Date('2026-11-02T10:00:00Z'),
  expiresAt: new Date('2026-11-02T11:00:00Z'),
  paidAt: null,
  cursorTs: `2026-11-02T10:00:00.1234${String(n).padStart(2, '0')}Z`,
});
const created = {
  publicId: 'INV-ABCDEFGHJKMN',
  amount: 25000,
  currency: 'IDR',
  description: null,
  status: 'PENDING',
  createdAt: '2026-11-02T10:00:00.000Z',
  expiresAt: '2026-11-02T11:00:00.000Z',
  paidAt: null,
};

function build(opts: { begin?: unknown; createImpl?: () => Promise<unknown>; rows?: unknown[] } = {}) {
  const invoices = {
    create: jest.fn(opts.createImpl ?? (async () => created)),
    findOwned: jest.fn(async () => ({ ...created, publicId: 'INV-ORIGINALAAAA' })),
    sweepExpired: jest.fn(async () => 0),
  };
  const idem = {
    begin: jest.fn(async () => opts.begin ?? { kind: 'owner', recordId: 'rec-1' }),
    completeInTransaction: jest.fn(async () => undefined),
    abandon: jest.fn(async () => undefined),
  };
  const query = jest.fn(async () => opts.rows ?? []);
  const service = new DeveloperInvoicesService(
    invoices as unknown as InvoicesService,
    idem as unknown as IdempotencyService,
    { query } as unknown as DataSource,
  );
  return { service, invoices, idem, query };
}

describe('DeveloperInvoicesService.create', () => {
  it('without a key it just delegates to the V2 service (no idempotency record)', async () => {
    const { service, idem, invoices } = build();
    const result = await service.create(ctx, dto, null);
    expect(result).toMatchObject({ created: true, invoice: { reference: 'INV-ABCDEFGHJKMN', amount: 25000, status: 'PENDING' } });
    expect(idem.begin).not.toHaveBeenCalled();
    expect(invoices.create).toHaveBeenCalledWith(ctx, dto, undefined);
  });

  it('with a key it completes the record in the invoice transaction', async () => {
    const { service, idem, invoices } = build();
    await service.create(ctx, dto, 'order-12345678');
    const hooks = (invoices.create.mock.calls[0] as unknown[])[2] as {
      inTransaction: (m: unknown, i: { id: string; publicId: string }) => Promise<void>;
    };
    const manager = { tx: true };
    await hooks.inTransaction(manager, { id: 'inv-1', publicId: 'INV-X' });
    expect(idem.completeInTransaction).toHaveBeenCalledWith(manager, 'rec-1', 'inv-1');
  });

  it('replays the original invoice without creating another', async () => {
    const { service, invoices } = build({ begin: { kind: 'replay', invoiceId: 'inv-9' } });
    const result = await service.create(ctx, dto, 'order-12345678');
    expect(result.created).toBe(false);
    expect(result.invoice.reference).toBe('INV-ORIGINALAAAA');
    expect(invoices.create).not.toHaveBeenCalled();
    expect(invoices.findOwned).toHaveBeenCalledWith('m-1', 'inv-9');
  });

  it('frees the key when creation fails, so the client can retry', async () => {
    const { service, idem } = build({
      createImpl: async () => {
        throw new Error('engine down');
      },
    });
    await expect(service.create(ctx, dto, 'order-12345678')).rejects.toThrow('engine down');
    expect(idem.abandon).toHaveBeenCalledWith('rec-1');
  });

  it('still surfaces the original error if releasing the key also fails', async () => {
    const { service, idem } = build({
      createImpl: async () => {
        throw new Error('engine down');
      },
    });
    idem.abandon.mockRejectedValueOnce(new Error('db down'));
    await expect(service.create(ctx, dto, 'order-12345678')).rejects.toThrow('engine down');
  });
});

describe('DeveloperInvoicesService.get', () => {
  it.each(['not-a-reference', '3f2c1b0a-1111-4222-8333-444455556666', 'inv-abcdefghjkmn', 'INV-SHORT'])(
    'answers a uniform 404 for %j without touching the database',
    async (reference) => {
      const { service, invoices } = build();
      await expect(service.get(ctx, reference)).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } });
      expect(invoices.findOwned).not.toHaveBeenCalled();
    },
  );

  it('is merchant-scoped', async () => {
    const { service, invoices } = build();
    await service.get(ctx, 'INV-ABCDEFGHJKMN');
    expect(invoices.findOwned).toHaveBeenCalledWith('m-1', 'INV-ABCDEFGHJKMN');
  });
});

describe('DeveloperInvoicesService.list', () => {
  it('scopes by merchant, orders deterministically and fetches limit+1', async () => {
    const { service, query } = build({ rows: [] });
    await service.list(ctx, { limit: 2 });
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('i."merchantId" = $1');
    expect(sql).toContain('ORDER BY i."createdAt" DESC, i."id" DESC');
    expect(params[0]).toBe('m-1');
    expect(params[params.length - 1]).toBe(3);
  });

  it('returns a nextCursor only when there are more rows, and it resumes after the last item', async () => {
    const rows = [invoiceRow(3), invoiceRow(2), invoiceRow(1)];
    const { service, query } = build({ rows });
    const page = await service.list(ctx, { limit: 2 });
    expect(page.items.map((i) => i.reference)).toEqual(['INV-ABCDEFGHJK03', 'INV-ABCDEFGHJK02']);
    expect(page.nextCursor).toBe(encodeCursor({ t: rows[1].cursorTs, id: rows[1].id }));

    query.mockResolvedValueOnce([invoiceRow(1)]);
    await service.list(ctx, { limit: 2, cursor: page.nextCursor as string });
    const [sql, params] = query.mock.calls[1] as unknown as [string, unknown[]];
    expect(sql).toMatch(/\(i\."createdAt", i\."id"\) < \(\$\d+::timestamptz, \$\d+::uuid\)/);
    expect(params).toContain(rows[1].cursorTs);
    expect(params).toContain(rows[1].id);
  });

  it('no nextCursor on the last page', async () => {
    const { service } = build({ rows: [invoiceRow(1)] });
    expect((await service.list(ctx, { limit: 2 })).nextCursor).toBeNull();
  });

  it('never interpolates user input into SQL (filters are bound parameters)', async () => {
    const { service, query } = build({ rows: [] });
    await service.list(ctx, { status: 'PAID', createdBefore: '2026-11-02T00:00:00Z', createdAfter: '2026-10-01T00:00:00Z' });
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).not.toMatch(/PAID|2026/);
    expect(params).toEqual(expect.arrayContaining(['PAID', '2026-11-02T00:00:00.000Z', '2026-10-01T00:00:00.000Z']));
  });

  it('rejects a tampered cursor with 400 INVALID_CURSOR before querying', async () => {
    const { service, query } = build();
    await expect(service.list(ctx, { cursor: 'x'.repeat(30) })).rejects.toMatchObject({ response: { code: 'INVALID_CURSOR' } });
    expect(query).not.toHaveBeenCalled();
  });

  it('clamps the page size to 1..50', async () => {
    const { service, query } = build();
    await service.list(ctx, { limit: 9999 });
    expect((query.mock.calls[0] as unknown as [string, unknown[]])[1].slice(-1)[0]).toBe(51);
    await service.list(ctx, { limit: 0 });
    expect((query.mock.calls[1] as unknown as [string, unknown[]])[1].slice(-1)[0]).toBe(2);
  });
});
