import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../common/api-key.guard.module';
import { StorageModule } from '../storage/storage.module';
import { QrController } from './qr.controller';
import { QrEngineClient } from './qr-engine.client';
import { QrJob } from './qr-job.entity';
import { QrService } from './qr.service';

@Module({
  imports: [TypeOrmModule.forFeature([QrJob]), StorageModule, AuthModule],
  controllers: [QrController],
  providers: [QrService, QrEngineClient],
})
export class QrModule {}
