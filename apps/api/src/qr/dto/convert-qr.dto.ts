import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class ConvertQrDto {
  @ApiProperty({ type: 'integer', example: 2300, description: 'Amount in rupiah (integer)' })
  @Type(() => Number)
  @IsInt({ message: 'amount must be an integer' })
  @Min(1, { message: 'amount must be greater than zero' })
  amount!: number;

  @ApiProperty({ required: false, maxLength: 25, example: 'INV-001' })
  @IsOptional()
  @IsString()
  @MaxLength(25)
  note?: string;
}
