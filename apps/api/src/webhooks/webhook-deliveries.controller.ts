import { Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../auth/auth.types';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { SessionGuard } from '../auth/session.guard';
import { WebhookEndpointsService } from './webhook-endpoints.service';

/** Manual retry: only FAILED deliveries whose event is younger than 7 days. Owner only. */
@ApiTags('webhooks')
@Controller('v1/webhook-deliveries')
@UseGuards(SessionGuard)
export class WebhookDeliveriesController {
  constructor(private readonly service: WebhookEndpointsService) {}

  @Post(':id/retry')
  @ApiOperation({ summary: 'Retry a failed delivery once, immediately' })
  retry(@CurrentAuth() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.retryDelivery(ctx, id);
  }
}
