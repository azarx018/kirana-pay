import type { ExecutionContext } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { ApiKey } from '../entities/api-key.entity';
import { ApiKeyOrSessionGuard } from './api-key.guard';
import type { AuthService } from './auth.service';
import type { AuthContext } from './auth.types';
import { sha256 } from './tokens';

const KEY = `kp_live_${'b'.repeat(48)}`;
const row = (over: Partial<ApiKey> = {}): ApiKey =>
  ({
    id: 'key-1',
    merchantId: 'm-1',
    keyHash: sha256(KEY),
    scopes: ['invoices:read'],
    revokedAt: null,
    expiresAt: null,
    ...over,
  }) as ApiKey;

function setup(found: ApiKey | null, session: AuthContext | null = null) {
  const findOne = jest.fn(async () => found);
  const query = jest.fn(async () => undefined);
  const resolveSession = jest.fn(async () => session);
  const guard = new ApiKeyOrSessionGuard(
    { findOne, query } as unknown as Repository<ApiKey>,
    { resolveSession } as unknown as AuthService,
  );
  const run = async (headers: Record<string, string>, extra: Record<string, unknown> = {}) => {
    const req: Record<string, unknown> = {
      header: (n: string) => headers[n.toLowerCase()],
      cookies: {},
      ...extra,
    };
    const ok = await guard.canActivate({ switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext);
    return { ok, auth: req.auth as AuthContext | undefined };
  };
  return { run, findOne, query, resolveSession };
}

describe('ApiKeyOrSessionGuard', () => {
  it('authenticates a valid key as its merchant, with its scopes, via Bearer or x-api-key', async () => {
    const variants: Array<Record<string, string>> = [{ authorization: `Bearer ${KEY}` }, { 'x-api-key': KEY }];
    for (const headers of variants) {
      const { run, findOne } = setup(row());
      const { auth } = await run(headers);
      expect(auth).toMatchObject({ merchantId: 'm-1', via: 'api-key', apiKeyId: 'key-1', scopes: ['invoices:read'] });
      expect(findOne).toHaveBeenCalledWith({ where: { keyHash: sha256(KEY) } });
    }
  });

  it('looks the key up by hash and never queries with the plaintext', async () => {
    const { run, findOne } = setup(row());
    await run({ 'x-api-key': KEY });
    expect(JSON.stringify(findOne.mock.calls)).not.toContain(KEY);
  });

  it.each([
    ['unknown key', null],
    ['revoked key', row({ revokedAt: new Date() })],
    ['expired key', row({ expiresAt: new Date(Date.now() - 1000) })],
  ])('answers the same generic 401 for %s', async (_n, found) => {
    const { run } = setup(found);
    await expect(run({ 'x-api-key': KEY })).rejects.toMatchObject({
      response: { code: 'UNAUTHORIZED', message: 'Invalid, revoked or expired API key.' },
    });
  });

  it('accepts a key whose expiry is still in the future', async () => {
    const { run } = setup(row({ expiresAt: new Date(Date.now() + 60_000) }));
    await expect(run({ 'x-api-key': KEY })).resolves.toMatchObject({ ok: true });
  });

  it('rejects ambiguous or oversized credentials without touching the database', async () => {
    const { run, findOne } = setup(row());
    await expect(run({ authorization: `Bearer ${KEY}`, 'x-api-key': `${KEY}z` })).rejects.toMatchObject({
      response: { code: 'UNAUTHORIZED' },
    });
    await expect(run({ 'x-api-key': 'k'.repeat(500) })).rejects.toMatchObject({ response: { code: 'UNAUTHORIZED' } });
    expect(findOne).not.toHaveBeenCalled();
  });

  it('ignores a key passed in the query string or body', async () => {
    const { run, findOne } = setup(row());
    await expect(run({}, { query: { api_key: KEY, apiKey: KEY }, body: { apiKey: KEY } })).rejects.toMatchObject({
      response: { code: 'UNAUTHORIZED', message: 'Login required.' },
    });
    expect(findOne).not.toHaveBeenCalled();
  });

  it('refreshes last-used with a conditional UPDATE (at most every 5 minutes), without the key', async () => {
    const { run, query } = setup(row());
    await run({ 'x-api-key': KEY });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/"lastUsedAt" IS NULL OR "lastUsedAt" < now\(\) - interval '5 minutes'/);
    expect(params).toEqual(['key-1']);
    expect(JSON.stringify([sql, params])).not.toContain(KEY);
  });

  it('does not fail the request if the last-used refresh fails', async () => {
    const { run, query } = setup(row());
    query.mockRejectedValueOnce(new Error('db down'));
    await expect(run({ 'x-api-key': KEY })).resolves.toMatchObject({ ok: true });
  });

  it('falls back to the dashboard session when no key is sent', async () => {
    const session: AuthContext = { userId: 'u', merchantId: 'm-2', role: 'STAFF', via: 'session' };
    const { run, findOne } = setup(null, session);
    const { auth } = await run({});
    expect(auth).toEqual(session);
    expect(findOne).not.toHaveBeenCalled();
  });
});
