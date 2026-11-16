import { detectLang } from './retrieval/tokenize.js';

const LANG_NAME = {
  en: 'English',
  am: 'Amharic (አማርኛ)',
  ti: 'Tigrinya (ትግርኛ)',
  om: 'Afaan Oromo',
  so: 'Somali (Soomaali)',
  ar: 'Arabic (العربية)'
};
const SUPPORTED_LANGUAGES = new Set(Object.keys(LANG_NAME));
const MAX_COURSE_CONTEXT_BYTES = 150000;

function contextError(message, status = 400, code = 'invalid_course_context') {
  return Object.assign(new Error(message), { status, code });
}

function normalizeCourseContext(context) {
  if (context === undefined || context === null) return null;
  if (typeof context !== 'object' || Array.isArray(context)) {
    throw contextError('Course context must be an object.');
  }
  if (typeof context.text !== 'string' || !context.text.trim()) {
    throw contextError('Course context text is required.');
  }

  const text = context.text.trim();
  if (Buffer.byteLength(text, 'utf8') > MAX_COURSE_CONTEXT_BYTES) {
    throw contextError('Course context is too large. Send a shorter lesson excerpt.', 413, 'course_context_too_large');
  }
  if (context.title !== undefined && typeof context.title !== 'string') {
    throw contextError('Course context title must be text.');
  }
  if (context.url !== undefined && typeof context.url !== 'string') {
    throw contextError('Course context URL must be text.');
  }
  if (context.url && Buffer.byteLength(context.url, 'utf8') > 1024) {
    throw contextError('Course context URL is too long.');
  }

  const lang = context.lang === undefined ? 'en' : String(context.lang).toLowerCase().slice(0, 2);
  if (!['en', 'am'].includes(lang)) {
    throw contextError('Course context language must be English or Amharic.', 422, 'unsupported_course_context_language');
  }

  let url = '';
  if (context.url) {
    let parsed;
    try { parsed = new URL(context.url); }
    catch { throw contextError('Course context URL must be an absolute HTTP or HTTPS URL.'); }
    const localHttp = parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    if ((!['https:', 'http:'].includes(parsed.protocol) || (parsed.protocol === 'http:' && !localHttp)) ||
      parsed.username || parsed.password) {
      throw contextError('Course context URL must use HTTPS and cannot include credentials.');
    }
    parsed.search = '';
    parsed.hash = '';
    url = parsed.toString();
  }

  const title = typeof context.title === 'string' ? context.title.trim().slice(0, 160) : '';
  return {
    id: 'host-course-context',
    lang,
    title: title || 'Current course page',
    text,
    url
  };
}

export const FALLBACK = {
  en: 'I can only answer from your course materials, and I could not find an answer to that. You can ask in different words, or ask a person for help.',
  am: 'መልስ የምሰጠው ከኮርሱ ቁሳቁስ ብቻ ነው፤ ለዚህ ጥያቄ መልስ አላገኘሁም። ጥያቄውን በሌላ መንገድ ይጠይቁ ወይም ሰው እንዲረዳዎት ይጠይቁ።',
  ti: 'ካብ ናይ ትምህርቲ ትሕዝቶ ጥራይ እየ መልሲ ዝህብ። ንዚ ሕቶ መልሲ ኣይረኸብኩን። ብኻልእ ኣገባብ ሕተት ወይ ካብ ሰብ ሓገዝ ሕተት።',
  om: 'Deebii kan kennu qabeenya koorsii irraa qofa. Gaaffii kanaaf deebii hin arganne. Gaaffii kee karaa biraatiin gaafadhu yookaan nama irraa gargaarsa gaafadhu.',
  so: 'Waxaan ka jawaabi karaa oo keliya agabka koorsada, mana helin jawaab su’aashan. Si kale u weydii ama qof caawimaad ka codso.',
  ar: 'أجيب اعتمادًا على مواد الدورة فقط، ولم أجد إجابة لهذا السؤال. يمكنك صياغة السؤال بطريقة أخرى أو طلب المساعدة من شخص.'
};

export function buildSystemPrompt(lang, passages) {
  const sources = passages.map((p, i) => `[${i + 1}] ${p.title}\n${p.text}`).join('\n\n');
  return [
    'You are a patient course tutor for learners who may be new to computers.',
    'Answer ONLY using the numbered course passages below. Never use outside knowledge.',
    `Reply only in ${LANG_NAME[lang] || 'English'} (language code: ${lang}). Use short sentences and simple words.`,
    'Extract ONLY the specific information needed to answer the question. Do not repeat the entire passage.',
    'Answer ONLY the learner\'s latest question. Do NOT reference any previous answers.',
    'After each fact, add the passage number in square brackets, like [1].',
    'If the passages do not answer the question, reply with exactly: NO_ANSWER',
    '',
    'PASSAGES:',
    sources
  ].join('\n');
}

export function createChat({ retriever, router, minCoverage = 0.3 }) {
  return async function chat({ message, lang, history = [], context }) {
    const asked = String(message || '').trim().slice(0, 1000);
    if (!asked) throw Object.assign(new Error('message is required'), { status: 400, code: 'message_required' });
    if (retrievalQuery !== undefined && (typeof retrievalQuery !== 'string' || !retrievalQuery.trim())) {
      throw Object.assign(new Error('retrievalQuery must be a non-empty string'), { status: 400, code: 'invalid_retrieval_query' });
    }
    const learnerLang = SUPPORTED_LANGUAGES.has(lang) ? lang : detectLang(asked);
    const courseContext = normalizeCourseContext(context);

    // --- CHUNKING LOGIC ---
    let extraPassages = [];
    if (courseContext) {
      const rawText = courseContext.text;
      const chunks = rawText.split(/\n\s*\n|\n/).map(c => c.trim()).filter(c => c.length > 30);

      extraPassages = chunks.map((chunk, index) => ({
        id: `host-chunk-${index}`,
        lang: courseContext.lang,
        title: courseContext.title,
        url: courseContext.url,
        text: chunk
      }));
    }

    const { hits, lang: contentLang } = retriever.search(asked, learnerLang, {
      limit: 3,
      minCoverage,
      extraPassages: extraPassages
    });

    if (!hits.length) {
      return { answer: FALLBACK[learnerLang], citations: [], grounded: false, escalate: true, provider: 'none', lang: learnerLang };
    }

    const passages = hits.map((h) => h.passage);
    const messages = [{ role: 'user', content: asked }];

    const out = await router.generate({ system: buildSystemPrompt(learnerLang, passages), messages, passages, lang: learnerLang });

    // --- CRITICAL SAFETY CHECK ---
    // If Gemini fails and returns nothing, this prevents a 500 crash!
    if (!out || typeof out.text !== 'string' || !out.text.trim()) {
      return { answer: FALLBACK[learnerLang], citations: [], grounded: false, escalate: true, provider: out.provider || 'none', lang: learnerLang };
    }

    if (/^\s*NO_ANSWER/.test(out.text)) {
      return { answer: FALLBACK[learnerLang], citations: [], grounded: false, escalate: true, provider: out.provider, lang: learnerLang };
    }

    const used = new Set([...out.text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]) - 1).filter((i) => i >= 0 && i < passages.length));
    if (!used.size) used.add(0);
    const citations = [...used].sort().map((i) => ({ id: passages[i].id, title: passages[i].title, url: passages[i].url, lang: passages[i].lang }));

    return {
      answer: out.text,
      citations,
      grounded: true,
      escalate: false,
      provider: out.provider,
      lang: learnerLang,
      contentLang,
      note: contentLang !== learnerLang ? 'answered-from-english-content' : undefined
    };
  };
}