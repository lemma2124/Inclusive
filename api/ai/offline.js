export function createOffline() {
  return {
    name: 'offline',
    cloud: false,
    available: () => true,
    async generate({ passages = [], messages = [] }) {
      if (!passages.length) return { text: 'NO_ANSWER' };
      
      const lastMsg = messages[messages.length - 1];
      const query = lastMsg ? lastMsg.content.toLowerCase() : '';
      const rawText = passages[0].text;
      
      // 1. Split the text into paragraphs (blocks separated by newlines)
      const paragraphs = rawText.split(/\n+/).map(p => p.trim()).filter(p => p.length > 10);
      
      if (!paragraphs.length) return { text: rawText.slice(0, 300) + '... [1]' };

      let bestParagraph = paragraphs[0];
      let bestScore = -1;
      
      // 2. Score each paragraph based on keyword matches
      if (query) {
        const qWords = query.split(/\s+/).filter(w => w.length > 3);
        for (const p of paragraphs) {
          let score = 0;
          const lowerP = p.toLowerCase();
          for (const w of qWords) {
            if (lowerP.includes(w)) score++;
          }
          if (score > bestScore) {
            bestScore = score;
            bestParagraph = p;
          }
        }
      }
      
      // 3. If no good match was found, return the first two paragraphs so it doesn't dump everything
      if (bestScore <= 0) {
         bestParagraph = paragraphs.slice(0, 2).join('\n\n');
      }

      return { text: bestParagraph + ' [1]' };
    }
  };
}