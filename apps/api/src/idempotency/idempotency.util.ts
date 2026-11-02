import { sha256 } from '../auth/tokens';

export const OPERATION_INVOICE_CREATE = 'invoice.create';
export const IDEMPOTENCY_RETENTION_HOURS = 24;
/** An IN_PROGRESS record older than this is considered abandoned and may be taken over. */
export const IN_PROGRESS_STALE_SECONDS = 120;

const KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/;

export class IdempotencyInputError extends Error {
  readonly code = 'INVALID_IDEMPOTENCY_KEY';
}

/** `undefined` when the header is absent. Throws for a malformed key (never silently ignored). */
export function parseIdempotencyKey(header: string | undefined): string | null {
  if (header === undefined) return null;
  const key = header.trim();
  if (!KEY_PATTERN.test(key)) {
    throw new IdempotencyInputError('Idempotency-Key must be 8-128 characters of A-Z a-z 0-9 _ . : -');
  }
  return key;
}

export function hashIdempotencyKey(key: string): string {
  return sha256(key);
}

export interface InvoiceCreateFingerprintInput {
  amount: unknown;
  description?: unknown;
  qrisId: unknown;
  expiresInMinutes?: unknown;
}

/**
 * Fingerprint of the NORMALIZED request: field order and insignificant formatting do not
 * matter ("25000" and 25000 are the same request), a materially different request does.
 */
export function fingerprintInvoiceCreate(input: InvoiceCreateFingerprintInput): string {
  const description = typeof input.description === 'string' ? input.description.trim() : null;
  const canonical = JSON.stringify([
    OPERATION_INVOICE_CREATE,
    Number(input.amount),
    String(input.qrisId ?? '').toLowerCase(),
    description === '' ? null : description,
    input.expiresInMinutes === undefined || input.expiresInMinutes === null ? null : Number(input.expiresInMinutes),
  ]);
  return sha256(canonical);
}
