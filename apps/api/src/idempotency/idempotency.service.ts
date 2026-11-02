import { ConflictException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  IDEMPOTENCY_RETENTION_HOURS,
  IN_PROGRESS_STALE_SECONDS,
  hashIdempotencyKey,
} from './idempotency.util';

export type IdempotencyStart =
  | { kind: 'owner'; recordId: string }
  | { kind: 'replay'; invoiceId: string };

interface ExistingRow {
  id: string;
  fingerprint: string;
  state: 'IN_PROGRESS' | 'COMPLETED';
  invoiceId: string | null;
  expired: boolean;
  stale: boolean;
}

/** TypeORM returns [rows, count] for UPDATE/DELETE and plain rows for SELECT/INSERT. */
function rowsOf<T>(result: unknown): T[] {
  if (!Array.isArray(result)) return [];
  if (result.length === 2 && Array.isArray(result[0]) && typeof result[1] === 'number') {
    return result[0] as T[];
  }
  return result as T[];
}

function inProgress(): ConflictException {
  return new ConflictException({
    code: 'IDEMPOTENCY_IN_PROGRESS',
    message: 'A request with this Idempotency-Key is still being processed. Retry shortly.',
  });
}

const MAX_ATTEMPTS = 4;

@Injectable()
export class IdempotencyService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Claims the (merchant, operation, key) slot. Exactly one concurrent caller becomes the
   * `owner` (the unique index decides); the others replay, conflict or are told to retry.
   */
  async begin(merchantId: string, operation: string, key: string, fingerprint: string): Promise<IdempotencyStart> {
    const keyHash = hashIdempotencyKey(key);

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const inserted = rowsOf<{ id: string }>(
        await this.dataSource.query(
          `INSERT INTO "idempotency_records" ("merchantId", "operation", "keyHash", "fingerprint", "expiresAt")
           VALUES ($1, $2, $3, $4, now() + interval '${IDEMPOTENCY_RETENTION_HOURS} hours')
           ON CONFLICT ("merchantId", "operation", "keyHash") DO NOTHING
           RETURNING "id"`,
          [merchantId, operation, keyHash, fingerprint],
        ),
      );
      if (inserted.length > 0) return { kind: 'owner', recordId: inserted[0].id };

      const existing = rowsOf<ExistingRow>(
        await this.dataSource.query(
          `SELECT "id", "fingerprint", "state", "invoiceId",
                  ("expiresAt" <= now()) AS "expired",
                  ("createdAt" < now() - interval '${IN_PROGRESS_STALE_SECONDS} seconds') AS "stale"
             FROM "idempotency_records"
            WHERE "merchantId" = $1 AND "operation" = $2 AND "keyHash" = $3`,
          [merchantId, operation, keyHash],
        ),
      )[0];
      if (!existing) continue; // removed in between: try to claim again

      if (existing.expired) {
        await this.dataSource.query(`DELETE FROM "idempotency_records" WHERE "id" = $1 AND "expiresAt" <= now()`, [
          existing.id,
        ]);
        continue;
      }
      if (existing.fingerprint.trim() !== fingerprint) {
        throw new ConflictException({
          code: 'IDEMPOTENCY_CONFLICT',
          message: 'This Idempotency-Key was already used with a different request.',
        });
      }
      if (existing.state === 'COMPLETED' && existing.invoiceId) {
        return { kind: 'replay', invoiceId: existing.invoiceId };
      }
      if (existing.stale) {
        const taken = rowsOf<{ id: string }>(
          await this.dataSource.query(
            `UPDATE "idempotency_records" SET "createdAt" = now()
              WHERE "id" = $1 AND "state" = 'IN_PROGRESS'
                AND "createdAt" < now() - interval '${IN_PROGRESS_STALE_SECONDS} seconds'
            RETURNING "id"`,
            [existing.id],
          ),
        );
        if (taken.length > 0) return { kind: 'owner', recordId: existing.id };
        continue;
      }
      throw inProgress();
    }
    throw inProgress();
  }

  /**
   * Runs INSIDE the invoice-creating transaction: the record becomes COMPLETED if and only
   * if the invoice commits. If another request took the slot over meanwhile, abort (rollback)
   * rather than create a duplicate.
   */
  async completeInTransaction(manager: EntityManager, recordId: string, invoiceId: string): Promise<void> {
    const done = rowsOf<{ id: string }>(
      await manager.query(
        `UPDATE "idempotency_records"
            SET "state" = 'COMPLETED', "invoiceId" = $2, "completedAt" = now()
          WHERE "id" = $1 AND "state" = 'IN_PROGRESS'
        RETURNING "id"`,
        [recordId, invoiceId],
      ),
    );
    if (done.length === 0) throw inProgress();
  }

  /** The operation failed before committing: free the key so the client can retry. */
  async abandon(recordId: string): Promise<void> {
    await this.dataSource.query(`DELETE FROM "idempotency_records" WHERE "id" = $1 AND "state" = 'IN_PROGRESS'`, [
      recordId,
    ]);
  }

  async purgeExpired(limit = 500): Promise<number> {
    const rows = rowsOf<{ id: string }>(
      await this.dataSource.query(
        `DELETE FROM "idempotency_records"
          WHERE "id" IN (SELECT "id" FROM "idempotency_records" WHERE "expiresAt" < now() LIMIT $1)
        RETURNING "id"`,
        [limit],
      ),
    );
    return rows.length;
  }
}
