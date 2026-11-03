import { buildWebhookPayload, newEventId } from './webhook-payload';
import { WEBHOOK_API_VERSION } from './webhook.constants';

const invoice = {
  reference: 'INV-ABC123456789',
  amount: 25_000,
  currency: 'IDR',
  status: 'PAID' as const,
  createdAt: '2026-11-02T10:00:00.000Z',
  expiresAt: '2026-11-02T10:15:00.000Z',
  paidAt: '2026-11-02T10:05:00.000Z',
};

describe('webhook payload', () => {
  it('builds a stable envelope with a fixed apiVersion', () => {
    const { payloadJson } = buildWebhookPayload('invoice.paid', invoice, 'evt_test', new Date('2026-11-02T10:05:01.000Z'));
    const parsed = JSON.parse(payloadJson);
    expect(parsed).toEqual({
      id: 'evt_test',
      type: 'invoice.paid',
      createdAt: '2026-11-02T10:05:01.000Z',
      apiVersion: WEBHOOK_API_VERSION,
      data: { invoice },
    });
  });

  it('never leaks internal identifiers or description', () => {
    const { payloadJson } = buildWebhookPayload('invoice.created', invoice, 'evt_x', new Date());
    expect(payloadJson).not.toMatch(/"id"\s*:\s*"[0-9a-f]{8}-/); // no internal UUID
    expect(payloadJson).not.toContain('qris');
    expect(payloadJson).not.toContain('description');
    expect(payloadJson).not.toContain('@'); // no email
  });

  it('serialises byte-identically for the same input (retries reuse stored bytes)', () => {
    const at = new Date('2026-11-02T10:05:01.000Z');
    const a = buildWebhookPayload('invoice.paid', invoice, 'evt_same', at).payloadJson;
    const b = buildWebhookPayload('invoice.paid', invoice, 'evt_same', at).payloadJson;
    expect(a).toBe(b);
  });

  it('generates unique evt_ ids of fixed shape', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newEventId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^evt_[a-z2-7]{26}$/);
  });
});
