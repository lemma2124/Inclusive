export const CHANNEL_LANGUAGES = Object.freeze({
  en: 'English',
  am: 'Amharic',
  om: 'Afaan Oromo',
  ti: 'Tigrinya'
});

const ALIASES = new Map([
  ['en', 'en'], ['english', 'en'],
  ['am', 'am'], ['amharic', 'am'], ['አማርኛ', 'am'],
  ['om', 'om'], ['afaan oromoo', 'om'], ['oromo', 'om'],
  ['ti', 'ti'], ['tigrinya', 'ti'], ['ትግርኛ', 'ti']
]);

const WORDS = {
  en: new Set(['the', 'and', 'is', 'are', 'how', 'what', 'where', 'when', 'please', 'course', 'score', 'help', 'my', 'you', 'can', 'do', 'i', 'for', 'with']),
  om: new Set(['akkam', 'maal', 'maaloo', 'barnoota', 'hojii', 'akkamitti', 'nagaa', 'galatoomi', 'afaan', 'oromoo']),
  ti: new Set(['selam', 'kemey', 'abzi', 'dehan', 'tigrinya', 'beyti', 'nay', 'ከመይ', 'ደሓን', 'ትግርኛ', 'ኣብዚ', 'እዩ']),
  am: new Set(['እንዴት', 'ምን', 'እባክዎ', 'ኮርስ', 'ውጤት', 'እችላለሁ', 'አማርኛ', 'ነው', 'የት'])
};

export function parseChannelLanguage(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return ALIASES.get(normalized) || null;
}

// Conservative lightweight detection only. Generic Ethiopic text can be either
// Amharic or Tigrinya; when signals are ambiguous, callers should ask the user.
export function detectChannelLanguage(value) {
  const text = String(value || '').normalize('NFC').toLowerCase();
  const tokens = text.split(/[^\p{L}\p{M}]+/u).filter(Boolean);
  const scores = Object.fromEntries(Object.entries(WORDS).map(([lang, words]) => [
    lang,
    tokens.reduce((score, token) => score + (words.has(token) ? 1 : 0), 0)
  ]));
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (!ranked.length || ranked[0][1] < 2 || ranked[0][1] === ranked[1][1]) return null;
  return ranked[0][0];
}

export function smsEncoding(text) {
  const gsmBasic = new Set(Array.from('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'));
  const gsmExtension = new Set(Array.from('^{}\\[~]|€'));
  let septets = 0;
  let gsm = true;
  for (const char of String(text)) {
    if (gsmBasic.has(char)) septets += 1;
    else if (gsmExtension.has(char)) septets += 2;
    else { gsm = false; break; }
  }
  if (gsm) return { encoding: 'GSM-7', units: septets, segments: septets <= 160 ? 1 : Math.ceil(septets / 153) };
  const units = String(text).length; // UTF-16 code units, as used by UCS-2 SMS billing.
  return { encoding: 'UCS-2', units, segments: units <= 70 ? 1 : Math.ceil(units / 67) };
}
