// Simulates an SMS gateway so the text route can be fully tested with no
// real provider. Each instance keeps its own outbox (not shared module
// state), so multiple servers/tests never see each other's messages.
export function createConsoleSmsAdapter() {
  const outbox = [];
  let nextId = 1;
  return {
    name: 'console',
    async send({ to, text }) {
      const entry = { id: nextId++, to, text, at: Date.now() };
      outbox.push(entry);
      if (outbox.length > 500) outbox.shift();
      console.log(`[SMS to ${to}] ${text}`);
    },
    list(after = 0) { return outbox.filter((m) => m.id > after); }
  };
}