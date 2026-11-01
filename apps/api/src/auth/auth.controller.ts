import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CurrentAuth } from './current-auth.decorator';
import { AuthService } from './auth.service';
import type { AuthContext } from './auth.types';
import { isCookieSecure } from '../common/runtime-config';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { SessionGuard } from './session.guard';
import { SESSION_COOKIE, SESSION_TTL_DAYS } from './tokens';

@ApiTags('auth')
@Controller('v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private setCookie(res: Response, token: string): void {
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isCookieSecure(),
      maxAge: SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
      path: '/',
    });
  }

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create a user, a merchant (owner) and a session' })
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: true; data: unknown }> {
    const result = await this.auth.register(dto);
    this.setCookie(res, result.token);
    return {
      success: true,
      data: { user: result.user, merchant: result.merchant, expiresAt: result.expiresAt },
    };
  }

  @Post('login')
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @ApiOperation({ summary: 'Login with email and password' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: true; data: unknown }> {
    const result = await this.auth.login(dto.email, dto.password);
    this.setCookie(res, result.token);
    return {
      success: true,
      data: { user: result.user, merchant: result.merchant, expiresAt: result.expiresAt },
    };
  }

  @Post('logout')
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: 'Invalidate the current session' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ success: true }> {
    await this.auth.logout(req.cookies?.[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { success: true };
  }

  @Get('me')
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: 'Current user, merchant and role' })
  async me(@CurrentAuth() ctx: AuthContext): Promise<{ success: true; data: unknown }> {
    return { success: true, data: await this.auth.me(ctx) };
  }
}
