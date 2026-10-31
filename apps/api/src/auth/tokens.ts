import { createHash, randomBytes } from 'node:crypto';

export const SESSION_COOKIE = 'kirana_session';
export const SESSION_TTL_DAYS = 14;

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** API keys look like `kp_live_<32 hex>`; only the hash is stored. */
export function newApiKey(): { plaintext: string; hash: string; prefix: string } {
  const secret = randomBytes(24).toString('hex');
  const plaintext = `kp_live_${secret}`;
  return { plaintext, hash: sha256(plaintext), prefix: plaintext.slice(0, 14) };
}
