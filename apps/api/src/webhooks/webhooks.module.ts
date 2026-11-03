import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { WebhookDeliveryAttempt } from '../entities/webhook-delivery-attempt.entity';
import { WebhookDelivery } from '../entities/webhook-delivery.entity';
import { WebhookEndpointAudit } from '../entities/webhook-endpoint-audit.entity';
import { WebhookEndpoint } from '../entities/webhook-endpoint.entity';
import { WebhookEvent } from '../entities/webhook-event.entity';
import { WebhookDeliveriesController } from './webhook-deliveries.controller';
import { WebhookEndpointsController } from './webhook-endpoints.controller';
import { WebhookEndpointsService } from './webhook-endpoints.service';
import { WebhookEventsService } from './webhook-events.service';
import { WebhookWorkerService } from './webhook-worker.service';
import { WEBHOOK_CONFIG, readWebhookConfig } from './webhook.config';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      WebhookEndpoint,
      WebhookEndpointAudit,
      WebhookEvent,
      WebhookDelivery,
      WebhookDeliveryAttempt,
    ]),
  ],
  controllers: [WebhookEndpointsController, WebhookDeliveriesController],
  providers: [
    { provide: WEBHOOK_CONFIG, useFactory: () => readWebhookConfig() },
    WebhookEventsService,
    WebhookEndpointsService,
    WebhookWorkerService,
  ],
  exports: [WebhookEventsService, WebhookEndpointsService],
})
export class WebhooksModule {}
