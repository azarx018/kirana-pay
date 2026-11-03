import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';
import type { AuthContext } from '../auth/auth.types';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { SessionGuard } from '../auth/session.guard';
import { WEBHOOK_EVENT_TYPES } from './webhook.constants';
import { WebhookEndpointsService } from './webhook-endpoints.service';

class CreateEndpointBody {
  @IsUrl({ protocols: ['https'], require_protocol: true, require_tld: false })
  @MaxLength(2048)
  url!: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  description?: string;

  @ApiPropertyOptional({ enum: WEBHOOK_EVENT_TYPES, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(WEBHOOK_EVENT_TYPES.length)
  @IsString({ each: true })
  events?: string[];
}

class UpdateEndpointBody {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @MinLength(8)
  url?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  description?: string;

  @ApiPropertyOptional({ enum: WEBHOOK_EVENT_TYPES, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(WEBHOOK_EVENT_TYPES.length)
  @IsString({ each: true })
  events?: string[];

  @ApiPropertyOptional({ enum: ['ACTIVE', 'DISABLED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'DISABLED'])
  status?: 'ACTIVE' | 'DISABLED';
}

class DeliveriesQuery {
  @ApiPropertyOptional({ default: 20, maximum: 50 })
  @IsOptional()
  limit?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 createdAt cursor' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  before?: string;
}

/** Dashboard endpoints. Session only: an API key can never manage webhooks. */
@ApiTags('webhooks')
@Controller('v1/webhook-endpoints')
@UseGuards(SessionGuard)
export class WebhookEndpointsController {
  constructor(private readonly service: WebhookEndpointsService) {}

  @Get()
  @ApiOperation({ summary: 'List webhook endpoints of the current merchant' })
  list(@CurrentAuth() ctx: AuthContext) {
    return this.service.list(ctx);
  }

  @Post()
  @ApiOperation({ summary: 'Register an endpoint. The signing secret is returned once.' })
  create(@CurrentAuth() ctx: AuthContext, @Body() body: CreateEndpointBody) {
    return this.service.create(ctx, body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Endpoint detail (never includes the secret)' })
  get(@CurrentAuth() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(ctx, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update url/description/events/status' })
  update(
    @CurrentAuth() ctx: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateEndpointBody,
  ) {
    return this.service.update(ctx, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Archive an endpoint (history is kept, secret is deleted)' })
  async archive(@CurrentAuth() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.service.archive(ctx, id);
  }

  @Post(':id/rotate-secret')
  @ApiOperation({ summary: 'Rotate the signing secret. Takes effect immediately; returned once.' })
  rotate(@CurrentAuth() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.rotateSecret(ctx, id);
  }

  @Get(':id/deliveries')
  @ApiOperation({ summary: 'Delivery history for an endpoint (newest first)' })
  deliveries(
    @CurrentAuth() ctx: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: DeliveriesQuery,
  ) {
    const limit = Number(query.limit ?? 20) || 20;
    return this.service.deliveries(ctx, id, limit, query.before);
  }
}
