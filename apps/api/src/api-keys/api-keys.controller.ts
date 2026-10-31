import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthContext } from '../auth/auth.types';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { SessionGuard } from '../auth/session.guard';
import { ApiKeysService } from './api-keys.service';

class CreateApiKeyDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;
}

@ApiTags('api-keys')
@Controller('v1/api-keys')
@UseGuards(SessionGuard)
export class ApiKeysController {
  constructor(private readonly service: ApiKeysService) {}

  @Get()
  @ApiOperation({ summary: 'List API keys for the current merchant (never returns secrets)' })
  async list(@CurrentAuth() ctx: AuthContext): Promise<{ success: true; data: unknown[] }> {
    const rows = await this.service.list(ctx.merchantId);
    return {
      success: true,
      data: rows.map((k) => ({
        id: k.id,
        name: k.name,
        prefix: k.prefix,
        revoked: Boolean(k.revokedAt),
        lastUsedAt: k.lastUsedAt,
        createdAt: k.createdAt,
      })),
    };
  }

  @Post()
  @ApiOperation({ summary: 'Create an API key; the plaintext is returned only here' })
  async create(
    @CurrentAuth() ctx: AuthContext,
    @Body() dto: CreateApiKeyDto,
  ): Promise<{ success: true; data: unknown }> {
    const { key, plaintext } = await this.service.create(ctx.merchantId, dto.name ?? 'API key');
    return {
      success: true,
      data: { id: key.id, name: key.name, prefix: key.prefix, key: plaintext, createdAt: key.createdAt },
    };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Revoke an API key' })
  async revoke(
    @CurrentAuth() ctx: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<{ success: true }> {
    await this.service.revoke(ctx.merchantId, id);
    return { success: true };
  }

  @Post(':id/rotate')
  @ApiOperation({ summary: 'Rotate an API key (old key is revoked immediately)' })
  async rotate(
    @CurrentAuth() ctx: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<{ success: true; data: unknown }> {
    const { key, plaintext } = await this.service.rotate(ctx.merchantId, id);
    return {
      success: true,
      data: { id: key.id, name: key.name, prefix: key.prefix, key: plaintext, createdAt: key.createdAt },
    };
  }
}
