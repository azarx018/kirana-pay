import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ApiKeyGuard } from './api-key.guard';

@Global()
@Module({
  providers: [{ provide: APP_GUARD, useClass: ApiKeyGuard }],
})
export class AuthModule {}
