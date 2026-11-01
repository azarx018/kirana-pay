/** Small, testable helpers for security-relevant runtime configuration. */

export function isProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production";
}

/**
 * Session cookies are `Secure` by default in production. Set COOKIE_SECURE=false
 * explicitly (and knowingly) for plain-HTTP setups such as a private tailnet IP.
 */
export function isCookieSecure(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.COOKIE_SECURE === "true") return true;
  if (env.COOKIE_SECURE === "false") return false;
  return isProduction(env);
}

/** Swagger exposes the full API surface, so it is opt-in in production. */
export function isSwaggerEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.ENABLE_SWAGGER === "true") return true;
  if (env.ENABLE_SWAGGER === "false") return false;
  return !isProduction(env);
}

/**
 * Express `trust proxy` setting. Without it every client behind a reverse proxy
 * (Tailscale Funnel, the Next.js rewrite, Caddy) shares the proxy's IP, so the
 * per-IP rate limiter becomes one global bucket.
 * TRUST_PROXY accepts a hop count ("1", "2") or an Express keyword/subnet.
 */
export function parseTrustProxy(
  raw: string | undefined,
): number | string | false {
  if (raw === undefined || raw.trim() === "") return false;
  const value = raw.trim();
  if (value === "false") return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

/**
 * Throws at boot when a production deployment still uses an insecure default.
 * Escape hatch for a deliberate, temporary rollout: ALLOW_INSECURE_DEFAULTS=true.
 */
export function assertProductionConfig(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isProduction(env) || env.ALLOW_INSECURE_DEFAULTS === 'true') return;
  const problems: string[] = [];
  if (!env.DB_PASSWORD) {
    problems.push(
      "DB_PASSWORD must be set (no default is accepted in production).",
    );
  } else if (env.DB_PASSWORD === "kirana") {
    problems.push('DB_PASSWORD is still the default value "kirana".');
  }
  if (problems.length > 0) {
    throw new Error(
      `Refusing to start with insecure production config:\n- ${problems.join("\n- ")}`,
    );
  }
}
