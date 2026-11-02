/**
 * Where an API key may come from: `Authorization: Bearer <key>` or the legacy
 * `x-api-key` header. NEVER the query string or body. Sending both with different
 * values is rejected (ambiguous credentials), not silently resolved.
 */
export const MAX_API_KEY_LENGTH = 128;
const BEARER = /^Bearer[ \t]+(\S+)$/i;

export type ApiKeyCredential =
  | { kind: 'none' }
  | { kind: 'key'; key: string }
  | { kind: 'invalid' };

interface HeaderSource {
  header(name: string): string | undefined;
}

export function extractApiKeyCredential(req: HeaderSource): ApiKeyCredential {
  const authorization = req.header('authorization');
  const bearer = authorization ? BEARER.exec(authorization.trim())?.[1] : undefined;
  const legacy = req.header('x-api-key')?.trim() || undefined;

  if (bearer && legacy && bearer !== legacy) return { kind: 'invalid' };
  const key = bearer ?? legacy;
  if (key === undefined) return { kind: 'none' };
  if (key.length > MAX_API_KEY_LENGTH || /[,\s]/.test(key)) return { kind: 'invalid' };
  return { kind: 'key', key };
}
