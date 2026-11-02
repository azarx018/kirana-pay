import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { AuthContext } from '../auth/auth.types';
import { CurrentAuth } from '../auth/current-auth.decorator';
import {
  API_KEY_SCOPES,
  ApiKeyInputError,
  LEGACY_DEFAULT_SCOPES,
  normalizeScopes,
  resolveKeyExpiry,
  type ApiKeyScope,
} from '../auth/scopes';
import { SessionGuard } from '../auth/session.guard';
import type { ApiKey } from '../entities/api-key.entity';
import { assertOwner } from '../common/roles';
import { ApiKeysService, keyStatus } from './api-keys.service';

class CreateApiKeyDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional({
    enum: API_KEY_SCOPES,
    isArray: true,
    description: `Permissions of the key. If omitted, the pre-V4 default is used: ${LEGACY_DEFAULT_SCOPES.join(', ')}.`,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(API_KEY_SCOPES.length)
  @IsString({ each: true })
  scopes?: string[];

  @ApiPropertyOptional({ description: 'Optional ISO 8601 expiry, in the future and within 366 days.' })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}

function view(k: ApiKey) {
  return {
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    scopes: k.scopes,
    status: keyStatus(k),
    revoked: Boolean(k.revokedAt), // kept for the existing dashboard
    expiresAt: k.expiresAt,
    lastUsedAt: k.lastUsedAt,
    revokedAt: k.revokedAt,
    rotatedFromId: k.rotatedFromId,
    createdAt: k.createdAt,
  };
}

function issued(k: ApiKey, plaintext: string) {
  return { ...view(k), key: plaintext };
}

function badRequest(error: unknown): never {
  if (error instanceof ApiKeyInputError) {
    throw new BadRequestException({ code: error.code, message: error.message });
  }
  throw error;
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
    return { success: true, data: rows.map(view) };
  }

  @Post()
  @ApiOperation({ summary: 'Create an API key; the plaintext is returned only here' })
  async create(
    @CurrentAuth() ctx: AuthContext,
    @Body() dto: CreateApiKeyDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: true; data: unknown }> {
    assertOwner(ctx);
    let scopes: ApiKeyScope[];
    let expiresAt: Date | null;
    try {
      scopes = dto.scopes === undefined ? [...LEGACY_DEFAULT_SCOPES] : normalizeScopes(dto.scopes);
      expiresAt = resolveKeyExpiry(dto.expiresAt);
    } catch (error) {
      return badRequest(error);
    }
    const { key, plaintext } = await this.service.create({
      merchantId: ctx.merchantId,
      name: dto.name ?? 'API key',
      scopes,
      expiresAt,
      createdByUserId: ctx.userId || null,
    });
    res.setHeader('Cache-Control', 'no-store');
    return { success: true, data: issued(key, plaintext) };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Revoke an API key (idempotent, immediate)' })
  async revoke(
    @CurrentAuth() ctx: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<{ success: true }> {
    assertOwner(ctx);
    await this.service.revoke(ctx.merchantId, id, ctx.userId || null);
    return { success: true };
  }

  @Post(':id/rotate')
  @ApiOperation({ summary: 'Rotate an API key atomically (old key is revoked immediately, no grace period)' })
  async rotate(
    @CurrentAuth() ctx: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: true; data: unknown }> {
    assertOwner(ctx);
    const { key, plaintext } = await this.service.rotate(ctx.merchantId, id, ctx.userId || null);
    res.setHeader('Cache-Control', 'no-store');
    return { success: true, data: issued(key, plaintext) };
  }
}
