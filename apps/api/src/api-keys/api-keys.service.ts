import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { newApiKey } from '../auth/tokens';
import { ApiKey } from '../entities/api-key.entity';

@Injectable()
export class ApiKeysService {
  constructor(@InjectRepository(ApiKey) private readonly keys: Repository<ApiKey>) {}

  async list(merchantId: string): Promise<ApiKey[]> {
    return this.keys.find({ where: { merchantId }, order: { createdAt: 'DESC' } });
  }

  /** Returns the plaintext key exactly once; only the hash is persisted. */
  async create(merchantId: string, name: string): Promise<{ key: ApiKey; plaintext: string }> {
    const { plaintext, hash, prefix } = newApiKey();
    const key = await this.keys.save(
      this.keys.create({ merchantId, name: name.trim().slice(0, 60) || 'API key', keyHash: hash, prefix }),
    );
    return { key, plaintext };
  }

  async revoke(merchantId: string, id: string): Promise<void> {
    const key = await this.keys.findOne({ where: { id, merchantId } });
    if (!key) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'API key not found.' });
    }
    key.revokedAt = new Date();
    await this.keys.save(key);
  }

  async rotate(merchantId: string, id: string): Promise<{ key: ApiKey; plaintext: string }> {
    const existing = await this.keys.findOne({ where: { id, merchantId } });
    if (!existing) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'API key not found.' });
    }
    existing.revokedAt = new Date();
    await this.keys.save(existing);
    return this.create(merchantId, existing.name);
  }
}
