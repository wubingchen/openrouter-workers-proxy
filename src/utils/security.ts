import { fromBase64Url, toBase64Url } from './common';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function importHmacKey(secret: string) {
  return crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signSessionPayload(payload: Record<string, unknown>, secret: string): Promise<string> {
  const body = toBase64Url(textEncoder.encode(JSON.stringify(payload)));
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(body));
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifySessionPayload<T>(value: string, secret: string): Promise<T | null> {
  try {
    const [body, signature] = value.split('.');
    if (!body || !signature) {
      return null;
    }

    const key = await importHmacKey(secret);
    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      fromBase64Url(signature) as unknown as BufferSource,
      textEncoder.encode(body),
    );

    if (!isValid) {
      return null;
    }

    return JSON.parse(textDecoder.decode(fromBase64Url(body))) as T;
  } catch {
    return null;
  }
}

async function importAesKey(secret: string) {
  const material = await crypto.subtle.digest('SHA-256', textEncoder.encode(secret));
  return crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptSecret(plainText: string, secret: string): Promise<string> {
  const key = await importAesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    textEncoder.encode(plainText),
  );
  return `${toBase64Url(iv)}.${toBase64Url(new Uint8Array(cipher))}`;
}

export async function decryptSecret(payload: string, secret: string): Promise<string> {
  try {
    const [ivPart, cipherPart] = payload.split('.');
    if (!ivPart || !cipherPart) {
      throw new Error('Invalid encrypted payload');
    }

    const key = await importAesKey(secret);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64Url(ivPart) as unknown as BufferSource },
      key,
      fromBase64Url(cipherPart) as unknown as BufferSource,
    );

    return textDecoder.decode(plain);
  } catch {
    throw new Error('Failed to decrypt secret');
  }
}
