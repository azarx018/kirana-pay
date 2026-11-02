import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { PaymentLinksModule } from '../payment-links/payment-links.module';
import { DeveloperInvoicesController } from './developer-invoices.controller';
import { DeveloperInvoicesService } from './developer-invoices.service';
import { JsonContentTypeGuard, RequireApiKeyGuard } from './developer.guards';

@Module({
  imports: [AuthModule, InvoicesModule, PaymentLinksModule, IdempotencyModule],
  controllers: [DeveloperInvoicesController],
  providers: [DeveloperInvoicesService, RequireApiKeyGuard, JsonContentTypeGuard],
})
export class DeveloperModule {}
