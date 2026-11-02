import type { DataSource, Repository } from 'typeorm';
import { sha256 } from '../auth/tokens';
import type { ApiKey } from '../entities/api-key.entity';
import { ApiKeysService, keyStatus } from './api-keys.service';

type Row = Partial<ApiKey> & { id: string };

function fakeRepo(initial: Row[] = []) {
  const rows: Row[] = [...initial];
  let seq = 0;
  const repo = {
    rows,
    create: (obj: Partial<ApiKey>) => ({ revokedAt: null, revokedByUserId: null, lastUsedAt: null, createdAt: new Date(), ...obj }) as Row,
    save: jest.fn(async (obj: Row) => {
      if (!obj.id) obj.id = `key-new-${(seq += 1)}`;
      const at = rows.findIndex((r) => r.id === obj.id);
      if (at >= 0) rows[at] = obj;
      else rows.push(obj);
      return obj;
    }),
    findOne: jest.fn(async (opts: { where: { id: string; merchantId: string } }) =>
      rows.find((r) => r.id === opts.where.id && r.merchantId === opts.where.merchantId) ?? null,
    ),
    find: jest.fn(async () => rows),
  };
  return repo;
}

function build(initial: Row[] = []) {
  const repo = fakeRepo(initial);
  const manager = { getRepository: () => repo };
  const dataSource = {
    transaction: jest.fn(async (cb: (m: unknown) => Promise<unknown>) => cb(manager)),
  } as unknown as DataSource;
  return { service: new ApiKeysService(repo as unknown as Repository<ApiKey>, dataSource), repo, dataSource };
}

const base = { merchantId: 'm-1', name: 'Backend', scopes: ['invoices:read', 'invoices:write'], expiresAt: null as Date | null };

describe('ApiKeysService', () => {
  it('stores only the SHA-256 hash and returns the plaintext once', async () => {
    const { service, repo } = build();
    const { key, plaintext } = await service.create({ ...base, scopes: ['invoices:read'], createdByUserId: 'u-1' });
    expect(plaintext).toMatch(/^kp_live_[0-9a-f]{48}$/);
    expect(key.keyHash).toBe(sha256(plaintext));
    expect(key.keyHash).not.toBe(plaintext);
    expect(JSON.stringify(repo.rows)).not.toContain(plaintext);
    expect(key.prefix).toBe(plaintext.slice(0, 14));
    expect(key).toMatchObject({ scopes: ['invoices:read'], createdByUserId: 'u-1', rotatedFromId: null });
  });

  describe('rotate', () => {
    const existing = (over: Partial<ApiKey> = {}): Row => ({
      id: 'old',
      merchantId: 'm-1',
      name: 'Backend',
      scopes: ['invoices:read'],
      expiresAt: null,
      revokedAt: null,
      ...over,
    });

    it('is atomic: revokes the old key and issues the new one with the same scopes and expiry', async () => {
      const expiresAt = new Date(Date.now() + 86_400_000);
      const { service, repo, dataSource } = build([existing({ expiresAt, scopes: ['invoices:read', 'qr:convert'] })]);
      const { key, plaintext } = await service.rotate('m-1', 'old', 'u-9');
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      const old = repo.rows.find((r) => r.id === 'old');
      expect(old?.revokedAt).toBeInstanceOf(Date);
      expect(old?.revokedByUserId).toBe('u-9');
      expect(key).toMatchObject({
        merchantId: 'm-1',
        scopes: ['invoices:read', 'qr:convert'],
        expiresAt,
        rotatedFromId: 'old',
        createdByUserId: 'u-9',
      });
      expect(key.keyHash).toBe(sha256(plaintext));
      expect(keyStatus(old as ApiKey)).toBe('REVOKED');
    });

    it('cannot rotate another merchant key (404, no existence leak)', async () => {
      const { service, repo } = build([existing()]);
      await expect(service.rotate('m-2', 'old', 'u')).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } });
      expect(repo.rows).toHaveLength(1);
      expect(repo.rows[0].revokedAt).toBeNull();
    });

    it('refuses to resurrect a revoked key (409) and creates nothing', async () => {
      const { service, repo } = build([existing({ revokedAt: new Date() })]);
      await expect(service.rotate('m-1', 'old', 'u')).rejects.toMatchObject({ response: { code: 'API_KEY_REVOKED' } });
      expect(repo.rows).toHaveLength(1);
    });

    it('refuses to rotate an expired key (409) instead of silently dropping its expiry', async () => {
      const { service, repo } = build([existing({ expiresAt: new Date(Date.now() - 1000) })]);
      await expect(service.rotate('m-1', 'old', 'u')).rejects.toMatchObject({ response: { code: 'API_KEY_EXPIRED' } });
      expect(repo.rows).toHaveLength(1);
    });
  });

  describe('keyStatus', () => {
    it('derives REVOKED > EXPIRED > ACTIVE', () => {
      const past = new Date(Date.now() - 1000);
      const future = new Date(Date.now() + 60_000);
      expect(keyStatus({ revokedAt: past, expiresAt: future })).toBe('REVOKED');
      expect(keyStatus({ revokedAt: null, expiresAt: past })).toBe('EXPIRED');
      expect(keyStatus({ revokedAt: null, expiresAt: future })).toBe('ACTIVE');
      expect(keyStatus({ revokedAt: null, expiresAt: null })).toBe('ACTIVE');
    });
  });
});
