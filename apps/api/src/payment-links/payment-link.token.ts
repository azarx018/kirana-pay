import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Payment link token = nonce (16 random bytes) + mac (HMAC-SHA256 truncated to 16 bytes),
 * both base64url, 22 chars each => 44 chars.
 *
 * Only the nonce is stored. The mac needs PAYMENT_LINK_SECRET, so a database leak alone
 * cannot produce a working URL, and the merchant can still re-copy the URL later.
 * The mac is checked BEFORE any database lookup. Standard node:crypto primitives only.
 */
const NONCE_BYTES = 16;
const MAC_BYTES = 16;
const PART_LENGTH = 22; // base64url length of 16 bytes (no padding)
export const TOKEN_LENGTH = PART_LENGTH * 2;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{44}$/;
const DOMAIN = 'kp-payment-link:v1:';

function macFor(secret: string, nonce: string): string {
  return createHmac('sha256', secret)
    .update(DOMAIN + nonce)
    .digest()
    .subarray(0, MAC_BYTES)
    .toString('base64url');
}

export function newNonce(): string {
  return randomBytes(NONCE_BYTES).toString('base64url');
}

export function buildToken(secret: string, nonce: string): string {
  return nonce + macFor(secret, nonce);
}

/** Returns the nonce when the token is well-formed and authentic, otherwise null. */
export function verifyToken(secret: string, token: unknown): string | null {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return null;
  const nonce = token.slice(0, PART_LENGTH);
  const given = Buffer.from(token.slice(PART_LENGTH), 'utf8');
  const expected = Buffer.from(macFor(secret, nonce), 'utf8');
  // Compared as the canonical base64url text (not decoded bytes), so there is exactly
  // one valid spelling per link and no malleable variants.
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return nonce;
}
