import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { newApiKey } from '../auth/tokens';
import type { ApiKeyScope } from '../auth/scopes';
import { ApiKey } from '../entities/api-key.entity';

export interface NewKeyInput {
  merchantId: string;
  name: string;
  scopes: ApiKeyScope[];
  expiresAt: Date | null;
  createdByUserId: string | null;
}

export type ApiKeyStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED';

export function keyStatus(key: Pick<ApiKey, 'revokedAt' | 'expiresAt'>, now: Date = new Date()): ApiKeyStatus {
  if (key.revokedAt) return 'REVOKED';
  if (key.expiresAt && key.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  return 'ACTIVE';
}

@Injectable()
export class ApiKeysService {
  constructor(
    @InjectRepository(ApiKey) private readonly keys: Repository<ApiKey>,
    private readonly dataSource: DataSource,
  ) {}

  async list(merchantId: string): Promise<ApiKey[]> {
    return this.keys.find({ where: { merchantId }, order: { createdAt: 'DESC' } });
  }

  /** Returns the plaintext key exactly once; only the SHA-256 hash is persisted. */
  async create(input: NewKeyInput): Promise<{ key: ApiKey; plaintext: string }> {
    return this.insertKey(this.keys, input, null);
  }

  /** Idempotent: revoking an already revoked key keeps the original revocation time. */
  async revoke(merchantId: string, id: string, actorUserId: string | null): Promise<void> {
    const revoked = await this.keys
      .createQueryBuilder()
      .update(ApiKey)
      .set({ revokedAt: () => 'now()', revokedByUserId: actorUserId })
      .where('"id" = :id AND "merchantId" = :merchantId AND "revokedAt" IS NULL', { id, merchantId })
      .execute();
    if ((revoked.affected ?? 0) > 0) return;

    const existing = await this.keys.findOne({ where: { id, merchantId } });
    if (!existing) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'API key not found.' });
    }
  }

  /**
   * Atomic: the old key dies and the new one is born in ONE transaction, with the same
   * name, scopes and expiry. No grace period: the old key stops working immediately.
   * A revoked or expired key cannot be rotated (it must never quietly come back to life).
   */
  async rotate(
    merchantId: string,
    id: string,
    actorUserId: string | null,
  ): Promise<{ key: ApiKey; plaintext: string }> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(ApiKey);
      const existing = await repo.findOne({ where: { id, merchantId }, lock: { mode: 'pessimistic_write' } });
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'API key not found.' });
      }
      const status = keyStatus(existing);
      if (status === 'REVOKED') {
        throw new ConflictException({ code: 'API_KEY_REVOKED', message: 'A revoked key cannot be rotated. Create a new key.' });
      }
      if (status === 'EXPIRED') {
        throw new ConflictException({ code: 'API_KEY_EXPIRED', message: 'An expired key cannot be rotated. Create a new key.' });
      }

      existing.revokedAt = new Date();
      existing.revokedByUserId = actorUserId;
      await repo.save(existing);

      return this.insertKey(
        repo,
        {
          merchantId,
          name: existing.name,
          scopes: existing.scopes as ApiKeyScope[],
          expiresAt: existing.expiresAt,
          createdByUserId: actorUserId,
        },
        existing.id,
      );
    });
  }

  private async insertKey(
    repo: Repository<ApiKey>,
    input: NewKeyInput,
    rotatedFromId: string | null,
  ): Promise<{ key: ApiKey; plaintext: string }> {
    const { plaintext, hash, prefix } = newApiKey();
    const key = await repo.save(
      repo.create({
        merchantId: input.merchantId,
        name: input.name.trim().slice(0, 60) || 'API key',
        prefix,
        keyHash: hash,
        scopes: input.scopes,
        expiresAt: input.expiresAt,
        createdByUserId: input.createdByUserId,
        rotatedFromId,
      }),
    );
    return { key, plaintext };
  }
}
