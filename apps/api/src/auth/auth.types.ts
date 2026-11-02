export interface AuthContext {
  userId: string;
  merchantId: string;
  role: 'OWNER' | 'STAFF';
  via: 'session' | 'api-key';
  sessionId?: string;
  apiKeyId?: string;
  /** Only set for API-key callers; sessions are not scope-limited. */
  scopes?: readonly string[];
}
