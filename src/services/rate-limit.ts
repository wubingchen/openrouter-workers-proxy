import type { Env } from '../../types/env';
import { sha256Hex } from '../utils/security';

function getWindowStart(windowSeconds: number): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(nowSeconds / windowSeconds) * windowSeconds;
  return new Date(bucket * 1000).toISOString();
}

function getExpiry(windowSeconds: number): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const bucketEnd = Math.floor(nowSeconds / windowSeconds) * windowSeconds + windowSeconds;
  return new Date(bucketEnd * 1000).toISOString();
}

export async function checkRateLimit(env: Env, options: {
  scope: string;
  limit: number;
  windowSeconds: number;
}) {
  const windowStart = getWindowStart(options.windowSeconds);
  const expiresAt = getExpiry(options.windowSeconds);

  const row = await env.DB.prepare(
    `INSERT INTO rate_limit_counters (scope_key, window_start, count, expires_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(scope_key, window_start) DO UPDATE SET
       count = rate_limit_counters.count + 1,
       expires_at = excluded.expires_at
     RETURNING count`
  )
    .bind(options.scope, windowStart, expiresAt)
    .first<{ count: number }>();

  const count = row?.count ?? 1;
  return {
    allowed: count <= options.limit,
    count,
    limit: options.limit,
  };
}

export async function buildIpRateLimitScope(env: Env, request: Request) {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const hashedIp = await sha256Hex(`${env.SESSION_SIGNING_SECRET}:${ip}`);
  return `rl:ip:${hashedIp}`;
}
