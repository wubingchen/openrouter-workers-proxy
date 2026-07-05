import type { MiddlewareHandler } from 'hono';
import type { Env } from '../../types/env';
import { getCookie } from 'hono/cookie';
import { getServiceTokenByPlainText } from '../services/repository';
import { buildIpRateLimitScope, checkRateLimit } from '../services/rate-limit';
import { jsonError } from '../utils/common';
import { verifySessionPayload } from '../utils/security';

function getEnv(c: { env: Env }) {
  return c.env;
}

export const requireAdminSession: MiddlewareHandler = async (c, next) => {
  const env = getEnv(c);
  if (!env.CACHE) {
    return jsonError(c, 500, 'KV 缓存未绑定，请检查 Worker 设置 → Bindings 中的 CACHE 是否正确');
  }
  const cookieName = env.SESSION_COOKIE_NAME || 'wb_admin_session';
  const cookieValue = getCookie(c, cookieName);

  if (!cookieValue) {
    return jsonError(c, 401, '管理员未登录');
  }

  const payload = await verifySessionPayload<AdminSession>(cookieValue, env.SESSION_SIGNING_SECRET);
  if (!payload) {
    return jsonError(c, 401, '管理员会话无效');
  }

  const expiresAt = Date.parse(payload.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return jsonError(c, 401, '管理员会话已过期');
  }

  try {
    const sessionValue = await env.CACHE.get(`admin_session:${payload.sessionId}`);
    if (!sessionValue) {
      return jsonError(c, 401, '管理员会话不存在');
    }
    c.set('adminSession', payload);
    await next();
  } catch (error) {
    console.error('[requireAdminSession] KV error:', error);
    return jsonError(c, 500, '会话验证失败，请检查 KV 绑定');
  }
};

export const requireCsrf: MiddlewareHandler = async (c, next) => {
  const env = getEnv(c);
  const cookieName = env.CSRF_COOKIE_NAME || 'wb_admin_csrf';
  const cookieValue = getCookie(c, cookieName);
  const headerValue = c.req.header('x-csrf-token');

  if (!cookieValue || !headerValue || cookieValue !== headerValue) {
    return jsonError(c, 403, 'CSRF 校验失败');
  }

  await next();
};

export const requireServiceToken: MiddlewareHandler = async (c, next) => {
  const env = getEnv(c);
  const authHeader = c.req.header('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';

  if (!token) {
    return jsonError(c, 401, '缺少服务 Token');
  }

  const serviceToken = await getServiceTokenByPlainText(env, token);
  if (!serviceToken || serviceToken.status !== 'active') {
    return jsonError(c, 403, '服务 Token 无效或已停用');
  }

  const ipRateLimit = await checkRateLimit(env, {
    scope: await buildIpRateLimitScope(env, c.req.raw),
    limit: Math.max(serviceToken.rateLimitPerMinute * 2, 30),
    windowSeconds: 60,
  });
  if (!ipRateLimit.allowed) {
    return jsonError(c, 429, 'IP 限流触发');
  }

  const tokenRateLimit = await checkRateLimit(env, {
    scope: `rl:token:${serviceToken.id}`,
    limit: serviceToken.rateLimitPerMinute,
    windowSeconds: 60,
  });
  if (!tokenRateLimit.allowed) {
    return jsonError(c, 429, '服务 Token 限流触发');
  }

  c.set('serviceToken', serviceToken);
  await next();
};

export default { requireAdminSession, requireCsrf, requireServiceToken };
