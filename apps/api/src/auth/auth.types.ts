export interface AuthContext {
  userId: string;
  merchantId: string;
  role: 'OWNER' | 'STAFF';
  via: 'session' | 'api-key';
  sessionId?: string;
  apiKeyId?: string;
}
