import type { Env } from '../../types/env';

const HEADER_ALLOWLIST = [
  'accept',
  'content-type',
  'openrouter-beta',
  'openrouter-organization',
] as const;

export function buildUpstreamHeaders(request: Request, options: {
  upstreamApiKey: string;
  appName: string;
  appUrl: string;
  requestId: string;
}) {
  const headers = new Headers();

  for (const name of HEADER_ALLOWLIST) {
    const value = request.headers.get(name);
    if (value) {
      headers.set(name, value);
    }
  }

  headers.set('authorization', `Bearer ${options.upstreamApiKey}`);
  headers.set('x-request-id', options.requestId);

  if (options.appName) {
    headers.set('x-title', options.appName);
  }

  if (options.appUrl) {
    headers.set('http-referer', options.appUrl);
  }

  return headers;
}

export async function extractModelFromBody(rawBody: ArrayBuffer, contentType: string | null): Promise<string | null> {
  if (!contentType?.toLowerCase().includes('application/json')) {
    return null;
  }

  try {
    const text = new TextDecoder().decode(rawBody);
    const data = JSON.parse(text) as { model?: unknown };
    return typeof data.model === 'string' ? data.model.slice(0, 120) : null;
  } catch {
    return null;
  }
}

export function parseUsage(responseBodyText: string): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
} {
  try {
    const data = JSON.parse(responseBodyText) as {
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };

    return {
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
      totalTokens: data.usage?.total_tokens ?? 0,
    };
  } catch {
    return {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };
  }
}

const MODELS_CACHE_KEY = 'openrouter:models:v1';
const MODELS_CACHE_TTL_SECONDS = 600;

export async function getCachedModels(env: Env): Promise<{ object: string; data: unknown[] } | null> {
  const cached = await env.CACHE.get(MODELS_CACHE_KEY);
  if (!cached) {
    return null;
  }

  try {
    return JSON.parse(cached);
  } catch {
    return null;
  }
}

export async function setCachedModels(env: Env, payload: { object: string; data: unknown[] }): Promise<void> {
  await env.CACHE.put(MODELS_CACHE_KEY, JSON.stringify(payload), {
    expirationTtl: MODELS_CACHE_TTL_SECONDS,
  });
}
