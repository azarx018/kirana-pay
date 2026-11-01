import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { AuthModule } from './auth/auth.module';
import { ApiKey } from './entities/api-key.entity';
import { InvoiceEvent } from './entities/invoice-event.entity';
import { Invoice } from './entities/invoice.entity';
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
import { ProvidersModule } from './providers/providers.module';
import { QrModule } from './qr/qr.module';
import { QrJob } from './qr/qr-job.entity';
import { QrisModule } from './qris/qris.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        host: config.get<string>('DB_HOST', '127.0.0.1'),
        port: Number(config.get<string>('DB_PORT', '5432')),
        username: config.get<string>('DB_USER', 'kirana'),
        password: config.get<string>('DB_PASSWORD', 'kirana'),
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
        ],
        migrations: [InitialMultiTenant1700000000000, Invoices1700000001000],
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
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
