import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { WebhookEventType } from './webhook.constants';
import { buildWebhookPayload, newEventId, type WebhookInvoicePayload } from './webhook-payload';

export interface EnqueueInput {
  merchantId: string;
  type: WebhookEventType;
  invoiceId: string;
  invoice: WebhookInvoicePayload;
  at?: Date;
}

/**
 * Writes the outbox row. MUST be called with the transaction manager of the invoice change:
 * if the invoice transaction rolls back, no event exists. No HTTP happens here.
 */
@Injectable()
export class WebhookEventsService {
  async enqueue(manager: EntityManager, input: EnqueueInput): Promise<void> {
    const at = input.at ?? new Date();
    const { eventId, payloadJson } = buildWebhookPayload(input.type, input.invoice, newEventId(), at);
    await manager.query(
      `INSERT INTO "webhook_events" ("eventId", "merchantId", "type", "invoiceId", "payloadJson", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT ("eventId") DO NOTHING`,
      [eventId, input.merchantId, input.type, input.invoiceId, payloadJson, at],
    );
  }
}
