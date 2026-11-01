import type { DataSource } from 'typeorm';
import type { AuthContext } from '../auth/auth.types';
import type { InvoicesService } from '../invoices/invoices.service';
import type { FileStorage } from '../storage/storage.interface';
import { buildToken } from './payment-link.token';
import { PaymentLinksService } from './payment-links.service';

const SECRET = 's'.repeat(40);
const NONCE = 'N'.repeat(22);
const ctx: AuthContext = { userId: 'user-1', merchantId: 'm-1', role: 'OWNER', via: 'session' };
const future = (): Date => new Date(Date.now() + 3_600_000);

interface FakeInvoice {
  id: string;
  status: string;
  expiresAt: Date;
}

function setup(opts: {
  invoice?: FakeInvoice | 'not-found';
  query?: (sql: string, params: unknown[]) => unknown;
  storage?: Partial<FileStorage>;
}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const dataSource = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return opts.query ? opts.query(sql, params) : [];
    }),
  } as unknown as DataSource;
  const invoices = {
    sweepExpired: jest.fn(async () => 0),
    findOwned: jest.fn(async () => {
      if (opts.invoice === 'not-found') throw new Error('NOT_FOUND');
      return opts.invoice ?? { id: 'inv-1', status: 'PENDING', expiresAt: future() };
    }),
  } as unknown as InvoicesService;
  const storage = {
    read: jest.fn(async () => Buffer.from([1, 2, 3])),
    ...opts.storage,
  } as unknown as FileStorage;
  return { service: new PaymentLinksService(dataSource, invoices, storage), calls, invoices };
}

const linkRow = (over: Record<string, unknown> = {}) => ({
  id: 'link-1',
  tokenNonce: NONCE,
  status: 'ACTIVE',
  createdAt: new Date('2026-11-02T10:00:00Z'),
  revokedAt: null,
  createdByEmail: 'owner@toko.id',
  revokedByEmail: null,
  ...over,
});

describe('PaymentLinksService', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.PAYMENT_LINK_SECRET = SECRET;
    process.env.PUBLIC_BASE_URL = 'https://pay.example.com';
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  describe('create', () => {
    it('503s when not configured in production, before touching any data', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.PAYMENT_LINK_SECRET;
      const { service, calls, invoices } = setup({});
      await expect(service.create(ctx, 'INV-1')).rejects.toMatchObject({
        response: { code: 'PAYMENT_LINK_NOT_CONFIGURED' },
      });
      expect(calls).toHaveLength(0);
      expect(invoices.findOwned).not.toHaveBeenCalled();
    });

    it('propagates "not found" for another merchant invoice and writes nothing', async () => {
      const { service, calls } = setup({ invoice: 'not-found' });
      await expect(service.create(ctx, 'INV-OTHER')).rejects.toThrow('NOT_FOUND');
      expect(calls).toHaveLength(0);
    });

    it('scopes the invoice lookup to the session merchant', async () => {
      const { service, invoices } = setup({
        query: (sql) => (sql.includes('INSERT') ? [{ id: 'link-1' }] : sql.includes(`"status" = 'ACTIVE'`) ? [] : [linkRow()]),
      });
      await service.create(ctx, 'INV-1');
      expect(invoices.findOwned).toHaveBeenCalledWith('m-1', 'INV-1');
    });

    it('rejects a paid invoice (409) and never inserts', async () => {
      const { service, calls } = setup({ invoice: { id: 'inv-1', status: 'PAID', expiresAt: future() } });
      await expect(service.create(ctx, 'INV-1')).rejects.toMatchObject({ response: { code: 'INVOICE_ALREADY_PAID' } });
      expect(calls.some((c) => c.sql.includes('INSERT'))).toBe(false);
    });

    it.each([
      ['EXPIRED status', { id: 'inv-1', status: 'EXPIRED', expiresAt: future() }],
      ['PENDING past expiry', { id: 'inv-1', status: 'PENDING', expiresAt: new Date(Date.now() - 1000) }],
    ])('rejects an expired invoice (410): %s', async (_name, invoice) => {
      const { service, calls } = setup({ invoice });
      await expect(service.create(ctx, 'INV-1')).rejects.toMatchObject({ response: { code: 'INVOICE_EXPIRED' } });
      expect(calls.some((c) => c.sql.includes('INSERT'))).toBe(false);
    });

    it('returns the existing active link instead of creating another (idempotent)', async () => {
      const { service, calls } = setup({ query: () => [linkRow()] });
      const result = await service.create(ctx, 'INV-1');
      expect(result.created).toBe(false);
      expect(result.link.status).toBe('ACTIVE');
      expect(result.link.url).toBe(`https://pay.example.com/pay/${buildToken(SECRET, NONCE)}`);
      expect(calls.some((c) => c.sql.includes('INSERT'))).toBe(false);
    });

    it('creates a link with the session user as creator and a random nonce', async () => {
      const { service, calls } = setup({
        query: (sql) => (sql.includes('INSERT') ? [{ id: 'link-1' }] : sql.includes(`"status" = 'ACTIVE'`) ? [] : [linkRow()]),
      });
      const result = await service.create(ctx, 'INV-1');
      expect(result.created).toBe(true);
      const insert = calls.find((c) => c.sql.includes('INSERT'));
      expect(insert?.params[0]).toBe('inv-1');
      expect(insert?.params[1]).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(insert?.params[2]).toBe('user-1');
      expect(insert?.sql).toContain(`ON CONFLICT ("invoiceId") WHERE "status" = 'ACTIVE' DO NOTHING`);
    });

    it('converges when a concurrent request wins the insert (conflict -> re-read)', async () => {
      let activeReads = 0;
      const { service } = setup({
        query: (sql) => {
          if (sql.includes('INSERT')) return []; // lost the race
          if (sql.includes(`"status" = 'ACTIVE'`)) {
            activeReads += 1;
            return activeReads === 1 ? [] : [linkRow()];
          }
          return [];
        },
      });
      const result = await service.create(ctx, 'INV-1');
      expect(result.created).toBe(false);
      expect(activeReads).toBe(2);
    });

    it('gives up with a clear error instead of looping forever', async () => {
      const { service, calls } = setup({ query: () => [] });
      await expect(service.create(ctx, 'INV-1')).rejects.toMatchObject({ response: { code: 'PAYMENT_LINK_CONFLICT' } });
      expect(calls.filter((c) => c.sql.includes('INSERT'))).toHaveLength(3);
    });
  });

  describe('get / revoke', () => {
    it('get returns { link: null } when none exists', async () => {
      const { service } = setup({ query: () => [] });
      await expect(service.get(ctx, 'INV-1')).resolves.toEqual({ link: null });
    });

    it('get on a revoked link needs no config and exposes no url', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.PAYMENT_LINK_SECRET;
      const { service } = setup({ query: () => [linkRow({ status: 'REVOKED', revokedAt: new Date() })] });
      const { link } = await service.get(ctx, 'INV-1');
      expect(link?.status).toBe('REVOKED');
      expect(link?.url).toBeNull();
    });

    it('revoke returns 404 PAYMENT_LINK_NOT_FOUND when nothing is active', async () => {
      const { service } = setup({ query: () => [[], 0] });
      await expect(service.revoke(ctx, 'INV-1')).rejects.toMatchObject({
        response: { code: 'PAYMENT_LINK_NOT_FOUND' },
      });
    });

    it('revoke records the acting user and returns a url-less REVOKED view', async () => {
      const { service, calls } = setup({
        query: (sql) =>
          sql.startsWith('\n        UPDATE') || sql.includes('UPDATE')
            ? [[{ id: 'link-1' }], 1]
            : [linkRow({ status: 'REVOKED', revokedAt: new Date(), revokedByEmail: 'owner@toko.id' })],
      });
      const { link } = await service.revoke(ctx, 'INV-1');
      expect(link.status).toBe('REVOKED');
      expect(link.url).toBeNull();
      expect(calls.find((c) => c.sql.includes('UPDATE'))?.params).toEqual(['inv-1', 'user-1']);
    });
  });

  describe('resolvePublic', () => {
    const publicRow = (over: Record<string, unknown> = {}) => ({
      linkStatus: 'ACTIVE',
      invoiceStatus: 'PENDING',
      expired: false,
      serverNow: new Date('2026-11-02T10:30:00Z'),
      merchantName: 'Toko Utama',
      publicId: 'INV-ABCDEFGHJKMN',
      description: null,
      amount: '2300',
      currency: 'IDR',
      createdAt: new Date('2026-11-02T10:00:00Z'),
      expiresAt: new Date('2026-11-02T11:00:00Z'),
      paidAt: null,
      qrPath: 'var/qr/x.png',
      ...over,
    });
    const goodToken = (): string => buildToken(SECRET, NONCE);

    it('rejects malformed and forged tokens without any database query', async () => {
      const { service, calls } = setup({});
      for (const bad of ['', 'abc', 'INV-ABCDEFGHJKMN', 'x'.repeat(44), `${NONCE}${'A'.repeat(22)}`]) {
        await expect(service.resolvePublic(bad)).rejects.toMatchObject({ response: { code: 'PAYMENT_LINK_UNAVAILABLE' } });
      }
      expect(calls).toHaveLength(0);
    });

    it('is unavailable (404) for unknown or revoked links, with the same error', async () => {
      const unknown = setup({ query: () => [] });
      await expect(unknown.service.resolvePublic(goodToken())).rejects.toMatchObject({
        response: { code: 'PAYMENT_LINK_UNAVAILABLE' },
      });
      const revoked = setup({ query: () => [publicRow({ linkStatus: 'REVOKED' })] });
      await expect(revoked.service.resolvePublic(goodToken())).rejects.toMatchObject({
        response: { code: 'PAYMENT_LINK_UNAVAILABLE' },
      });
    });

    it('serves the QR while payable', async () => {
      const { service } = setup({ query: () => [publicRow()] });
      const view = await service.resolvePublic(goodToken());
      expect(view.state).toBe('PAYABLE');
      expect(view.qrImageDataUrl).toMatch(/^data:image\/png;base64,/);
      expect(view.invoice.reference).toBe('INV-ABCDEFGHJKMN');
    });

    it.each([
      ['paid', { invoiceStatus: 'PAID', paidAt: new Date() }, 'PAID'],
      ['expired status', { invoiceStatus: 'EXPIRED' }, 'EXPIRED'],
      ['pending but past expiry', { expired: true }, 'EXPIRED'],
    ])('never reads or exposes the QR when %s', async (_n, over, state) => {
      const read = jest.fn(async () => Buffer.from([1]));
      const { service } = setup({ query: () => [publicRow(over)], storage: { read } });
      const view = await service.resolvePublic(goodToken());
      expect(view.state).toBe(state);
      expect(view.qrImageDataUrl).toBeNull();
      expect(read).not.toHaveBeenCalled();
    });

    it('fails safe (503, no details) when the stored QR cannot be read', async () => {
      const { service } = setup({
        query: () => [publicRow()],
        storage: {
          read: jest.fn(async () => {
            throw new Error('ENOENT /secret/path/x.png');
          }),
        },
      });
      const error = await service.resolvePublic(goodToken()).catch((e: unknown) => e);
      expect(error).toMatchObject({ response: { code: 'PAYMENT_LINK_QR_UNAVAILABLE' } });
      expect(JSON.stringify((error as { response: unknown }).response)).not.toContain('secret');
    });

    it('fails safe for an unknown invoice status', async () => {
      const { service } = setup({ query: () => [publicRow({ invoiceStatus: 'CANCELLED' })] });
      await expect(service.resolvePublic(goodToken())).rejects.toMatchObject({
        response: { code: 'PAYMENT_LINK_UNAVAILABLE' },
      });
    });

    it('is strictly read-only: no INSERT/UPDATE/DELETE is ever issued', async () => {
      const { service, calls } = setup({ query: () => [publicRow({ expired: true })] });
      await service.resolvePublic(goodToken());
      expect(calls).toHaveLength(1);
      expect(calls[0].sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
    });
  });
});
