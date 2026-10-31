import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKey } from '../entities/api-key.entity';
import { MerchantMember } from '../entities/merchant-member.entity';
import { Merchant } from '../entities/merchant.entity';
import { Session } from '../entities/session.entity';
import { User } from '../entities/user.entity';
import { ApiKeyOrSessionGuard } from './api-key.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionGuard } from './session.guard';

@Module({
  imports: [TypeOrmModule.forFeature([User, Session, Merchant, MerchantMember, ApiKey])],
  controllers: [AuthController],
  providers: [AuthService, SessionGuard, ApiKeyOrSessionGuard],
  exports: [AuthService, SessionGuard, ApiKeyOrSessionGuard, TypeOrmModule],
})
export class AuthModule {}
