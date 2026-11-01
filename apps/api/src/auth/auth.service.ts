import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { DataSource, LessThan, Repository } from 'typeorm';
import { MerchantMember } from '../entities/merchant-member.entity';
import { Merchant } from '../entities/merchant.entity';
import { Session } from '../entities/session.entity';
import { User } from '../entities/user.entity';
import { AuthContext } from './auth.types';
import { SESSION_TTL_DAYS, newSessionToken, sha256 } from './tokens';

export interface SessionResult {
  token: string;
  expiresAt: Date;
  user: { id: string; email: string; displayName: string | null };
  merchant: { id: string; name: string; role: 'OWNER' | 'STAFF' };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ARGON_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

// Verified against when the email does not exist, so both branches cost the same.
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHash ??= argonHash('kirana-dummy-password-not-used', ARGON_OPTIONS);
  return dummyHash;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    @InjectRepository(MerchantMember) private readonly members: Repository<MerchantMember>,
    @InjectRepository(Merchant) private readonly merchants: Repository<Merchant>,
    private readonly dataSource: DataSource,
  ) {}

  async register(input: {
    email: string;
    password: string;
    displayName?: string;
    merchantName?: string;
  }): Promise<SessionResult> {
    const email = this.normalizeEmail(input.email);
    this.assertPassword(input.password);

    const existing = await this.users.findOne({ where: { email } });
    if (existing) {
      throw new ConflictException({ code: 'EMAIL_TAKEN', message: 'Email is already registered.' });
    }

    const passwordHash = await argonHash(input.password, ARGON_OPTIONS);

    const userId = await this.dataSource.transaction(async (manager) => {
      const user = manager.create(User, {
        email,
        passwordHash,
        displayName: input.displayName?.trim() || null,
      });
      await manager.save(user);

      const merchant = manager.create(Merchant, {
        name: input.merchantName?.trim() || input.displayName?.trim() || email.split('@')[0],
        contactEmail: email,
      });
      await manager.save(merchant);

      await manager.save(
        manager.create(MerchantMember, { merchantId: merchant.id, userId: user.id, role: 'OWNER' }),
      );
      return user.id;
    });

    return this.createSession(userId);
  }

  async login(email: string, password: string): Promise<SessionResult> {
    const normalized = this.normalizeEmail(email);
    const user = await this.users.findOne({ where: { email: normalized } });
    // Same argon2 work whether or not the email exists (no timing oracle).
    const hashToCheck = user ? user.passwordHash : await getDummyHash();
    const ok = await argonVerify(hashToCheck, typeof password === 'string' ? password : '').catch(() => false);
    if (!user || !ok) {
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' });
    }
    return this.createSession(user.id);
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.sessions.delete({ tokenHash: sha256(token) });
  }

  async resolveSession(token: string | undefined): Promise<AuthContext | null> {
    if (!token) return null;
    const session = await this.sessions.findOne({ where: { tokenHash: sha256(token) } });
    if (!session || session.expiresAt.getTime() < Date.now()) {
      if (session) await this.sessions.delete({ id: session.id });
      return null;
    }
    const member = await this.members.findOne({ where: { userId: session.userId } });
    if (!member) return null;

    void this.sessions
      .update({ id: session.id }, { lastUsedAt: new Date() })
      .catch((e: Error) => this.logger.warn(`lastUsedAt update failed: ${e.message}`));

    return {
      userId: session.userId,
      merchantId: member.merchantId,
      role: member.role,
      via: 'session',
      sessionId: session.id,
    };
  }

  async me(ctx: AuthContext): Promise<{
    user: { id: string; email: string; displayName: string | null };
    merchant: { id: string; name: string; role: string };
  }> {
    const user = await this.users.findOne({ where: { id: ctx.userId } });
    const merchant = await this.merchants.findOne({ where: { id: ctx.merchantId } });
    if (!user || !merchant) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Session is no longer valid.' });
    }
    return {
      user: { id: user.id, email: user.email, displayName: user.displayName },
      merchant: { id: merchant.id, name: merchant.name, role: ctx.role },
    };
  }

  private async createSession(userId: string): Promise<SessionResult> {
    const token = newSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    await this.sessions.save(this.sessions.create({ userId, tokenHash: sha256(token), expiresAt }));
    // Opportunistic cleanup: expired sessions were only removed when presented again.
    await this.sessions.delete({ userId, expiresAt: LessThan(new Date()) }).catch(() => undefined);

    const user = await this.users.findOneOrFail({ where: { id: userId } });
    const member = await this.members.findOneOrFail({ where: { userId } });
    const merchant = await this.merchants.findOneOrFail({ where: { id: member.merchantId } });

    return {
      token,
      expiresAt,
      user: { id: user.id, email: user.email, displayName: user.displayName },
      merchant: { id: merchant.id, name: merchant.name, role: member.role },
    };
  }

  private normalizeEmail(email: string): string {
    const value = (email ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(value)) {
      throw new BadRequestException({ code: 'INVALID_EMAIL', message: 'A valid email is required.' });
    }
    return value;
  }

  private assertPassword(password: string): void {
    if (typeof password !== 'string' || password.length < 10 || password.length > 200) {
      throw new BadRequestException({
        code: 'WEAK_PASSWORD',
        message: 'Password must be at least 10 characters.',
      });
    }
  }
}
