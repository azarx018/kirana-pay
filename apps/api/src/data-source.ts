import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ApiKey } from './entities/api-key.entity';
import { MerchantMember } from './entities/merchant-member.entity';
import { MerchantQris } from './entities/merchant-qris.entity';
import { Merchant } from './entities/merchant.entity';
import { PaymentProvider } from './entities/payment-provider.entity';
import { Session } from './entities/session.entity';
import { User } from './entities/user.entity';
import { QrJob } from './qr/qr-job.entity';
import { InitialMultiTenant1700000000000 } from './migrations/1700000000000-InitialMultiTenant';

export const ENTITIES = [
  User,
  Merchant,
  MerchantMember,
  Session,
  PaymentProvider,
  MerchantQris,
  ApiKey,
  QrJob,
];

export const MIGRATIONS = [InitialMultiTenant1700000000000];

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
