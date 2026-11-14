// Generic outbound adapter for a real SMS gateway, once one is chosen at
// kick-off. Posts { to, text } as JSON. Most Ethiopian/African SMS gateways
// use a different request shape, so this will likely need a small edit to
// match the chosen provider's exact field names once that's known.
export function createWebhookSmsAdapter({ url, key, fetchImpl = fetch }) {
  return {
    name: 'webhook',
    async send({ to, text }) {
      if (!url) { console.error('SMS webhook adapter: SMS_WEBHOOK_URL is not set; message not sent.'); return; }
      try {
        const headers = { 'content-type': 'application/json' };
        if (key) headers.authorization = `Bearer ${key}`;
        const res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify({ to, text }) });
        if (!res.ok) console.error(`SMS webhook adapter: gateway returned HTTP ${res.status}`);
      } catch (e) {
        console.error('SMS webhook adapter: network error:', e.message);
      }
    }
  };
}