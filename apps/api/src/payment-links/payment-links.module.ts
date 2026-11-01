import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { PaymentLinksController } from './payment-links.controller';
import { PaymentLinksService } from './payment-links.service';
import { PublicPaymentLinksController } from './public-payment-links.controller';

@Module({
  imports: [AuthModule, InvoicesModule],
  controllers: [PaymentLinksController, PublicPaymentLinksController],
  providers: [PaymentLinksService],
})
export class PaymentLinksModule {}
