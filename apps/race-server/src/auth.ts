import { createHmac, timingSafeEqual } from 'node:crypto';

export interface Identity {
  userId: string;
}

const b64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/**
 * Проверка JWT HS256, выданного API (тот же секрет JWT_SECRET).
 * Без зависимостей: заголовок alg=HS256, подпись HMAC-SHA256, срок exp.
 */
export function verifyJwt(
  token: string,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
): Identity | null {
  if (!token || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts as [string, string, string];
  try {
    const header = JSON.parse(b64url(h).toString('utf8')) as { alg?: string };
    if (header.alg !== 'HS256') return null;
    const expected = createHmac('sha256', secret).update(`${h}.${p}`).digest();
    const got = b64url(sig);
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
    const payload = JSON.parse(b64url(p).toString('utf8')) as { sub?: string; exp?: number };
    if (!payload.sub || (payload.exp && payload.exp < nowSec)) return null;
    return { userId: payload.sub };
  } catch {
    return null;
  }
}

/** Выпуск токена — только для тестов. */
export function signJwt(payload: object, secret: string): string {
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const h = enc({ alg: 'HS256', typ: 'JWT' });
  const p = enc(payload);
  const s = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}
