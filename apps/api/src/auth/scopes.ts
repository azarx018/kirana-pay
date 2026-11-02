/**
 * API key scopes. Least privilege: a key only gets what it was issued with.
 * There is deliberately NO scope that can mark an invoice as paid: confirmation
 * is a session-only, human action.
 */
export const API_KEY_SCOPES = [
  'invoices:read',
  'invoices:write',
  'payment_links:read',
  'payment_links:write',
  'qr:convert',
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/**
 * Applied only when a create request omits `scopes` (keeps the pre-V4 dashboard
 * working) and used to backfill pre-V4 keys: exactly the abilities they already had.
 */
export const LEGACY_DEFAULT_SCOPES: readonly ApiKeyScope[] = ['invoices:read', 'invoices:write', 'qr:convert'];

export const MAX_KEY_LIFETIME_DAYS = 366;

export class ApiKeyInputError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function isApiKeyScope(value: unknown): value is ApiKeyScope {
  return typeof value === 'string' && (API_KEY_SCOPES as readonly string[]).includes(value);
}

/** Validates, de-duplicates and orders scopes canonically. Throws ApiKeyInputError. */
export function normalizeScopes(input: unknown): ApiKeyScope[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new ApiKeyInputError('INVALID_SCOPE', 'At least one scope is required.');
  }
  const unknown = input.filter((s) => !isApiKeyScope(s));
  if (unknown.length > 0) {
    throw new ApiKeyInputError('INVALID_SCOPE', `Unknown scope. Allowed: ${API_KEY_SCOPES.join(', ')}.`);
  }
  const wanted = new Set<string>(input as string[]);
  return API_KEY_SCOPES.filter((s) => wanted.has(s));
}

/** Optional expiry: must be a valid future instant within MAX_KEY_LIFETIME_DAYS. */
export function resolveKeyExpiry(input: unknown, now: Date = new Date()): Date | null {
  if (input === undefined || input === null || input === '') return null;
  const at = typeof input === 'string' ? new Date(input) : null;
  if (!at || Number.isNaN(at.getTime())) {
    throw new ApiKeyInputError('INVALID_EXPIRY', 'expiresAt must be an ISO 8601 timestamp.');
  }
  if (at.getTime() <= now.getTime()) {
    throw new ApiKeyInputError('INVALID_EXPIRY', 'expiresAt must be in the future.');
  }
  if (at.getTime() > now.getTime() + MAX_KEY_LIFETIME_DAYS * 86_400_000) {
    throw new ApiKeyInputError('INVALID_EXPIRY', `expiresAt must be within ${MAX_KEY_LIFETIME_DAYS} days.`);
  }
  return at;
}
