import { randomUUID } from 'node:crypto';

const API_BASE = 'https://api.addisassistant.com/api/v1';
const STT_LANGUAGES = new Set(['am', 'om', 'ti', 'en']);
const TTS_LANGUAGES = new Set(['am', 'om', 'ti']);
const AUDIO_EXTENSIONS = Object.freeze({
  'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav',
  'audio/x-wav': 'wav', 'audio/wave': 'wav'
});
const VOICE_CACHE_MS = 5 * 60 * 1000;

function providerError(res, operation) {
  if (res.status === 401 || res.status === 403) {
    return Object.assign(new Error('Speech service authentication failed. Check ADDIS_API_KEY.'), { status: 502, code: 'speech_auth_failed' });
  }
  if (res.status === 402) {
    return Object.assign(new Error('Speech service balance is insufficient.'), { status: 402, code: 'speech_payment_required' });
  }
  if (res.status === 429) {
    return Object.assign(new Error('Speech service is busy. Please try again later.'), { status: 503, code: 'speech_busy', retryAfter: res.headers.get('retry-after') || '' });
  }
  if (res.status === 422) {
    return Object.assign(new Error('The speech service cannot process this audio or language.'), { status: 422, code: 'speech_request_unsupported' });
  }
  return Object.assign(new Error(`Speech service ${operation} failed.`), { status: 502, code: 'speech_provider_error' });
}

async function jsonOrNull(res) {
  try { return await res.json(); } catch { return null; }
}

export function createAddisSpeech({ apiKey = '', fetchImpl = fetch, timeoutMs = 60000, now = Date.now } = {}) {
  let voiceCache = new Map();
  let voiceCacheUntil = 0;

  function requireKey() {
    if (!apiKey) throw Object.assign(new Error('Speech features are not configured.'), { status: 503, code: 'speech_disabled' });
  }

  async function transcribe({ audio, mimeType, language }) {
    requireKey();
    if (!STT_LANGUAGES.has(language)) {
      throw Object.assign(new Error('Choose Amharic, Afaan Oromo, Tigrinya, or English for speech transcription.'), { status: 422, code: 'unsupported_speech_language' });
    }
    if (!Buffer.isBuffer(audio) || audio.length === 0) {
      throw Object.assign(new Error('A non-empty audio recording is required.'), { status: 400, code: 'audio_required' });
    }

    const form = new FormData();
    form.append('audio', new Blob([audio], { type: mimeType }), `recording.${AUDIO_EXTENSIONS[mimeType] || 'wav'}`);
    const requestId = randomUUID();
    const query = new URLSearchParams({ language, backend: 'turbo', request_id: requestId });
    let res;
    try {
      res = await fetchImpl(`${API_BASE}/scribe/transcribe?${query}`, {
        method: 'POST',
        headers: { 'x-api-key': apiKey },
        body: form,
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (e) {
      if (e.name === 'TimeoutError' || e.name === 'AbortError') {
        throw Object.assign(new Error('Speech recognition timed out. Please try a shorter recording.'), { status: 504, code: 'speech_timeout' });
      }
      throw Object.assign(new Error('Could not reach the speech service.'), { status: 502, code: 'speech_network_error' });
    }

    const payload = await jsonOrNull(res);
    if (!res.ok) throw providerError(res, 'transcription');
    const text = payload && payload.data && payload.data.text;
    if (typeof text !== 'string' || !text.trim()) {
      throw Object.assign(new Error('The speech service returned no transcript.'), { status: 502, code: 'speech_empty_transcript' });
    }
    return { text: text.trim(), language, requestId };
  }

  async function voicesFor(language) {
    if (now() < voiceCacheUntil && voiceCache.has(language)) return voiceCache.get(language);
    const query = new URLSearchParams({ language });
    let res;
    try {
      res = await fetchImpl(`${API_BASE}/voice/voices?${query}`, {
        headers: { 'x-api-key': apiKey },
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch {
      throw Object.assign(new Error('Could not load available speech voices.'), { status: 502, code: 'speech_network_error' });
    }
    if (!res.ok) throw providerError(res, 'voice catalog lookup');
    const payload = await jsonOrNull(res);
    const entries = Array.isArray(payload && payload.data) ? payload.data :
      Array.isArray(payload && payload.data && payload.data.data) ? payload.data.data :
        Array.isArray(payload && payload.voices) ? payload.voices : [];
    const available = entries.filter((v) => v && (v.is_available === true || v.isAvailable === true) && typeof v.id === 'string');
    if (!available.length) {
      throw Object.assign(new Error('No speech voice is currently available for this language.'), { status: 422, code: 'speech_voice_unavailable' });
    }
    const chosen = available.find((v) => v.is_default === true || v.isDefault === true) || available[0];
    voiceCache.set(language, chosen.id);
    voiceCacheUntil = now() + VOICE_CACHE_MS;
    return chosen.id;
  }

  async function synthesize({ text, language }) {
    requireKey();
    if (!TTS_LANGUAGES.has(language)) {
      throw Object.assign(new Error('Addis voices are available here for Amharic, Afaan Oromo, and Tigrinya. Use device speech for other languages.'), { status: 422, code: 'unsupported_speech_language' });
    }
    const content = String(text || '').trim();
    if (!content) throw Object.assign(new Error('Text is required for speech generation.'), { status: 400, code: 'text_required' });
    if (content.length > 2000) throw Object.assign(new Error('Text is too long to read aloud in one request.'), { status: 413, code: 'speech_text_too_long' });
    const voiceId = await voicesFor(language);
    let res;
    try {
      res = await fetchImpl(`${API_BASE}/voice/generations`, {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          text: content,
          voice_id: voiceId,
          language,
          output_format: 'mp3_44100',
          client_request_id: randomUUID()
        }),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (e) {
      if (e.name === 'TimeoutError' || e.name === 'AbortError') {
        throw Object.assign(new Error('Speech generation timed out. Please try again.'), { status: 504, code: 'speech_timeout' });
      }
      throw Object.assign(new Error('Could not reach the speech service.'), { status: 502, code: 'speech_network_error' });
    }
    const payload = await jsonOrNull(res);
    if (!res.ok) throw providerError(res, 'generation');
    const data = payload && payload.data;
    const audioUrl = data && (data.audio_url || data.audioUrl);
    if (typeof audioUrl !== 'string' || !audioUrl.startsWith('https://')) {
      throw Object.assign(new Error('The speech service did not return a playable audio clip.'), { status: 502, code: 'speech_audio_missing' });
    }
    return { audioUrl, voiceId, language, clipId: typeof data.id === 'string' ? data.id : undefined };
  }

  return { transcribe, synthesize };
}

export const ADDIS_SPEECH_LANGUAGES = Object.freeze({ am: 'Amharic', om: 'Afaan Oromo', ti: 'Tigrinya' });
