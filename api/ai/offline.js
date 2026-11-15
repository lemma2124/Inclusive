export function createOffline() {
  return {
    name: 'offline',
    cloud: false,
    available: () => true,
    async generate({ passages = [] }) {
      // Only return the single most relevant passage to prevent dumping the whole lesson
      const top = passages.slice(0, 1); 
      if (!top.length) return { text: 'NO_ANSWER' };
      const text = top.map((p, i) => `${p.text} [${i + 1}]`).join('\n\n');
      return { text };
    }
  };
}