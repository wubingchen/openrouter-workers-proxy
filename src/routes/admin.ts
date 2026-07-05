import { Hono } from 'hono';
import type { Env } from '../../types/env';
import { requireAdminSession, requireCsrf } from '../middleware/auth';
import {
  appendAuditLog,
  createServiceToken,
  createUpstreamKey,
  ensureBootstrapAdmin,
  getDashboardSummary,
  getTokenDailyUsage,
  listRecentAudits,
  listServiceTokens,
  listUpstreamKeys,
  setUpstreamKeyStatus,
  updateServiceTokenStatus,
} from '../services/repository';
import {
  buildCookie,
  buildDeleteCookie,
  jsonError,
  jsonOk,
  parseInteger,
  randomId,
  readJsonBody,
  sanitizeText,
  sanitizeUrl,
} from '../utils/common';
import { sha256Hex, signSessionPayload } from '../utils/security';

const adminRoutes = new Hono<{ Bindings: Env }>();

function publicTokenView(token: ServiceTokenRecord) {
  const { tokenHash, ...rest } = token;
  void tokenHash;
  return rest;
}

adminRoutes.post('/login', async (c) => {
  const env = c.env;
  const body = await readJsonBody<{ bootstrapToken?: unknown }>(c.req.raw).catch(() => null);
  const bootstrapToken = sanitizeText(body?.bootstrapToken, 256);

  if (!bootstrapToken) {
    return jsonError(c, 400, '请输入管理员引导令牌');
  }

  const providedHash = await sha256Hex(bootstrapToken);
  const expectedHash = await sha256Hex(env.ADMIN_BOOTSTRAP_TOKEN);
  if (providedHash !== expectedHash) {
    await appendAuditLog(env, {
      requestId: c.get('requestId'),
      actorType: 'system',
      eventType: 'admin_login_failed',
      method: 'POST',
      path: '/api/admin/login',
      message: 'Invalid bootstrap token',
    });
    return jsonError(c, 401, '管理员引导令牌无效');
  }

  await ensureBootstrapAdmin(env);

  const ttlSeconds = parseInteger(env.ADMIN_SESSION_TTL_SECONDS, 28800);
  const sessionId = randomId('sess');
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const payload: AdminSession = {
    sessionId,
    adminId: 'admin_bootstrap',
    expiresAt,
  };
  const sessionToken = await signSessionPayload(payload as unknown as Record<string, unknown>, env.SESSION_SIGNING_SECRET);
  const csrfToken = randomId('csrf');

  await env.CACHE.put(`admin_session:${sessionId}`, JSON.stringify(payload), { expirationTtl: ttlSeconds });

  c.header(
    'Set-Cookie',
    buildCookie(env.SESSION_COOKIE_NAME || 'wb_admin_session', sessionToken, {
      maxAge: ttlSeconds,
      httpOnly: true,
      sameSite: 'Strict',
      path: '/',
      secure: true,
    }),
    { append: true },
  );
  c.header(
    'Set-Cookie',
    buildCookie(env.CSRF_COOKIE_NAME || 'wb_admin_csrf', csrfToken, {
      maxAge: ttlSeconds,
      httpOnly: false,
      sameSite: 'Strict',
      path: '/',
      secure: true,
    }),
    { append: true },
  );

  await appendAuditLog(env, {
    requestId: c.get('requestId'),
    actorType: 'admin',
    actorId: 'admin_bootstrap',
    eventType: 'admin_login_success',
    method: 'POST',
    path: '/api/admin/login',
    message: 'Bootstrap admin login successful',
  });

  return jsonOk(c, {
    csrfToken,
    admin: {
      id: 'admin_bootstrap',
      name: 'Bootstrap Admin',
      expiresAt,
    },
  });
});

adminRoutes.use('*', requireAdminSession);

adminRoutes.get('/me', async (c) => {
  const session = c.get('adminSession');
  return jsonOk(c, {
    admin: {
      id: session.adminId,
      sessionId: session.sessionId,
      expiresAt: session.expiresAt,
    },
  });
});

adminRoutes.post('/logout', requireCsrf, async (c) => {
  const env = c.env;
  const session = c.get('adminSession');
  await env.CACHE.delete(`admin_session:${session.sessionId}`);
  c.header('Set-Cookie', buildDeleteCookie(env.SESSION_COOKIE_NAME || 'wb_admin_session', true), { append: true });
  c.header('Set-Cookie', buildDeleteCookie(env.CSRF_COOKIE_NAME || 'wb_admin_csrf', false), { append: true });

  await appendAuditLog(env, {
    requestId: c.get('requestId'),
    actorType: 'admin',
    actorId: session.adminId,
    eventType: 'admin_logout',
    method: 'POST',
    path: '/api/admin/logout',
  });

  return jsonOk(c, {});
});

adminRoutes.get('/dashboard', async (c) => {
  const [summary, audits, usage] = await Promise.all([
    getDashboardSummary(c.env),
    listRecentAudits(c.env),
    getTokenDailyUsage(c.env),
  ]);
  return jsonOk(c, { summary, audits, usage });
});

adminRoutes.get('/tokens', async (c) => {
  const tokens = await listServiceTokens(c.env);
  return jsonOk(c, { tokens: tokens.map(publicTokenView) });
});

adminRoutes.post('/tokens', requireCsrf, async (c) => {
  const env = c.env;
  const body = await readJsonBody<{
    name?: unknown;
    appName?: unknown;
    appUrl?: unknown;
    notes?: unknown;
    rateLimitPerMinute?: unknown;
    dailyRequestLimit?: unknown;
  }>(c.req.raw).catch(() => null);

  const name = sanitizeText(body?.name, 80);
  const appName = sanitizeText(body?.appName, 80);
  const appUrl = sanitizeUrl(body?.appUrl);
  const notes = sanitizeText(body?.notes, 200);
  const rateLimitPerMinute = Math.min(Math.max(Number(body?.rateLimitPerMinute ?? 60), 1), 600);
  const dailyRequestLimit = Math.min(Math.max(Number(body?.dailyRequestLimit ?? 10000), 1), 1_000_000);

  if (!name || !appName || !appUrl) {
    return jsonError(c, 400, 'name、appName、appUrl 为必填项');
  }

  const created = await createServiceToken(env, {
    name,
    appName,
    appUrl,
    notes,
    rateLimitPerMinute,
    dailyRequestLimit,
  });

  await appendAuditLog(env, {
    requestId: c.get('requestId'),
    actorType: 'admin',
    actorId: c.get('adminSession').adminId,
    tokenId: created.record.id,
    eventType: 'service_token_created',
    method: 'POST',
    path: '/api/admin/tokens',
    appName,
    appUrl,
    message: `Created service token ${created.record.name}`,
  });

  return jsonOk(c, {
    token: publicTokenView(created.record),
    plainToken: created.plainToken,
  }, 201);
});

adminRoutes.post('/tokens/:id/status', requireCsrf, async (c) => {
  const tokenId = sanitizeText(c.req.param('id'), 80);
  const body = await readJsonBody<{ status?: unknown; reason?: unknown }>(c.req.raw).catch(() => null);
  const status = sanitizeText(body?.status, 20) as TokenStatus;
  const reason = sanitizeText(body?.reason, 120);

  if (!tokenId || !['active', 'disabled', 'revoked'].includes(status)) {
    return jsonError(c, 400, '无效的服务 Token 状态');
  }

  await updateServiceTokenStatus(c.env, tokenId, status, reason);
  await appendAuditLog(c.env, {
    requestId: c.get('requestId'),
    actorType: 'admin',
    actorId: c.get('adminSession').adminId,
    tokenId,
    eventType: 'service_token_status_changed',
    method: 'POST',
    path: `/api/admin/tokens/${tokenId}/status`,
    message: `${status}${reason ? `: ${reason}` : ''}`,
  });

  return jsonOk(c, {});
});

adminRoutes.get('/upstream-keys', async (c) => {
  const upstreamKeys = await listUpstreamKeys(c.env);
  return jsonOk(c, { upstreamKeys });
});

adminRoutes.post('/upstream-keys', requireCsrf, async (c) => {
  const body = await readJsonBody<{ label?: unknown; key?: unknown; weight?: unknown }>(c.req.raw).catch(() => null);
  const label = sanitizeText(body?.label, 80);
  const key = sanitizeText(body?.key, 256);
  const weight = Math.min(Math.max(Number(body?.weight ?? 1), 1), 100);

  if (!label || !key) {
    return jsonError(c, 400, 'label 与 key 为必填项');
  }

  await createUpstreamKey(c.env, { label, key, weight });
  await appendAuditLog(c.env, {
    requestId: c.get('requestId'),
    actorType: 'admin',
    actorId: c.get('adminSession').adminId,
    eventType: 'upstream_key_created',
    method: 'POST',
    path: '/api/admin/upstream-keys',
    message: `Created upstream key ${label}`,
  });

  return jsonOk(c, {}, 201);
});

adminRoutes.post('/upstream-keys/:id/status', requireCsrf, async (c) => {
  const keyId = sanitizeText(c.req.param('id'), 80);
  const body = await readJsonBody<{ status?: unknown }>(c.req.raw).catch(() => null);
  const status = sanitizeText(body?.status, 20) as UpstreamKeyStatus;

  if (!keyId || !['active', 'disabled', 'cooldown'].includes(status)) {
    return jsonError(c, 400, '无效的上游 Key 状态');
  }

  await setUpstreamKeyStatus(c.env, keyId, status);
  await appendAuditLog(c.env, {
    requestId: c.get('requestId'),
    actorType: 'admin',
    actorId: c.get('adminSession').adminId,
    eventType: 'upstream_key_status_changed',
    method: 'POST',
    path: `/api/admin/upstream-keys/${keyId}/status`,
    message: status,
  });

  return jsonOk(c, {});
});

adminRoutes.get('/audits', async (c) => {
  const audits = await listRecentAudits(c.env);
  return jsonOk(c, { audits });
});

adminRoutes.get('/usage-daily', async (c) => {
  const usage = await getTokenDailyUsage(c.env);
  return jsonOk(c, { usage });
});

export default adminRoutes;
