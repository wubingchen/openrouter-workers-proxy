export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  ASSETS: Fetcher;
  ADMIN_BOOTSTRAP_TOKEN: string;
  SESSION_SIGNING_SECRET: string;
  KEY_ENCRYPTION_SECRET: string;
  SESSION_COOKIE_NAME: string;
  CSRF_COOKIE_NAME: string;
  UPSTREAM_BASE_URL: string;
  ADMIN_SESSION_TTL_SECONDS: string;
  DEFAULT_TOKEN_RPM: string;
  DEFAULT_TOKEN_DAILY_LIMIT: string;
}

declare module 'hono' {
  interface ContextVariableMap {
    requestId: string;
    serviceToken: ServiceTokenRecord;
    adminSession: AdminSession;
  }
}

declare global {
  type TokenStatus = 'active' | 'disabled' | 'revoked';
  type UpstreamKeyStatus = 'active' | 'disabled' | 'cooldown';

  interface AdminSession {
    sessionId: string;
    adminId: string;
    expiresAt: string;
  }

  interface ServiceTokenRecord {
    id: string;
    name: string;
    tokenHash: string;
    status: TokenStatus;
    appName: string;
    appUrl: string;
    rateLimitPerMinute: number;
    dailyRequestLimit: number;
    lastUsedAt: string | null;
    notes: string | null;
    createdAt: string;
    updatedAt: string;
  }
}

export {};
