export const TABLES = {
  admins: 'admins',
  serviceTokens: 'service_tokens',
  upstreamKeys: 'upstream_keys',
  auditLogs: 'audit_logs',
  usageDaily: 'usage_daily',
  banEvents: 'ban_events',
} as const;

export interface ServiceTokenRow {
  id: string;
  name: string;
  token_hash: string;
  status: TokenStatus;
  app_name: string;
  app_url: string;
  rate_limit_per_minute: number;
  daily_request_limit: number;
  last_used_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpstreamKeyRow {
  id: string;
  label: string;
  encrypted_key: string;
  weight: number;
  status: UpstreamKeyStatus;
  failure_count: number;
  cooldown_until: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}
