import { describeWebhookConfigProblems, readWebhookConfig } from './webhook.config';

const prod = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({ NODE_ENV: 'production', ...extra });
const dev = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({ NODE_ENV: 'development', ...extra });
const KEY = Buffer.alloc(32, 7).toString('base64');

describe('readWebhookConfig', () => {
  it('has a dev key fallback outside production only', () => {
    expect(readWebhookConfig(dev()).encryptionKey).toHaveLength(32);
    expect(readWebhookConfig(prod()).encryptionKey).toBeNull();
  });

  it('requires exactly 32 bytes of base64', () => {
    expect(readWebhookConfig(prod({ WEBHOOK_SECRET_ENCRYPTION_KEY: KEY })).encryptionKey).toHaveLength(32);
    expect(readWebhookConfig(prod({ WEBHOOK_SECRET_ENCRYPTION_KEY: 'short' })).encryptionKey).toBeNull();
    expect(readWebhookConfig(dev({ WEBHOOK_SECRET_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') })).encryptionKey).toBeNull();
  });

  it('the dev-only private-destination switch is inert in production', () => {
    expect(readWebhookConfig(dev({ WEBHOOK_DEV_ALLOW_PRIVATE: 'true' })).devAllowPrivate).toBe(true);
    expect(readWebhookConfig(prod({ WEBHOOK_DEV_ALLOW_PRIVATE: 'true' })).devAllowPrivate).toBe(false);
    expect(readWebhookConfig(dev({ WEBHOOK_DEV_ALLOW_PRIVATE: 'yes' })).devAllowPrivate).toBe(false);
    expect(readWebhookConfig(dev()).devAllowPrivate).toBe(false);
  });

  it('uses safe defaults and ignores out-of-range numbers', () => {
    const c = readWebhookConfig(dev({ WEBHOOK_MAX_ATTEMPTS: '9999', WEBHOOK_WORKER_CONCURRENCY: '0', WEBHOOK_POLL_INTERVAL_MS: 'x' }));
    expect(c).toMatchObject({ maxAttempts: 8, workerConcurrency: 4, pollIntervalMs: 2000, maxEndpoints: 5, maxAgeHours: 24, requestTimeoutMs: 10_000 });
    expect([...c.allowedPorts]).toEqual([443, 8443]);
    expect(readWebhookConfig(dev({ WEBHOOK_MAX_ATTEMPTS: '5' })).maxAttempts).toBe(5);
    expect([...readWebhookConfig(dev({ WEBHOOK_ALLOWED_PORTS: '443, 9443,abc' })).allowedPorts]).toEqual([443, 9443]);
  });

  it('can disable the worker per instance', () => {
    expect(readWebhookConfig(dev()).workerEnabled).toBe(true);
    expect(readWebhookConfig(dev({ WEBHOOK_WORKER_ENABLED: 'false' })).workerEnabled).toBe(false);
  });

  it('reports problems without echoing values', () => {
    expect(describeWebhookConfigProblems(prod({ WEBHOOK_SECRET_ENCRYPTION_KEY: 'hunter2hunter2' })).join(' ')).not.toContain('hunter2');
    expect(describeWebhookConfigProblems(prod())).toHaveLength(1);
    expect(describeWebhookConfigProblems(dev())).toEqual([]);
  });
});
