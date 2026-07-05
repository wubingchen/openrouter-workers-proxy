PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS admins (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS service_tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled', 'revoked')),
  app_name TEXT NOT NULL,
  app_url TEXT NOT NULL,
  rate_limit_per_minute INTEGER NOT NULL DEFAULT 60,
  daily_request_limit INTEGER NOT NULL DEFAULT 10000,
  last_used_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS upstream_keys (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  encrypted_key TEXT NOT NULL,
  weight INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled', 'cooldown')),
  failure_count INTEGER NOT NULL DEFAULT 0,
  cooldown_until TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  token_id TEXT,
  event_type TEXT NOT NULL,
  method TEXT,
  path TEXT,
  app_name TEXT,
  app_url TEXT,
  model TEXT,
  status_code INTEGER,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  message TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(token_id) REFERENCES service_tokens(id)
);

CREATE TABLE IF NOT EXISTS usage_daily (
  usage_date TEXT NOT NULL,
  token_id TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (usage_date, token_id),
  FOREIGN KEY(token_id) REFERENCES service_tokens(id)
);

CREATE TABLE IF NOT EXISTS ban_events (
  id TEXT PRIMARY KEY,
  token_id TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(token_id) REFERENCES service_tokens(id)
);

CREATE TABLE IF NOT EXISTS rate_limit_counters (
  scope_key TEXT NOT NULL,
  window_start TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (scope_key, window_start)
);

CREATE INDEX IF NOT EXISTS idx_service_tokens_status ON service_tokens(status);
CREATE INDEX IF NOT EXISTS idx_upstream_keys_status ON upstream_keys(status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_token_id ON audit_logs(token_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_request_id ON audit_logs(request_id);
