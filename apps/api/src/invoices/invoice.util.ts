/** Pure helpers for invoice creation (unit-tested without a database). */

/** Crockford-ish base32: no I, L, O, U so IDs survive being read aloud/typed. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const PUBLIC_ID_BODY_LENGTH = 12;
const PUBLIC_ID_PREFIX = 'INV-';

export const DEFAULT_EXPIRY_MINUTES = 60;
export const MIN_EXPIRY_MINUTES = 5;
export const MAX_EXPIRY_MINUTES = 7 * 24 * 60;

export interface ExpiryPolicy {
  defaultMinutes: number;
  minMinutes: number;
  maxMinutes: number;
}

export const DEFAULT_EXPIRY_POLICY: ExpiryPolicy = {
  defaultMinutes: DEFAULT_EXPIRY_MINUTES,
  minMinutes: MIN_EXPIRY_MINUTES,
  maxMinutes: MAX_EXPIRY_MINUTES,
};

export class InvoiceInputError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Encode 8 random bytes into 12 Crockford base32 chars (60 bits of entropy). */
export function encodePublicIdBody(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += ALPHABET[(value << (5 - bits)) & 31];
  }
  return out.slice(0, PUBLIC_ID_BODY_LENGTH);
}

export function buildPublicId(bytes: Buffer): string {
  if (bytes.length !== 8) {
    throw new Error('buildPublicId expects exactly 8 random bytes');
  }
  return `${PUBLIC_ID_PREFIX}${encodePublicIdBody(bytes)}`;
}

export function isPublicId(value: string): boolean {
  return /^INV-[0-9A-HJKMNP-TV-Z]{12}$/.test(value);
}

/**
 * Resolve the requested lifetime against the policy. Rejects non-integers so a
 * decimal can never silently round into a different expiry.
 */
export function resolveExpiryMinutes(
  requested: number | undefined,
  policy: ExpiryPolicy = DEFAULT_EXPIRY_POLICY,
): number {
  if (requested === undefined || requested === null) return policy.defaultMinutes;
  if (!Number.isInteger(requested)) {
    throw new InvoiceInputError('INVALID_EXPIRY', 'Expiry must be a whole number of minutes.');
  }
  if (requested < policy.minMinutes) {
    throw new InvoiceInputError(
      'INVALID_EXPIRY',
      `Expiry must be at least ${policy.minMinutes} minutes.`,
    );
  }
  if (requested > policy.maxMinutes) {
    throw new InvoiceInputError(
      'INVALID_EXPIRY',
      `Expiry must be at most ${policy.maxMinutes} minutes.`,
    );
  }
  return requested;
}

export function buildExpiresAt(
  requested: number | undefined,
  policy: ExpiryPolicy = DEFAULT_EXPIRY_POLICY,
  now: Date = new Date(),
): Date {
  const minutes = resolveExpiryMinutes(requested, policy);
  return new Date(now.getTime() + minutes * 60_000);
}

/** Trim + collapse whitespace; empty becomes null. Max 200 chars. */
export function normalizeDescription(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null) return null;
  const value = String(raw).trim().replace(/\s+/g, ' ');
  if (value.length === 0) return null;
  if (value.length > 200) {
    throw new InvoiceInputError('INVALID_DESCRIPTION', 'Description must be at most 200 characters.');
  }
  return value;
}
