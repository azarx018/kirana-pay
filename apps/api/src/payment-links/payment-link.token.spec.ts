import { buildToken, newNonce, TOKEN_LENGTH, verifyToken } from './payment-link.token';

const SECRET = 'a'.repeat(40);

describe('payment link token', () => {
  it('round-trips: a built token verifies back to its nonce', () => {
    const nonce = newNonce();
    const token = buildToken(SECRET, nonce);
    expect(token).toHaveLength(TOKEN_LENGTH);
    expect(token).toMatch(/^[A-Za-z0-9_-]{44}$/);
    expect(verifyToken(SECRET, token)).toBe(nonce);
  });

  it('is deterministic per nonce, so the URL can be shown again later', () => {
    const nonce = newNonce();
    expect(buildToken(SECRET, nonce)).toBe(buildToken(SECRET, nonce));
  });

  it('generates unique, unrelated nonces', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i += 1) seen.add(newNonce());
    expect(seen.size).toBe(2000);
  });

  it('rejects a token signed with another secret', () => {
    const token = buildToken(SECRET, newNonce());
    expect(verifyToken('b'.repeat(40), token)).toBeNull();
  });

  it('rejects a tampered nonce or mac in every position', () => {
    const token = buildToken(SECRET, newNonce());
    for (let i = 0; i < token.length; i += 1) {
      const swapped = token[i] === 'A' ? 'B' : 'A';
      const bad = token.slice(0, i) + swapped + token.slice(i + 1);
      expect(verifyToken(SECRET, bad)).toBeNull();
    }
  });

  it('rejects malformed input without throwing', () => {
    const good = buildToken(SECRET, newNonce());
    const cases: unknown[] = [
      '',
      'short',
      good + 'x',
      good.slice(1),
      `${good.slice(0, 43)}!`,
      `${good.slice(0, 43)}=`,
      `../${good}`,
      undefined,
      null,
      42,
      { toString: () => good },
      'A'.repeat(100_000),
    ];
    for (const input of cases) expect(verifyToken(SECRET, input)).toBeNull();
  });

  it('does not accept an invoice-like or sequential identifier', () => {
    expect(verifyToken(SECRET, 'INV-ABCDEFGHJKMN')).toBeNull();
    expect(verifyToken(SECRET, '1'.repeat(44))).toBeNull();
  });
});
