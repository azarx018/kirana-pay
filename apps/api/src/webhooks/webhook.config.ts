import { createHash } from 'node:crypto';
import { isProduction } from '../common/runtime-config';

export const WEBHOOK_CONFIG = Symbol('WEBHOOK_CONFIG');

export interface WebhookConfig {
  /** AES-256 key for stored signing secrets; null = feature unavailable (503). */
  encryptionKey: Buffer | null;
  /** Dev/e2e only: allow http and private/loopback destinations. NEVER true in production. */
  devAllowPrivate: boolean;
  allowedPorts: readonly number[];
  maxEndpoints: number;
  workerEnabled: boolean;
  workerConcurrency: number;
  pollIntervalMs: number;
  maxAttempts: number;
  maxAgeHours: number;
  requestTimeoutMs: number;
  connectTimeoutMs: number;
}

/** Non-production fallback so local development works without extra setup. */
const DEV_KEY = createHash('sha256').update('kirana-dev-only-webhook-secret-key').digest();

function int(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

function parsePorts(raw: string | undefined): readonly number[] {
  const parsed = (raw ?? '')
    .split(',')
    .map((p) => Number(p.trim()))
    .filter((p) => Number.isInteger(p) && p >= 1 && p <= 65535);
  return parsed.length > 0 ? parsed : [443, 8443];
}

function resolveKey(env: NodeJS.ProcessEnv): Buffer | null {
  const raw = env.WEBHOOK_SECRET_ENCRYPTION_KEY?.trim();
  if (raw) {
    const key = Buffer.from(raw, 'base64');
    return key.length === 32 ? key : null;
  }
  return isProduction(env) ? null : DEV_KEY;
}

export function readWebhookConfig(env: NodeJS.ProcessEnv = process.env): WebhookConfig {
  return {
    encryptionKey: resolveKey(env),
    // Defence in depth: even if the variable leaks into a production environment it is inert.
    devAllowPrivate: !isProduction(env) && env.WEBHOOK_DEV_ALLOW_PRIVATE === 'true',
    allowedPorts: parsePorts(env.WEBHOOK_ALLOWED_PORTS),
    maxEndpoints: int(env.WEBHOOK_MAX_ENDPOINTS, 5, 1, 50),
    workerEnabled: env.WEBHOOK_WORKER_ENABLED !== 'false',
    workerConcurrency: int(env.WEBHOOK_WORKER_CONCURRENCY, 4, 1, 32),
    pollIntervalMs: int(env.WEBHOOK_POLL_INTERVAL_MS, 2000, 100, 60_000),
    maxAttempts: int(env.WEBHOOK_MAX_ATTEMPTS, 8, 1, 20),
    maxAgeHours: int(env.WEBHOOK_MAX_AGE_HOURS, 24, 1, 168),
    requestTimeoutMs: int(env.WEBHOOK_REQUEST_TIMEOUT_MS, 10_000, 1000, 30_000),
    connectTimeoutMs: int(env.WEBHOOK_CONNECT_TIMEOUT_MS, 5000, 500, 15_000),
  };
}

/** Problems worth a boot-time warning (never prints values). */
export function describeWebhookConfigProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  const problems: string[] = [];
  if (readWebhookConfig(env).encryptionKey === null) {
    problems.push('WEBHOOK_SECRET_ENCRYPTION_KEY must be 32 random bytes, base64 encoded (openssl rand -base64 32).');
  }
  return problems;
}
