import { timingSafeEqual } from 'node:crypto';

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

export function bearer(req) {
  const h = String(req.headers.authorization || '');
  return /^Bearer /i.test(h) ? h.slice(7).trim() : '';
}