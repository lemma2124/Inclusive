import { smsEncoding } from './language.js';

// Generic outbound adapter for a real SMS gateway, once one is chosen at
// kick-off. Posts { to, text } as JSON. Most Ethiopian/African SMS gateways
// use a different request shape, so this will likely need a small edit to
// match the chosen provider's exact field names once that's known.
export function createWebhookSmsAdapter({ url, key, fetchImpl = fetch }) {
  return {
    name: 'webhook',
    async send({ to, text, encoding, segments, units }) {
      if (!url) throw new Error('SMS_WEBHOOK_URL is not set.');
      const estimate = smsEncoding(text);
      encoding = encoding || estimate.encoding;
      segments = segments || estimate.segments;
      units = units ?? estimate.units;
      try {
        const headers = { 'content-type': 'application/json' };
        if (key) headers.authorization = `Bearer ${key}`;
        const res = await fetchImpl(url, {
          method: 'POST', headers,
          body: JSON.stringify({ to, text, encoding, segments, units }),
          signal: AbortSignal.timeout(10000)
        });
        if (!res.ok) throw new Error(`SMS gateway returned HTTP ${res.status}.`);
        return true;
      } catch (e) {
        throw new Error(`SMS delivery failed: ${e.message}`);
      }
    }
  };
}