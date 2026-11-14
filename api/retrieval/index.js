import { tokenize } from './tokenize.js';

// Small BM25 index. No vector database, no paid embeddings, runs anywhere.
export class Bm25Index {
  constructor(passages, { k1 = 1.4, b = 0.75 } = {}) {
    this.k1 = k1;
    this.b = b;
    this.docs = passages.map((p) => {
      const tokens = tokenize(`${p.title} ${p.title} ${p.text}`); // title counts double
      const tf = new Map();
      for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
      return { passage: p, tf, len: tokens.length };
    });
    this.avgLen = this.docs.reduce((s, d) => s + d.len, 0) / (this.docs.length || 1);
    this.df = new Map();
    for (const d of this.docs) for (const t of d.tf.keys()) this.df.set(t, (this.df.get(t) || 0) + 1);
  }

  idf(term) {
    const n = this.docs.length;
    const df = this.df.get(term) || 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  search(query, limit = 3) {
    const qTerms = [...new Set(tokenize(query))];
    if (!qTerms.length) return [];
    const results = [];
    for (const d of this.docs) {
      let score = 0;
      let matched = 0;
      for (const t of qTerms) {
        const f = d.tf.get(t);
        if (!f) continue;
        matched += 1;
        const norm = f * (this.k1 + 1) / (f + this.k1 * (1 - this.b + this.b * (d.len / this.avgLen)));
        score += this.idf(t) * norm;
      }
      if (score > 0) results.push({ passage: d.passage, score, coverage: matched / qTerms.length });
    }
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

// One index per language. If the learner's language has no good match,
// fall back to English content so they still get a cited answer.
export class Retriever {
  constructor(passages) {
    this.byLang = new Map();
    const groups = new Map();
    for (const p of passages) {
      if (!groups.has(p.lang)) groups.set(p.lang, []);
      groups.get(p.lang).push(p);
    }
    for (const [lang, list] of groups) this.byLang.set(lang, new Bm25Index(list));
    this.count = passages.length;
  }

  search(query, lang = 'en', { limit = 3, minCoverage = 0.3 } = {}) {
    const attempt = (l) => {
      const idx = this.byLang.get(l);
      if (!idx) return [];
      return idx.search(query, limit).filter((r) => r.coverage >= minCoverage);
    };
    let hits = attempt(lang);
    let usedLang = lang;
    if (!hits.length && lang !== 'en') {
      hits = attempt('en');
      usedLang = 'en';
    }
    return { hits, lang: usedLang };
  }
}