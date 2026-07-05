import type { Env } from '../../types/env';
import type { ServiceTokenRow, UpstreamKeyRow } from '../db/schema';
import { nowIso, randomId } from '../utils/common';
import { decryptSecret, encryptSecret, sha256Hex } from '../utils/security';

function mapServiceToken(row: ServiceTokenRow): ServiceTokenRecord {
  return {
    id: row.id,
    name: row.name,
    tokenHash: row.token_hash,
    status: row.status,
    appName: row.app_name,
    appUrl: row.app_url,
    rateLimitPerMinute: row.rate_limit_per_minute,
    dailyRequestLimit: row.daily_request_limit,
    lastUsedAt: row.last_used_at,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function ensureBootstrapAdmin(env: Env) {
  await env.DB.prepare('INSERT OR IGNORE INTO admins (id, name, created_at) VALUES (?, ?, ?)')
    .bind('admin_bootstrap', 'Bootstrap Admin', nowIso())
    .run();
}

export async function createServiceToken(env: Env, input: {
  name: string;
  appName: string;
  appUrl: string;
  notes?: string;
  rateLimitPerMinute: number;
  dailyRequestLimit: number;
}) {
  const plainToken = randomId('svc') + '_' + crypto.randomUUID().replace(/-/g, '');
  const tokenHash = await sha256Hex(plainToken);
  const id = randomId('tok');
  const now = nowIso();

  await env.DB.prepare(
    `INSERT INTO service_tokens (
      id, name, token_hash, status, app_name, app_url,
      rate_limit_per_minute, daily_request_limit, notes, created_at, updated_at
    ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      input.name,
      tokenHash,
      input.appName,
      input.appUrl,
      input.rateLimitPerMinute,
      input.dailyRequestLimit,
      input.notes ?? null,
      now,
      now,
    )
    .run();

  const row = await env.DB.prepare('SELECT * FROM service_tokens WHERE id = ?').bind(id).first<ServiceTokenRow>();
  if (!row) {
    throw new Error('Failed to create service token');
  }

  return {
    plainToken,
    record: mapServiceToken(row),
  };
}

export async function listServiceTokens(env: Env) {
  const result = await env.DB.prepare('SELECT * FROM service_tokens ORDER BY created_at DESC').all<ServiceTokenRow>();
  return (result.results ?? []).map(mapServiceToken);
}

export async function getServiceTokenByPlainText(env: Env, token: string): Promise<ServiceTokenRecord | null> {
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare('SELECT * FROM service_tokens WHERE token_hash = ?').bind(tokenHash).first<ServiceTokenRow>();
  return row ? mapServiceToken(row) : null;
}

export async function updateServiceTokenStatus(env: Env, tokenId: string, status: TokenStatus, reason?: string) {
  const now = nowIso();
  await env.DB.prepare('UPDATE service_tokens SET status = ?, updated_at = ? WHERE id = ?').bind(status, now, tokenId).run();
  await env.DB.prepare('INSERT INTO ban_events (id, token_id, action, reason, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(randomId('ban'), tokenId, status, reason ?? null, now)
    .run();
}

export async function touchServiceToken(env: Env, tokenId: string) {
  await env.DB.prepare('UPDATE service_tokens SET last_used_at = ?, updated_at = ? WHERE id = ?')
    .bind(nowIso(), nowIso(), tokenId)
    .run();
}

export async function createUpstreamKey(env: Env, input: { label: string; key: string; weight: number }) {
  const id = randomId('key');
  const now = nowIso();
  const encrypted = await encryptSecret(input.key, env.KEY_ENCRYPTION_SECRET);
  await env.DB.prepare(
    `INSERT INTO upstream_keys (
      id, label, encrypted_key, weight, status, failure_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'active', 0, ?, ?)`
  )
    .bind(id, input.label, encrypted, input.weight, now, now)
    .run();
}

export async function listUpstreamKeys(env: Env) {
  const result = await env.DB.prepare('SELECT * FROM upstream_keys ORDER BY created_at DESC').all<UpstreamKeyRow>();
  return (result.results ?? []).map((row) => ({
    id: row.id,
    label: row.label,
    weight: row.weight,
    status: row.status,
    failureCount: row.failure_count,
    cooldownUntil: row.cooldown_until,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function setUpstreamKeyStatus(env: Env, keyId: string, status: UpstreamKeyStatus) {
  await env.DB.prepare('UPDATE upstream_keys SET status = ?, updated_at = ? WHERE id = ?')
    .bind(status, nowIso(), keyId)
    .run();
}

export async function pickUpstreamKey(env: Env): Promise<{ id: string; label: string; secret: string } | null> {
  const result = await env.DB.prepare(
    `SELECT * FROM upstream_keys
     WHERE status = 'active' AND (cooldown_until IS NULL OR cooldown_until < ?)
     ORDER BY weight DESC, failure_count ASC, updated_at ASC
     LIMIT 1`
  )
    .bind(nowIso())
    .all<UpstreamKeyRow>();

  const row = result.results?.[0];
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    label: row.label,
    secret: await decryptSecret(row.encrypted_key, env.KEY_ENCRYPTION_SECRET),
  };
}

export async function recordUpstreamKeySuccess(env: Env, keyId: string) {
  await env.DB.prepare(
    'UPDATE upstream_keys SET failure_count = 0, cooldown_until = NULL, last_used_at = ?, updated_at = ? WHERE id = ?'
  )
    .bind(nowIso(), nowIso(), keyId)
    .run();
}

export async function recordUpstreamKeyFailure(env: Env, keyId: string) {
  const cooldownUntil = new Date(Date.now() + 60_000).toISOString();
  await env.DB.prepare(
    'UPDATE upstream_keys SET failure_count = failure_count + 1, cooldown_until = ?, updated_at = ? WHERE id = ?'
  )
    .bind(cooldownUntil, nowIso(), keyId)
    .run();
}

export async function appendAuditLog(env: Env, input: {
  requestId: string;
  actorType: 'admin' | 'service_token' | 'system';
  actorId?: string | null;
  tokenId?: string | null;
  eventType: string;
  method?: string | null;
  path?: string | null;
  appName?: string | null;
  appUrl?: string | null;
  model?: string | null;
  statusCode?: number | null;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  message?: string | null;
}) {
  await env.DB.prepare(
    `INSERT INTO audit_logs (
      id, request_id, actor_type, actor_id, token_id, event_type, method, path,
      app_name, app_url, model, status_code, prompt_tokens, completion_tokens,
      total_tokens, message, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      randomId('audit'),
      input.requestId,
      input.actorType,
      input.actorId ?? null,
      input.tokenId ?? null,
      input.eventType,
      input.method ?? null,
      input.path ?? null,
      input.appName ?? null,
      input.appUrl ?? null,
      input.model ?? null,
      input.statusCode ?? null,
      input.promptTokens ?? 0,
      input.completionTokens ?? 0,
      input.totalTokens ?? 0,
      input.message ?? null,
      nowIso(),
    )
    .run();
}

export async function incrementUsageDaily(env: Env, tokenId: string, usage: {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}) {
  const usageDate = new Date().toISOString().slice(0, 10);
  await env.DB.prepare(
    `INSERT INTO usage_daily (
      usage_date, token_id, request_count, prompt_tokens, completion_tokens, total_tokens, updated_at
    ) VALUES (?, ?, 1, ?, ?, ?, ?)
    ON CONFLICT(usage_date, token_id) DO UPDATE SET
      request_count = usage_daily.request_count + 1,
      prompt_tokens = usage_daily.prompt_tokens + excluded.prompt_tokens,
      completion_tokens = usage_daily.completion_tokens + excluded.completion_tokens,
      total_tokens = usage_daily.total_tokens + excluded.total_tokens,
      updated_at = excluded.updated_at`
  )
    .bind(usageDate, tokenId, usage.promptTokens, usage.completionTokens, usage.totalTokens, nowIso())
    .run();
}

export async function getDashboardSummary(env: Env) {
  const [tokenCountRow, activeKeyRow, auditCountRow, usageRow] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS total FROM service_tokens').first<{ total: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM upstream_keys WHERE status = 'active'").first<{ total: number }>(),
    env.DB.prepare('SELECT COUNT(*) AS total FROM audit_logs').first<{ total: number }>(),
    env.DB.prepare('SELECT COALESCE(SUM(total_tokens), 0) AS total FROM usage_daily').first<{ total: number }>(),
  ]);

  return {
    tokenCount: tokenCountRow?.total ?? 0,
    activeUpstreamKeyCount: activeKeyRow?.total ?? 0,
    auditLogCount: auditCountRow?.total ?? 0,
    totalTokensUsed: usageRow?.total ?? 0,
  };
}

export async function listRecentAudits(env: Env) {
  const result = await env.DB.prepare(
    `SELECT id, request_id, actor_type, actor_id, token_id, event_type, method, path,
            app_name, app_url, model, status_code, prompt_tokens, completion_tokens,
            total_tokens, message, created_at
     FROM audit_logs ORDER BY created_at DESC LIMIT 100`
  ).all<Record<string, unknown>>();
  return result.results ?? [];
}

export async function getTokenDailyUsage(env: Env) {
  const result = await env.DB.prepare(
    `SELECT usage_date, token_id, request_count, total_tokens, updated_at
     FROM usage_daily ORDER BY usage_date DESC, updated_at DESC LIMIT 100`
  ).all<Record<string, unknown>>();
  return result.results ?? [];
}
