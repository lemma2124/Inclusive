// Tokenizer for English + Amharic (Ge'ez script).
// Amharic attaches prefixes/suffixes to words, so exact word match is weak.
// Each Ethiopic character is one syllable, so character bigrams give
// robust fuzzy matching without any stemmer or model.

const ETHIOPIC = /[\u1200-\u139F\u2D80-\u2DDF]/u;
// Ethiopic punctuation U+1361-U+1368 plus common Latin punctuation and whitespace
const SPLIT = /[\s\u1361-\u1368.,;:!?()"'\[\]{}<>\/\\|\u2013\u2014-]+/u;

const EN_STOP = new Set(['a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'to', 'of', 'in', 'on', 'at', 'for',
  'and', 'or', 'it', 'this', 'that', 'do', 'does', 'did', 'i', 'my', 'me', 'you', 'your', 'can', 'how', 'what',
  'where', 'when', 'which', 'who', 'with', 'from', 'by', 'as', 'if', 'am', 'will', 'would', 'should', 'could']);

export function isEthiopic(word) {
  return ETHIOPIC.test(word);
}

export function detectLang(text) {
  let eth = 0;
  let lat = 0;
  for (const ch of String(text)) {
    if (ETHIOPIC.test(ch)) eth += 1;
    else if (/[A-Za-z]/.test(ch)) lat += 1;
  }
  return eth > lat ? 'am' : 'en';
}

export function words(text) {
  return String(text).normalize('NFC').toLowerCase().split(SPLIT).filter(Boolean);
}

export function tokenize(text) {
  const out = [];
  for (const w of words(text)) {
    if (isEthiopic(w)) {
      out.push(w);
      if (w.length > 2) {
        for (let i = 0; i < w.length - 1; i += 1) out.push(`#${w.slice(i, i + 2)}`);
      }
    } else if (!EN_STOP.has(w) && w.length > 1) {
      out.push(w);
    }
  }
  return out;
}