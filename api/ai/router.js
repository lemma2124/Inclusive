import { redactMessages } from '../lib/redact.js';

// Tries providers in order. A provider that fails (timeout, 429, 5xx, empty)
// is skipped for a cooldown so we stop burning time on a rate-limited key.
export function createRouter({ providers, timeoutMs = 8000, cooldownMs = 60000, maxFailures = 2, now = Date.now }) {
  const state = new Map();

  function open(name, ms) {
    state.set(name, { failures: 0, openUntil: now() + ms });
  }

  async function generate(req) {
    const attempts = [];
    for (const p of providers) {
      if (!p.available()) {
        attempts.push({ provider: p.name, skipped: 'unavailable' });
        continue;
      }
      const st = state.get(p.name);
      if (st && st.openUntil > now()) {
        attempts.push({ provider: p.name, skipped: 'cooling-down' });
        continue;
      }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const input = { ...req, messages: p.cloud ? redactMessages(req.messages) : req.messages, signal: ctrl.signal };
        const out = await p.generate(input);
        clearTimeout(timer);
        state.delete(p.name);
        return { text: out.text, provider: p.name, attempts };
      } catch (e) {
        clearTimeout(timer);
        const reason = ctrl.signal.aborted ? 'timeout' : e.message;
        attempts.push({ provider: p.name, error: reason });
        const prev = state.get(p.name) || { failures: 0, openUntil: 0 };
        const failures = prev.failures + 1;
        if (e.status === 429) open(p.name, e.retryAfterMs || cooldownMs);
        else if (failures >= maxFailures) open(p.name, cooldownMs);
        else state.set(p.name, { failures, openUntil: 0 });
      }
    }
    throw new Error(`No AI provider available: ${JSON.stringify(attempts)}`);
  }

  return { generate, _state: state };
}