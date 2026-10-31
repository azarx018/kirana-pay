import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { MerchantQris } from '../entities/merchant-qris.entity';
import { PaymentProvider } from '../entities/payment-provider.entity';
import { QrEngineClient } from '../qr/qr-engine.client';
import { StorageModule } from '../storage/storage.module';
import { QrisController } from './qris.controller';
import { QrisService } from './qris.service';

@Module({
  imports: [TypeOrmModule.forFeature([MerchantQris, PaymentProvider]), StorageModule, AuthModule],
  controllers: [QrisController],
  providers: [QrisService, QrEngineClient],
})
export class QrisModule {}
