import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signature = HMAC-SHA256(secret, "<timestamp>.<rawBody>") as lowercase hex, sent as
 * `Kirana-Signature: v1=<hex>`. The timestamp (unix seconds) is regenerated for every
 * attempt; the body bytes are the exact stored payload and never change between retries.
 * A timestamp alone does NOT stop replays: receivers must also de-duplicate by event id.
 */
export const SIGNATURE_SCHEME = 'v1';

export function signPayload(secret: string, timestampSeconds: number, rawBody: string): string {
  const mac = createHmac('sha256', secret).update(`${timestampSeconds}.${rawBody}`).digest('hex');
  return `${SIGNATURE_SCHEME}=${mac}`;
}

export interface SignedHeaders {
  'Content-Type': string;
  'User-Agent': string;
  'Kirana-Event-Id': string;
  'Kirana-Timestamp': string;
  'Kirana-Signature': string;
}

export function buildWebhookHeaders(secret: string, eventId: string, timestampSeconds: number, rawBody: string): SignedHeaders {
  return {
    'Content-Type': 'application/json',
    'User-Agent': 'KiranaPay-Webhooks/1',
    'Kirana-Event-Id': eventId,
    'Kirana-Timestamp': String(timestampSeconds),
    'Kirana-Signature': signPayload(secret, timestampSeconds, rawBody),
  };
}

/** Reference verifier (also what the integration guide shows to receivers). */
export function verifyWebhookSignature(opts: {
  secret: string;
  header: string | undefined;
  timestamp: string | undefined;
  rawBody: string;
  toleranceSeconds?: number;
  nowSeconds?: number;
}): boolean {
  const { secret, header, timestamp, rawBody } = opts;
  if (!header || !timestamp || !/^\d{1,12}$/.test(timestamp)) return false;
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > (opts.toleranceSeconds ?? 300)) return false;
  const expected = Buffer.from(signPayload(secret, Number(timestamp), rawBody), 'utf8');
  const given = Buffer.from(header, 'utf8');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
