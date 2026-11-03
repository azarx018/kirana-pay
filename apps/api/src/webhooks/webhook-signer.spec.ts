import { createHmac } from 'node:crypto';
import { buildWebhookHeaders, signPayload, verifyWebhookSignature } from './webhook-signer';

const SECRET = 'whsec_test_secret_value';
const BODY = '{"id":"evt_1","type":"invoice.paid"}';

describe('webhook signing', () => {
  it('is HMAC-SHA256 over "<timestamp>.<rawBody>" in v1=<hex> form', () => {
    const expected = createHmac('sha256', SECRET).update(`1700000000.${BODY}`).digest('hex');
    expect(signPayload(SECRET, 1_700_000_000, BODY)).toBe(`v1=${expected}`);
  });

  it('depends on the exact body bytes, the timestamp and the secret', () => {
    const base = signPayload(SECRET, 1_700_000_000, BODY);
    expect(signPayload(SECRET, 1_700_000_000, `${BODY} `)).not.toBe(base);
    expect(signPayload(SECRET, 1_700_000_001, BODY)).not.toBe(base);
    expect(signPayload('other', 1_700_000_000, BODY)).not.toBe(base);
  });

  it('builds the documented header set and nothing merchant-controlled', () => {
    const h = buildWebhookHeaders(SECRET, 'evt_1', 1_700_000_000, BODY);
    expect(Object.keys(h).sort()).toEqual(['Content-Type', 'Kirana-Event-Id', 'Kirana-Signature', 'Kirana-Timestamp', 'User-Agent']);
    expect(h['Kirana-Timestamp']).toBe('1700000000');
    expect(h['Kirana-Event-Id']).toBe('evt_1');
    expect(h['Content-Type']).toBe('application/json');
  });

  describe('verifyWebhookSignature (the receiver side)', () => {
    const now = 1_700_000_100;
    const header = signPayload(SECRET, 1_700_000_000, BODY);
    const ok = { secret: SECRET, header, timestamp: '1700000000', rawBody: BODY, nowSeconds: now };

    it('accepts a valid, fresh signature', () => expect(verifyWebhookSignature(ok)).toBe(true));
    it('rejects a modified body, wrong secret or wrong timestamp', () => {
      expect(verifyWebhookSignature({ ...ok, rawBody: `${BODY}x` })).toBe(false);
      expect(verifyWebhookSignature({ ...ok, secret: 'nope' })).toBe(false);
      expect(verifyWebhookSignature({ ...ok, timestamp: '1700000001' })).toBe(false);
    });
    it('rejects stale and far-future timestamps (replay window)', () => {
      const ts = 1_700_000_000; // the signed timestamp; the default tolerance is 300 s either way
      expect(verifyWebhookSignature({ ...ok, nowSeconds: ts + 301 })).toBe(false);
      expect(verifyWebhookSignature({ ...ok, nowSeconds: ts - 301 })).toBe(false);
      expect(verifyWebhookSignature({ ...ok, nowSeconds: ts + 299 })).toBe(true);
      expect(verifyWebhookSignature({ ...ok, nowSeconds: ts - 299 })).toBe(true);
    });
    it('rejects missing or malformed inputs without throwing', () => {
      for (const patch of [{ header: undefined }, { timestamp: undefined }, { timestamp: 'abc' }, { header: 'v1=zz' }, { header: '' }]) {
        expect(verifyWebhookSignature({ ...ok, ...patch })).toBe(false);
      }
    });
  });
});
