/**
 * Events that really exist. `invoice.cancelled` is deliberately absent: invoices have no
 * CANCELLED status (ADR 0001) and an event for a state that cannot happen would be a lie.
 */
export const WEBHOOK_EVENT_TYPES = ['invoice.created', 'invoice.paid', 'invoice.expired'] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/** Fixed version stamped on every payload; bump only with a new, documented payload shape. */
export const WEBHOOK_API_VERSION = '2026-11-02';

export const ENDPOINT_STATUSES = ['ACTIVE', 'DISABLED', 'ARCHIVED'] as const;
export type EndpointStatus = (typeof ENDPOINT_STATUSES)[number];

export type DeliveryStatus = 'PENDING' | 'IN_FLIGHT' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

export const WEBHOOK_RETENTION_DAYS = 30;
export const MANUAL_RETRY_MAX_EVENT_AGE_DAYS = 7;

export function isWebhookEventType(value: unknown): value is WebhookEventType {
  return typeof value === 'string' && (WEBHOOK_EVENT_TYPES as readonly string[]).includes(value);
}
