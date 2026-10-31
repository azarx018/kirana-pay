import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Merchant } from '../entities/merchant.entity';
import { MerchantController } from './merchant.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Merchant]), AuthModule],
  controllers: [MerchantController],
})
export class MerchantModule {}
