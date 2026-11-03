import { randomBytes } from 'node:crypto';
import { WebhookCryptoError, decryptSecret, encryptSecret, newSigningSecret } from './webhook-crypto';

const key = randomBytes(32);
const ID = '3f2c1b0a-1111-4222-8333-444455556666';

describe('webhook secret encryption', () => {
  it('round-trips', () => {
    const { secret } = newSigningSecret();
    expect(decryptSecret(key, encryptSecret(key, secret, ID), ID)).toBe(secret);
  });

  it('never stores the plaintext and uses a fresh IV every time', () => {
    const { secret } = newSigningSecret();
    const a = encryptSecret(key, secret, ID);
    const b = encryptSecret(key, secret, ID);
    expect(a).not.toBe(b);
    expect(a).not.toContain(secret);
    expect(a.startsWith('v1:')).toBe(true);
  });

  it('refuses a wrong key', () => {
    const stored = encryptSecret(key, 'whsec_x', ID);
    expect(() => decryptSecret(randomBytes(32), stored, ID)).toThrow(WebhookCryptoError);
  });

  it('refuses a ciphertext moved to another endpoint row (AAD binding)', () => {
    const stored = encryptSecret(key, 'whsec_x', ID);
    expect(() => decryptSecret(key, stored, '99999999-9999-4999-8999-999999999999')).toThrow(WebhookCryptoError);
  });

  it('detects tampering in every segment', () => {
    const parts = encryptSecret(key, 'whsec_x', ID).split(':');
    for (let i = 1; i < 4; i += 1) {
      const copy = [...parts];
      copy[i] = copy[i].slice(0, -2) + (copy[i].endsWith('AA') ? 'BB' : 'AA');
      expect(() => decryptSecret(key, copy.join(':'), ID)).toThrow(WebhookCryptoError);
    }
  });

  it.each(['', 'plain', 'v2:a:b:c', 'v1:a:b', 'v1:a:b:c:d'])('rejects malformed stored value %j', (value) => {
    expect(() => decryptSecret(key, value, ID)).toThrow(WebhookCryptoError);
  });

  it('error messages never reveal key material or plaintext', () => {
    try {
      decryptSecret(randomBytes(32), encryptSecret(key, 'whsec_topsecret', ID), ID);
    } catch (e) {
      expect((e as Error).message).not.toMatch(/topsecret|whsec/);
    }
  });

  it('generates unique, long secrets with a short hint', () => {
    const a = newSigningSecret();
    const b = newSigningSecret();
    expect(a.secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(a.secret).not.toBe(b.secret);
    expect(a.hint).toBe(a.secret.slice(-4));
  });
});
