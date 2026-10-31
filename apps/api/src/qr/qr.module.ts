import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { MerchantQris } from '../entities/merchant-qris.entity';
import { StorageModule } from '../storage/storage.module';
import { QrController } from './qr.controller';
import { QrEngineClient } from './qr-engine.client';
import { QrJob } from './qr-job.entity';
import { QrService } from './qr.service';

@Module({
  imports: [TypeOrmModule.forFeature([QrJob, MerchantQris]), StorageModule, AuthModule],
  controllers: [QrController],
  providers: [QrService, QrEngineClient],
})
export class QrModule {}
