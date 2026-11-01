import { isProduction } from '../common/runtime-config';

export const MIN_SECRET_LENGTH = 32;
/** Used ONLY outside production when PAYMENT_LINK_SECRET is unset, so local dev just works. */
const DEV_SECRET = 'kirana-dev-only-payment-link-secret-0001';
const DEV_BASE_URL = 'http://localhost:3100';

/**
 * HMAC secret for payment link tokens. Returns null when it must not be used
 * (production without a secret, or a secret that is too short).
 */
export function resolvePaymentLinkSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.PAYMENT_LINK_SECRET?.trim();
  if (raw) return raw.length >= MIN_SECRET_LENGTH ? raw : null;
  return isProduction(env) ? null : DEV_SECRET;
}

/**
 * Public origin used to build `/pay/<token>` URLs. Never derived from request headers
 * (Host-header injection). Returns null when missing in production or invalid.
 */
export function resolvePublicBaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.PUBLIC_BASE_URL?.trim();
  if (!raw) return isProduction(env) ? null : DEV_BASE_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/** Human-readable problems for a boot-time warning (never includes secret values). */
export function describePaymentLinkConfigProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  const problems: string[] = [];
  if (resolvePaymentLinkSecret(env) === null) {
    problems.push(`PAYMENT_LINK_SECRET must be set to at least ${MIN_SECRET_LENGTH} characters.`);
  }
  if (resolvePublicBaseUrl(env) === null) {
    problems.push('PUBLIC_BASE_URL must be a valid http(s) origin without credentials, query or hash.');
  }
  return problems;
}
