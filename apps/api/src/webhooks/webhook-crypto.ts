import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Signing secrets must be recoverable (HMAC needs the original value), so they are stored
 * encrypted: AES-256-GCM (authenticated) with a random 96-bit IV per value. The endpoint id
 * is bound as additional authenticated data, so a ciphertext copied onto another endpoint
 * row fails to decrypt. Format: `v1:<iv>:<tag>:<ciphertext>` (base64url). Standard node:crypto only.
 */
const VERSION = 'v1';
const AAD_PREFIX = 'kirana-webhook-secret:v1:';

export class WebhookCryptoError extends Error {}

export function encryptSecret(key: Buffer, plaintext: string, endpointId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(AAD_PREFIX + endpointId, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join(':');
}

export function decryptSecret(key: Buffer, stored: string, endpointId: string): string {
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) throw new WebhookCryptoError('Unsupported secret format.');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'base64url'));
    decipher.setAAD(Buffer.from(AAD_PREFIX + endpointId, 'utf8'));
    decipher.setAuthTag(Buffer.from(parts[2], 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    // Wrong key, tampering or a ciphertext moved to another row: never say which.
    throw new WebhookCryptoError('Secret could not be decrypted.');
  }
}

/** `whsec_` + 256 random bits. The hint (last 4 chars) only helps humans tell secrets apart. */
export function newSigningSecret(): { secret: string; hint: string } {
  const secret = `whsec_${randomBytes(32).toString('base64url')}`;
  return { secret, hint: secret.slice(-4) };
}
