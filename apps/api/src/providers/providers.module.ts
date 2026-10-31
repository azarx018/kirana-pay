import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { PaymentProvider } from '../entities/payment-provider.entity';
import { ProvidersController } from './providers.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentProvider]), AuthModule],
  controllers: [ProvidersController],
})
export class ProvidersModule {}
