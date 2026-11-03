import { isIP } from 'node:net';

export interface UrlPolicy {
  /** Dev/e2e only (never in production): allows http, localhost, private hosts and any port. */
  devAllowPrivate: boolean;
  allowedPorts: readonly number[];
}

export type UrlCheck =
  | { ok: true; url: string; host: string }
  | { ok: false; code: 'INVALID_WEBHOOK_URL'; message: string };

export const MAX_URL_LENGTH = 2048;

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.home.arpa', '.lan', '.intranet', '.corp'];

function reject(message: string): UrlCheck {
  return { ok: false, code: 'INVALID_WEBHOOK_URL', message };
}

/**
 * STATIC checks done when an endpoint is saved. This is only the first layer: the address a
 * hostname resolves to is checked again, at connection time, by the sender (DNS can change).
 */
export function validateWebhookUrl(raw: unknown, policy: UrlPolicy): UrlCheck {
  if (typeof raw !== 'string') return reject('url must be a string.');
  const text = raw.trim();
  if (text.length === 0 || text.length > MAX_URL_LENGTH) return reject(`url must be 1-${MAX_URL_LENGTH} characters.`);

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return reject('url is not a valid absolute URL.');
  }

  if (url.protocol !== 'https:' && !(policy.devAllowPrivate && url.protocol === 'http:')) {
    return reject('url must use https.');
  }
  if (url.username || url.password) return reject('url must not contain credentials.');
  if (url.hash) return reject('url must not contain a fragment.');

  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!host) return reject('url must have a host.');

  if (!policy.devAllowPrivate) {
    if (isIP(host) !== 0) return reject('url must use a DNS name, not an IP address.');
    if (host === 'localhost' || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
      return reject('url host is not allowed.');
    }
    if (!host.includes('.')) return reject('url host must be a fully qualified domain name.');
    if (url.port !== '' && !policy.allowedPorts.includes(Number(url.port))) {
      return reject(`url port is not allowed (allowed: ${policy.allowedPorts.join(', ')}).`);
    }
  }

  const display = url.port ? `${host}:${url.port}` : host;
  return { ok: true, url: url.toString(), host: display };
}
