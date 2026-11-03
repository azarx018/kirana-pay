import { randomBytes } from 'node:crypto';
import { WEBHOOK_API_VERSION, type WebhookEventType } from './webhook.constants';

/**
 * Public invoice shape inside a webhook payload. Deliberately narrower than the dashboard view:
 * no internal UUID, no QRIS id, no email, no description (may contain customer data).
 * Merchants fetch details through the API using `reference`.
 */
export interface WebhookInvoicePayload {
  reference: string;
  amount: number;
  currency: string;
  status: 'PENDING' | 'PAID' | 'EXPIRED';
  createdAt: string;
  expiresAt: string;
  paidAt: string | null;
}

export interface WebhookEnvelope {
  id: string;
  type: WebhookEventType;
  createdAt: string;
  apiVersion: string;
  data: { invoice: WebhookInvoicePayload };
}

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/** `evt_` + 130 random bits as 26 lowercase base32 chars — non-guessable, sortable by time not implied. */
export function newEventId(): string {
  const bytes = randomBytes(17);
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(buffer << (5 - bits)) & 31];
  return `evt_${out.slice(0, 26)}`;
}

export function buildWebhookPayload(
  type: WebhookEventType,
  invoice: WebhookInvoicePayload,
  eventId: string,
  createdAt: Date,
): { eventId: string; payloadJson: string } {
  const envelope: WebhookEnvelope = {
    id: eventId,
    type,
    createdAt: createdAt.toISOString(),
    apiVersion: WEBHOOK_API_VERSION,
    data: { invoice },
  };
  // Serialised once and stored: retries must send identical bytes (signature stability).
  return { eventId, payloadJson: JSON.stringify(envelope) };
}
