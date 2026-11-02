import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { KiranaThrottlerGuard } from './common/kirana-throttler.guard';
import { extractApiKeyCredential } from './auth/api-key-credential';
import { sha256 } from './auth/tokens';
import { APP_GUARD } from '@nestjs/core';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { AuthModule } from './auth/auth.module';
import { ApiKey } from './entities/api-key.entity';
import { InvoiceEvent } from './entities/invoice-event.entity';
import { Invoice } from './entities/invoice.entity';
import { IdempotencyRecord } from './entities/idempotency-record.entity';
import { PaymentLink } from './entities/payment-link.entity';
import { MerchantMember } from './entities/merchant-member.entity';
import { MerchantQris } from './entities/merchant-qris.entity';
import { Merchant } from './entities/merchant.entity';
import { PaymentProvider } from './entities/payment-provider.entity';
import { Session } from './entities/session.entity';
import { User } from './entities/user.entity';
import { HealthController } from './health.controller';
import { InvoicesModule } from './invoices/invoices.module';
import { MerchantModule } from './merchant/merchant.module';
import { InitialMultiTenant1700000000000 } from './migrations/1700000000000-InitialMultiTenant';
import { Invoices1700000001000 } from './migrations/1700000001000-Invoices';
import { PaymentLinks1700000002000 } from './migrations/1700000002000-PaymentLinks';
import { DeveloperApiKeys1700000003000 } from './migrations/1700000003000-DeveloperApiKeys';
import { Idempotency1700000004000 } from './migrations/1700000004000-Idempotency';
import { DeveloperModule } from './developer/developer.module';
import { PaymentLinksModule } from './payment-links/payment-links.module';
import { ProvidersModule } from './providers/providers.module';
import { QrModule } from './qr/qr.module';
import { QrJob } from './qr/qr-job.entity';
import { QrisModule } from './qris/qris.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot({
      throttlers: [
        // per client IP: always applies (also protects against random-key guessing)
        { name: 'default', ttl: 60_000, limit: 120 },
        // per API key: only for requests that carry a key; the tracker is a hash, no DB lookup
        {
          name: 'apikey',
          ttl: 60_000,
          limit: 120,
          skipIf: (context) => extractApiKeyCredential(context.switchToHttp().getRequest()).kind !== 'key',
          getTracker: (req) => {
            const credential = extractApiKeyCredential(req as Parameters<typeof extractApiKeyCredential>[0]);
            return credential.kind === 'key' ? `key:${sha256(credential.key).slice(0, 24)}` : 'none';
          },
        },
      ],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        host: config.get<string>('DB_HOST', '127.0.0.1'),
        port: Number(config.get<string>('DB_PORT', '5432')),
        username: config.get<string>('DB_USER', 'kirana'),
        password: config.get<string>('DB_PASSWORD', process.env.NODE_ENV === 'production' ? '' : 'kirana'),
        database: config.get<string>('DB_NAME', 'kirana_pay'),
        entities: [
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
        ],
        migrations: [InitialMultiTenant1700000000000, Invoices1700000001000, PaymentLinks1700000002000, DeveloperApiKeys1700000003000, Idempotency1700000004000],
        migrationsRun: true,
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    StorageModule,
    AuthModule,
    MerchantModule,
    ProvidersModule,
    QrisModule,
    ApiKeysModule,
    QrModule,
    InvoicesModule,
    PaymentLinksModule,
    DeveloperModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: KiranaThrottlerGuard }],
})
export class AppModule {}
