import { Hono, type Context } from 'hono';
import type { Env } from '../../types/env';
import { requireServiceToken } from '../middleware/auth';
import { buildUpstreamHeaders, extractModelFromBody, parseUsage } from '../services/privacy';
import {
  appendAuditLog,
  incrementUsageDaily,
  pickUpstreamKey,
  recordUpstreamKeyFailure,
  recordUpstreamKeySuccess,
  touchServiceToken,
} from '../services/repository';
import { checkRateLimit } from '../services/rate-limit';
import { jsonError } from '../utils/common';

const proxyRoutes = new Hono<{ Bindings: Env }>();

function assertTrustedUpstream(baseUrl: string) {
  const url = new URL(baseUrl);
  if (url.origin !== 'https://openrouter.ai' || !url.pathname.startsWith('/api')) {
    throw new Error('UPSTREAM_BASE_URL must target https://openrouter.ai/api');
  }
  return url;
}

proxyRoutes.use('/v1/*', requireServiceToken);
proxyRoutes.use('/api/v1/*', requireServiceToken);

const proxyHandler = async (c: Context<{ Bindings: Env }>) => {
  const env = c.env;
  const serviceToken = c.get('serviceToken');
  const requestId = c.get('requestId');
  const today = new Date().toISOString().slice(0, 10);

  const dailyQuota = await checkRateLimit(env, {
    scope: `quota:${serviceToken.id}:${today}`,
    limit: serviceToken.dailyRequestLimit,
    windowSeconds: 86400,
  });
  if (!dailyQuota.allowed) {
    await appendAuditLog(env, {
      requestId,
      actorType: 'service_token',
      actorId: serviceToken.id,
      tokenId: serviceToken.id,
      eventType: 'proxy_daily_quota_exceeded',
      method: c.req.method,
      path: c.req.path,
      appName: serviceToken.appName,
      appUrl: serviceToken.appUrl,
      statusCode: 429,
      message: 'Daily quota exceeded',
    });
    return jsonError(c, 429, '服务 Token 日配额已耗尽');
  }

  const upstreamKey = await pickUpstreamKey(env);
  if (!upstreamKey) {
    await appendAuditLog(env, {
      requestId,
      actorType: 'system',
      tokenId: serviceToken.id,
      eventType: 'proxy_no_upstream_key',
      method: c.req.method,
      path: c.req.path,
      appName: serviceToken.appName,
      appUrl: serviceToken.appUrl,
      statusCode: 503,
      message: 'No active upstream key available',
    });
    return jsonError(c, 503, '当前没有可用的上游 OpenRouter Key');
  }

  let upstreamBase: URL;
  try {
    upstreamBase = assertTrustedUpstream(env.UPSTREAM_BASE_URL);
  } catch (error) {
    return jsonError(c, 500, error instanceof Error ? error.message : '上游配置无效');
  }

  const requestUrl = new URL(c.req.url);
  const upstreamPath = (c.req.path.startsWith('/api') ? c.req.path.slice(4) : c.req.path).replace(/^\//, '');
  const upstreamUrl = new URL(upstreamPath, `${upstreamBase.toString().replace(/\/$/, '')}/`);
  upstreamUrl.search = requestUrl.search;
  const rawBody = ['GET', 'HEAD'].includes(c.req.method) ? undefined : await c.req.raw.arrayBuffer();
  const model = rawBody ? await extractModelFromBody(rawBody, c.req.header('content-type') ?? null) : null;

  try {
    const upstreamResponse = await fetch(upstreamUrl.toString(), {
      method: c.req.method,
      headers: buildUpstreamHeaders(c.req.raw, {
        upstreamApiKey: upstreamKey.secret,
        appName: serviceToken.appName,
        appUrl: serviceToken.appUrl,
        requestId,
      }),
      body: rawBody,
      redirect: 'manual',
    });

    await touchServiceToken(env, serviceToken.id);

    const contentType = upstreamResponse.headers.get('content-type') ?? '';
    const shouldInspectBody = contentType.includes('application/json') && !contentType.includes('text/event-stream');

    let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    if (shouldInspectBody) {
      const responseText = await upstreamResponse.clone().text();
      usage = parseUsage(responseText);
      await incrementUsageDaily(env, serviceToken.id, usage);
    }

    if (upstreamResponse.ok) {
      await recordUpstreamKeySuccess(env, upstreamKey.id);
    } else if (upstreamResponse.status >= 500) {
      await recordUpstreamKeyFailure(env, upstreamKey.id);
    }

    await appendAuditLog(env, {
      requestId,
      actorType: 'service_token',
      actorId: serviceToken.id,
      tokenId: serviceToken.id,
      eventType: 'proxy_request',
      method: c.req.method,
      path: c.req.path,
      appName: serviceToken.appName,
      appUrl: serviceToken.appUrl,
      model,
      statusCode: upstreamResponse.status,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      message: upstreamResponse.ok ? 'Proxy success' : 'Proxy upstream error',
    });

    const responseHeaders = new Headers();
    upstreamResponse.headers.forEach((value, name) => {
      const lowerName = name.toLowerCase();
      if (['content-type', 'cache-control', 'content-encoding', 'retry-after'].includes(lowerName)) {
        responseHeaders.set(name, value);
      }
    });
    responseHeaders.set('x-request-id', requestId);

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  } catch (error) {
    await recordUpstreamKeyFailure(env, upstreamKey.id);
    await appendAuditLog(env, {
      requestId,
      actorType: 'service_token',
      actorId: serviceToken.id,
      tokenId: serviceToken.id,
      eventType: 'proxy_exception',
      method: c.req.method,
      path: c.req.path,
      appName: serviceToken.appName,
      appUrl: serviceToken.appUrl,
      model,
      statusCode: 502,
      message: error instanceof Error ? error.message.slice(0, 180) : 'Unknown proxy error',
    });
    return jsonError(c, 502, '转发 OpenRouter 请求失败');
  }
};

proxyRoutes.all('/v1/*', proxyHandler);
proxyRoutes.all('/api/v1/*', proxyHandler);

export default proxyRoutes;
