import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ApiKey } from './entities/api-key.entity';
import { IdempotencyRecord } from './entities/idempotency-record.entity';
import { InvoiceEvent } from './entities/invoice-event.entity';
import { Invoice } from './entities/invoice.entity';
import { MerchantMember } from './entities/merchant-member.entity';
import { MerchantQris } from './entities/merchant-qris.entity';
import { Merchant } from './entities/merchant.entity';
import { PaymentLink } from './entities/payment-link.entity';
import { PaymentProvider } from './entities/payment-provider.entity';
import { Session } from './entities/session.entity';
import { User } from './entities/user.entity';
import { WebhookDeliveryAttempt } from './entities/webhook-delivery-attempt.entity';
import { WebhookDelivery } from './entities/webhook-delivery.entity';
import { WebhookEndpointAudit } from './entities/webhook-endpoint-audit.entity';
import { WebhookEndpoint } from './entities/webhook-endpoint.entity';
import { WebhookEvent } from './entities/webhook-event.entity';
import { QrJob } from './qr/qr-job.entity';
import { InitialMultiTenant1700000000000 } from './migrations/1700000000000-InitialMultiTenant';
import { Invoices1700000001000 } from './migrations/1700000001000-Invoices';
import { PaymentLinks1700000002000 } from './migrations/1700000002000-PaymentLinks';
import { DeveloperApiKeys1700000003000 } from './migrations/1700000003000-DeveloperApiKeys';
import { Idempotency1700000004000 } from './migrations/1700000004000-Idempotency';
import { Webhooks1700000005000 } from './migrations/1700000005000-Webhooks';

/** Used by the TypeORM CLI (migration:run / migration:generate), not by the app runtime. */
export const ENTITIES = [
  User,
  Merchant,
  MerchantMember,
  Session,
  PaymentProvider,
  MerchantQris,
  ApiKey,
  QrJob,
  Invoice,
  InvoiceEvent,
  PaymentLink,
  IdempotencyRecord,
  WebhookEndpoint,
  WebhookEndpointAudit,
  WebhookEvent,
  WebhookDelivery,
  WebhookDeliveryAttempt,
];

export const MIGRATIONS = [
  InitialMultiTenant1700000000000,
  Invoices1700000001000,
  PaymentLinks1700000002000,
  DeveloperApiKeys1700000003000,
  Idempotency1700000004000,
  Webhooks1700000005000,
];

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER ?? 'kirana',
  password: process.env.DB_PASSWORD ?? 'kirana',
  database: process.env.DB_NAME ?? 'kirana_pay',
  entities: ENTITIES,
  migrations: MIGRATIONS,
});
