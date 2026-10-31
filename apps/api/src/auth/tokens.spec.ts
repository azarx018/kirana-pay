import { newApiKey, newSessionToken, sha256 } from './tokens';

describe('auth tokens', () => {
  it('creates a session token of sufficient entropy and distinct hashes', () => {
    const a = newSessionToken();
    const b = newSessionToken();
    expect(a).not.toEqual(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
    expect(sha256(a)).toHaveLength(64);
    expect(sha256(a)).not.toEqual(sha256(b));
  });

  it('creates api keys with a stable prefix and hashed secret', () => {
    const { plaintext, hash, prefix } = newApiKey();
    expect(plaintext.startsWith('kp_live_')).toBe(true);
    expect(prefix).toBe(plaintext.slice(0, 14));
    expect(hash).toBe(sha256(plaintext));
    expect(hash).toHaveLength(64);
    expect(plaintext.startsWith(hash)).toBe(false);
  });
});
