import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Repository } from 'typeorm';
import { AuthContext } from '../auth/auth.types';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { SessionGuard } from '../auth/session.guard';
import { Merchant } from '../entities/merchant.entity';

class UpdateMerchantDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;
}

@ApiTags('merchant')
@Controller('v1/merchant')
@UseGuards(SessionGuard)
export class MerchantController {
  constructor(@InjectRepository(Merchant) private readonly merchants: Repository<Merchant>) {}

  @Get()
  @ApiOperation({ summary: 'Current merchant profile' })
  async get(@CurrentAuth() ctx: AuthContext): Promise<{ success: true; data: unknown }> {
    const merchant = await this.merchants.findOneOrFail({ where: { id: ctx.merchantId } });
    return {
      success: true,
      data: {
        id: merchant.id,
        name: merchant.name,
        contactEmail: merchant.contactEmail,
        phone: merchant.phone,
        role: ctx.role,
      },
    };
  }

  @Patch()
  @ApiOperation({ summary: 'Update merchant profile (owner only)' })
  async update(
    @CurrentAuth() ctx: AuthContext,
    @Body() dto: UpdateMerchantDto,
  ): Promise<{ success: true; data: unknown }> {
    const merchant = await this.merchants.findOneOrFail({ where: { id: ctx.merchantId } });
    if (dto.name !== undefined) merchant.name = dto.name.trim();
    if (dto.phone !== undefined) merchant.phone = dto.phone.trim() || null;
    await this.merchants.save(merchant);
    return { success: true, data: { id: merchant.id, name: merchant.name, phone: merchant.phone } };
  }
}
