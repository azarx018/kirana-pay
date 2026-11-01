import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvoiceEvent } from '../entities/invoice-event.entity';
import { Invoice } from '../entities/invoice.entity';
import { MerchantQris } from '../entities/merchant-qris.entity';
import { PaymentProvider } from '../entities/payment-provider.entity';
import { User } from '../entities/user.entity';
import { QrModule } from '../qr/qr.module';
import { AuthModule } from '../auth/auth.module';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Invoice, InvoiceEvent, MerchantQris, PaymentProvider, User]),
    QrModule,
    AuthModule,
  ],
  controllers: [InvoicesController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
