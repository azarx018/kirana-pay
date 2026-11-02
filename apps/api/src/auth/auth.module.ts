import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKey } from '../entities/api-key.entity';
import { MerchantMember } from '../entities/merchant-member.entity';
import { Merchant } from '../entities/merchant.entity';
import { Session } from '../entities/session.entity';
import { User } from '../entities/user.entity';
import { ApiKeyOrSessionGuard } from './api-key.guard';
import { ScopeGuard } from './scope.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionGuard } from './session.guard';

@Module({
  imports: [TypeOrmModule.forFeature([User, Session, Merchant, MerchantMember, ApiKey])],
  controllers: [AuthController],
  providers: [AuthService, SessionGuard, ApiKeyOrSessionGuard, ScopeGuard],
  exports: [AuthService, SessionGuard, ApiKeyOrSessionGuard, ScopeGuard, TypeOrmModule],
})
export class AuthModule {}
