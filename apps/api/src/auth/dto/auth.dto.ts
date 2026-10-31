import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'owner@toko.id' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'rahasia-sekali-123', minLength: 10 })
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  password!: string;

  @ApiPropertyOptional({ example: 'Budi' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayName?: string;

  @ApiPropertyOptional({ example: 'Toko Utama' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  merchantName?: string;
}

export class LoginDto {
  @ApiProperty({ example: 'owner@toko.id' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'rahasia-sekali-123' })
  @IsString()
  password!: string;
}
