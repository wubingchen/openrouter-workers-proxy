import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export function nowIso(): string {
  return new Date().toISOString();
}

export function jsonError(c: Context, status: ContentfulStatusCode, message: string, extras?: Record<string, unknown>) {
  return c.json(
    {
      success: false,
      error: message,
      requestId: c.get('requestId'),
      ...extras,
    },
    status,
  );
}

export function jsonOk(c: Context, data: Record<string, unknown> = {}, status: ContentfulStatusCode = 200) {
  return c.json(
    {
      success: true,
      requestId: c.get('requestId'),
      ...data,
    },
    status,
  );
}

export function parseInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function parseCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  const found = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));

  return found ? decodeURIComponent(found.slice(name.length + 1)) : null;
}

export function buildCookie(name: string, value: string, options: {
  maxAge?: number;
  httpOnly?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
  path?: string;
  secure?: boolean;
} = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path ?? '/'}`);
  parts.push(`SameSite=${options.sameSite ?? 'Strict'}`);
  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${options.maxAge}`);
  }
  if (options.httpOnly ?? true) {
    parts.push('HttpOnly');
  }
  if (options.secure ?? true) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function buildDeleteCookie(name: string, httpOnly = true): string {
  return buildCookie(name, '', {
    maxAge: 0,
    path: '/',
    httpOnly,
    secure: true,
    sameSite: 'Strict',
  });
}

export function maskSecret(value: string | null | undefined): string {
  if (!value) {
    return '';
  }

  if (value.length <= 8) {
    return `${value.slice(0, 2)}***`;
  }

  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

export function sanitizeText(value: unknown, maxLength = 120): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, maxLength);
}

export function sanitizeUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 300) {
    return '';
  }

  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return '';
    }
    return url.toString();
  } catch {
    return '';
  }
}

export async function readJsonBody<T>(request: Request): Promise<T> {
  return (await request.json()) as T;
}

export function randomId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const body = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${body}`;
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
