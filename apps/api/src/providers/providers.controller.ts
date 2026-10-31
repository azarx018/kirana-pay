import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SessionGuard } from '../auth/session.guard';
import { PaymentProvider } from '../entities/payment-provider.entity';

@ApiTags('providers')
@Controller('v1/payment-providers')
@UseGuards(SessionGuard)
export class ProvidersController {
  constructor(
    @InjectRepository(PaymentProvider) private readonly providers: Repository<PaymentProvider>,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List active payment providers (central registry)' })
  async list(): Promise<{ success: true; data: unknown[] }> {
    const rows = await this.providers.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    return {
      success: true,
      data: rows.map((p) => ({ id: p.id, code: p.code, name: p.name })),
    };
  }
}
