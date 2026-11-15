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
      
      // Split by newlines, periods, question marks, or Ethiopic punctuation
      const sentences = rawText.split(/(?<=[.!?።፧\n])\s+/).map(s => s.trim()).filter(s => s.length > 5);
      
      if (!sentences.length) return { text: rawText.slice(0, 300) + '... [1]' };

      let bestSentence = sentences[0];
      let bestScore = -1;
      
      if (query) {
        const qWords = query.split(/\s+/).filter(w => w.length > 3);
        for (const s of sentences) {
          let score = 0;
          const lowerS = s.toLowerCase();
          for (const w of qWords) {
            if (lowerS.includes(w)) score++;
          }
          if (score > bestScore) {
            bestScore = score;
            bestSentence = s;
          }
        }
      }
      
      // If no good match was found, just return the first 2 sentences so it doesn't dump everything
      if (bestScore <= 0) {
         bestSentence = sentences.slice(0, 2).join(' ');
      }

      return { text: bestSentence + ' [1]' };
    }
  };
}