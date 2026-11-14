import { smsEncoding } from './language.js';

// Simulates an SMS gateway so the text route can be fully tested with no
// real provider. Each instance keeps its own outbox (not shared module
// state), so multiple servers/tests never see each other's messages.
export function createConsoleSmsAdapter() {
  const outbox = [];
  let nextId = 1;
  return {
    name: 'console',
    async send({ to, text, encoding, segments, units }) {
      const estimate = smsEncoding(text);
      encoding = encoding || estimate.encoding;
      segments = segments || estimate.segments;
      units = units ?? estimate.units;
      const entry = { id: nextId++, to, text, encoding, segments, units, at: Date.now() };
      outbox.push(entry);
      if (outbox.length > 500) outbox.shift();
      console.log(`[SMS to ${to}] ${text}`);
      return true;
    },
    list(after = 0) { return outbox.filter((m) => m.id > after); }
  };
}