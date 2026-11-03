import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { lookup as dnsLookup } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { isPublicAddress } from './webhook-ip';
import { buildWebhookHeaders } from './webhook-signer';
import type { WebhookConfig } from './webhook.config';

export type SendCategory = 'SUCCESS' | 'RETRYABLE' | 'TERMINAL' | 'REDIRECT_NOT_FOLLOWED';

export interface SendResult {
  category: SendCategory;
  httpStatus: number | null;
  excerpt: string | null;
  errorCode: string | null;
  retryAfterSeconds: number | null;
}

export interface SendInput {
  url: string;
  secret: string;
  eventId: string;
  payloadJson: string;
  config: WebhookConfig;
}

const MAX_BODY_BYTES = 2048;
const EXCERPT_LENGTH = 256;

function clean(text: string): string {
  // Strip control characters so a hostile receiver cannot inject newlines into our logs.
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, EXCERPT_LENGTH);
}

/**
 * DNS lookup that refuses to connect unless EVERY resolved address is public, and pins the
 * connection to the validated address (no second resolution → no DNS-rebinding TOCTOU).
 */
function safeLookup(config: WebhookConfig): LookupFunction {
  return (hostname, options, callback) => {
    if (config.devAllowPrivate) {
      dnsLookup(hostname, options as never, callback as never);
      return;
    }
    dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) {
        (callback as unknown as (e: Error | null, a: string, f: number) => void)(error, '', 4);
        return;
      }
      const list = Array.isArray(addresses) ? addresses : [];
      if (list.length === 0) {
        (callback as unknown as (e: Error | null, a: string, f: number) => void)(new Error('ENOTFOUND'), '', 4);
        return;
      }
      if (list.some((entry) => !isPublicAddress(entry.address))) {
        (callback as unknown as (e: Error | null, a: string, f: number) => void)(
          new Error('BLOCKED_ADDRESS'),
          '',
          4,
        );
        return;
      }
      const chosen = list[0];
      (callback as unknown as (e: Error | null, a: string, f: number) => void)(
        null,
        chosen.address,
        chosen.family === 6 ? 6 : 4,
      );
    });
  };
}

function classify(status: number): SendCategory {
  if (status >= 200 && status < 300) return 'SUCCESS';
  if (status >= 300 && status < 400) return 'REDIRECT_NOT_FOLLOWED';
  if (status === 408 || status === 425 || status === 429) return 'RETRYABLE';
  if (status >= 500) return 'RETRYABLE';
  return 'TERMINAL';
}

function retryAfterSeconds(headers: Record<string, string | string[] | undefined>): number | null {
  const raw = headers['retry-after'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.floor(seconds), 3600);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.min(Math.max(Math.floor((date - Date.now()) / 1000), 0), 3600);
}

/**
 * One HTTP attempt. Never follows redirects, never uses proxy env vars, reads at most 2 KB and
 * always resolves (failures are classified, not thrown).
 */
export function sendWebhook(input: SendInput): Promise<SendResult> {
  const { url, secret, eventId, payloadJson, config } = input;
  const target = new URL(url);
  const timestamp = Math.floor(Date.now() / 1000);
  const headers = buildWebhookHeaders(secret, eventId, timestamp, payloadJson);
  const isHttps = target.protocol === 'https:';
  const requestFn = isHttps ? httpsRequest : httpRequest;

  return new Promise<SendResult>((resolve) => {
    let settled = false;
    let status: number | null = null;
    let excerpt = '';
    let bytes = 0;
    let timedOut = false;

    const finish = (result: SendResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const req = requestFn(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (isHttps ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(payloadJson) },
        lookup: safeLookup(config),
        servername: isHttps ? target.hostname : undefined,
        rejectUnauthorized: true,
        timeout: config.connectTimeoutMs,
      },
      (res) => {
        status = res.statusCode ?? 0;
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          if (bytes < MAX_BODY_BYTES) {
            excerpt += chunk.slice(0, MAX_BODY_BYTES - bytes);
            bytes += chunk.length;
          }
        });
        res.on('end', () => {
          const category = classify(status ?? 0);
          finish({
            category,
            httpStatus: status,
            excerpt: excerpt ? clean(excerpt) : null,
            errorCode: category === 'REDIRECT_NOT_FOLLOWED' ? 'REDIRECT_NOT_FOLLOWED' : null,
            retryAfterSeconds: retryAfterSeconds(res.headers as Record<string, string | string[] | undefined>),
          });
        });
      },
    );

    const totalTimer = setTimeout(() => {
      timedOut = true;
      req.destroy(new Error('ETIMEDOUT'));
    }, config.requestTimeoutMs);

    req.on('timeout', () => {
      req.destroy(new Error('ECONNECT_TIMEOUT'));
    });

    req.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(totalTimer);
      finish({
        category: 'RETRYABLE',
        httpStatus: null,
        excerpt: null,
        errorCode: timedOut ? 'ETIMEDOUT' : (error.code ?? error.message).slice(0, 40),
        retryAfterSeconds: null,
      });
    });

    req.on('response', () => clearTimeout(totalTimer));
    req.on('close', () => clearTimeout(totalTimer));

    req.end(payloadJson);
  });
}
