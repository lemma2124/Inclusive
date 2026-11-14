export class ProviderError extends Error {
  constructor(message, { status = 0, retryAfterMs = 0 } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export function retryAfter(res) {
  const h = res.headers?.get?.('retry-after');
  const s = Number(h);
  return Number.isFinite(s) && s > 0 ? s * 1000 : 0;
}