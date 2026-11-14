// Final fallback. No network, no model, no cost. Returns the best-matching
// course passage as the answer, with a citation marker. This is also the
// low-bandwidth / no-AI path, so it must never throw.
export function createOffline() {
  return {
    name: 'offline',
    cloud: false,
    available: () => true,
    async generate({ passages = [] }) {
      const top = passages.slice(0, 2);
      if (!top.length) return { text: 'NO_ANSWER' };
      const text = top.map((p, i) => `${p.text} [${i + 1}]`).join('\n\n');
      return { text };
    }
  };
}