import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  Allow,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import type { InvoiceStatus } from '../../entities/invoice.entity';

export class CreateInvoiceDto {
  @ApiProperty({ example: 25000, description: 'Integer rupiah, must be > 0' })
  @Type(() => Number)
  @Allow()
  amount!: number;

  @ApiPropertyOptional({ example: 'Kopi susu 2 gelas', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @ApiProperty({ format: 'uuid', description: 'Active QRIS owned by the current merchant' })
  @IsUUID()
  qrisId!: string;

  @ApiPropertyOptional({
    example: 60,
    description: 'Lifetime in minutes (5..10080). Defaults to 60.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  expiresInMinutes?: number;
}

export class ListInvoicesQueryDto {
  @ApiPropertyOptional({ enum: ['PENDING', 'PAID', 'EXPIRED'] })
  @IsOptional()
  @IsIn(['PENDING', 'PAID', 'EXPIRED'])
  status?: InvoiceStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  qrisId?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 timestamp; returns invoices created before it' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}T/, { message: 'before must be an ISO 8601 timestamp' })
  before?: string;

  @ApiPropertyOptional({ example: 20, description: 'Page size 1..50 (default 20)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  limit?: number;
}
