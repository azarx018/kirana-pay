import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from './common/public.decorator';

@ApiTags('health')
@Controller()
export class HealthController {
  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Liveness probe for the API service' })
  health(): { status: string; service: string } {
    return { status: 'ok', service: 'kirana-api' };
  }
}
