import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { tokenize, detectLang } from '../api/retrieval/tokenize.js';
import { Retriever } from '../api/retrieval/index.js';
import { loadPassages } from '../api/retrieval/content.js';
import { redact } from '../api/lib/redact.js';
import { createRouter } from '../api/ai/router.js';
import { createOffline } from '../api/ai/offline.js';
import { createOllama } from '../api/ai/ollama.js';
import { createGemini } from '../api/ai/gemini.js';
import { createAddisSpeech } from '../api/ai/addis-speech.js';
import { createChat, FALLBACK } from '../api/chat.js';
import { buildProviders, createApp } from '../api/server.js';
import { loadConfig } from '../api/lib/config.js';
import { ProviderError } from '../api/ai/errors.js';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Readable } from 'node:stream';
import { createHandoffStore } from '../api/handoff/store.js';
import { createConsoleSmsAdapter } from '../api/sms/console-adapter.js';
import { createSmsRuntime } from '../api/sms/session.js';
import { createWebhookSmsAdapter } from '../api/sms/webhook-adapter.js';
import { createTelerivetSmsAdapter, TelerivetSmsError } from '../api/sms/telerivet-adapter.js';
import { createTelerivetSmsQueue } from '../api/sms/telerivet-queue.js';
import { detectChannelLanguage, parseChannelLanguage, smsEncoding } from '../api/sms/language.js';
import { parseTelegramInput } from '../telegram/commands.js';
import { applyTelegramLanguage } from '../telegram/commands.js';
import { createTelegramRuntime, registerWebhook, splitTelegramText } from '../telegram/bot.js';
import { createJobStore } from '../api/jobs/store.js';
import { MAX_SPEECH_BYTES, readSpeechUpload, validateSpeechAudio } from '../api/speech/upload.js';

const passages = loadPassages();
const retriever = new Retriever(passages);

test('detectLang recognizes supported chat languages and defaults to English', () => {
  assert.equal(detectLang('ኮርሶችን እንዴት አገኛለሁ?'), 'am');
  assert.equal(detectLang('ከመይ እየ ኮርስ ዝርከብ?'), 'ti');
  assert.equal(detectLang('Akkamitti koorsii argachuu danda’a?'), 'om');
  assert.equal(detectLang('Sidee baan koorso u heli karaa?'), 'so');
  assert.equal(detectLang('كيف أجد دوراتي؟'), 'ar');
  assert.equal(detectLang('How do I find my courses?'), 'en');
});

test('tokenizer splits on Ethiopic punctuation and adds bigrams', () => {
  const t = tokenize('ውጤትዎን ማየት።');
  assert.ok(t.includes('ውጤትዎን') && t.includes('ማየት'));
  assert.ok(t.some((x) => x.startsWith('#')));
  assert.ok(!t.some((x) => x.includes('።')));
});

test('English retrieval finds the right passage', () => {
  const { hits } = retriever.search('how do I check my score', 'en');
  assert.equal(hits[0].passage.id, 'en-score');
});

test('Amharic retrieval finds the right passage, including attached suffixes', () => {
  const { hits } = retriever.search('ውጤቴን እንዴት ማየት እችላለሁ', 'am', { minCoverage: 0.2 });
  assert.ok(hits.length > 0, 'expected a hit');
  assert.equal(hits[0].passage.id, 'am-score');
});

test('off-topic question returns no hits (no invention)', () => {
  const { hits } = retriever.search('what is the capital of France', 'en');
  assert.equal(hits.length, 0);
});

test('redact removes emails and phone numbers', () => {
  const r = redact('mail me at abebe@example.com or call +251 911 223344');
  assert.ok(!r.includes('abebe@') && !r.includes('911'));
});

function fakeProvider(name, behaviour, { cloud = true } = {}) {
  const calls = [];
  return {
    name, cloud, calls,
    available: () => true,
    async generate(req) { calls.push(req); return behaviour(req); }
  };
}

test('router falls through failing providers to offline', async () => {
  const bad = fakeProvider('gemini', () => { throw new ProviderError('boom', { status: 500 }); });
  const router = createRouter({ providers: [bad, createOffline()], timeoutMs: 500 });
  const out = await router.generate({ system: 's', messages: [{ role: 'user', content: 'q' }], passages: [{ text: 'hello' }] });
  assert.equal(out.provider, 'offline');
  assert.match(out.text, /hello/);
});

test('router cools down a rate-limited provider', async () => {
  let t = 1000;
  const limited = fakeProvider('groq', () => { throw new ProviderError('429', { status: 429, retryAfterMs: 5000 }); });
  const router = createRouter({ providers: [limited, createOffline()], now: () => t });
  const req = { system: 's', messages: [{ role: 'user', content: 'q' }], passages: [{ text: 'x' }] };
  await router.generate(req);
  await router.generate(req);
  assert.equal(limited.calls.length, 1, 'second request must skip the cooling provider');
  t += 6000;
  await router.generate(req);
  assert.equal(limited.calls.length, 2, 'provider is retried after cooldown');
});

test('router times out a hanging provider', async () => {
  const hang = fakeProvider('gemini', ({ signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted')))));
  const router = createRouter({ providers: [hang, createOffline()], timeoutMs: 50 });
  const out = await router.generate({ system: 's', messages: [{ role: 'user', content: 'q' }], passages: [{ text: 'fallback' }] });
  assert.equal(out.provider, 'offline');
  assert.equal(out.attempts[0].error, 'timeout');
});

test('router redacts personal data before cloud providers only', async () => {
  const cloud = fakeProvider('gemini', () => ({ text: 'ok [1]' }), { cloud: true });
  const router = createRouter({ providers: [cloud] });
  await router.generate({ system: 's', messages: [{ role: 'user', content: 'my email is a@b.com' }], passages: [] });
  assert.ok(!cloud.calls[0].messages[0].content.includes('a@b.com'));
});

test('Gemini sends the system prompt and chat to the configured model without exposing API keys in errors', async () => {
  let request;
  const gemini = createGemini({
    apiKey: 'test-gemini-secret',
    model: 'gemini-test',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return Response.json({ candidates: [{ content: { parts: [{ text: 'Grounded answer [1]' }] } }] });
    }
  });
  const out = await gemini.generate({
    system: 'Reply in Arabic and cite passages.',
    messages: [{ role: 'user', content: 'How do I find courses?' }]
  });
  assert.equal(out.text, 'Grounded answer [1]');
  assert.equal(request.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent');
  assert.equal(request.options.headers['x-goog-api-key'], 'test-gemini-secret');
  const body = JSON.parse(request.options.body);
  assert.equal(body.systemInstruction.parts[0].text, 'Reply in Arabic and cite passages.');
  assert.deepEqual(body.contents[0], { role: 'user', parts: [{ text: 'How do I find courses?' }] });

  const failing = createGemini({
    apiKey: 'test-gemini-secret',
    model: 'gemini-test',
    fetchImpl: async () => new Response('unauthorized', { status: 401 })
  });
  await assert.rejects(failing.generate({ system: 's', messages: [] }), (error) =>
    error.status === 401 && !error.message.includes('test-gemini-secret'));
});

test('Ollama uses its local OpenAI-compatible endpoint without cloud redaction', async () => {
  let request;
  const ollama = createOllama({
    baseUrl: 'http://127.0.0.1:11434/v1/',
    model: 'aya-expanse:8b',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Grounded reply [1]' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });
  const router = createRouter({ providers: [ollama] });
  const out = await router.generate({
    system: 'Use only course passages.',
    messages: [{ role: 'user', content: 'my email is learner@example.com' }],
    passages: [{ text: 'Course material' }]
  });

  assert.equal(out.provider, 'ollama');
  assert.equal(out.text, 'Grounded reply [1]');
  assert.equal(request.url, 'http://127.0.0.1:11434/v1/chat/completions');
  assert.equal(JSON.parse(request.options.body).model, 'aya-expanse:8b');
  assert.match(request.options.body, /learner@example\.com/);
  assert.equal(ollama.cloud, false);
});

test('provider factory registers Ollama and always keeps offline fallback', () => {
  const providers = buildProviders({
    providers: ['ollama'],
    ollamaBaseUrl: 'http://127.0.0.1:11434/v1',
    ollamaModel: 'test-model'
  });
  assert.deepEqual(providers.map((provider) => provider.name), ['ollama', 'offline']);
  assert.equal(providers[0].available(), true);
});

test('provider factory enables Gemini from server configuration', () => {
  const providers = buildProviders({
    providers: ['gemini'],
    geminiKey: 'configured-gemini-key',
    geminiModel: 'gemini-test'
  });
  assert.deepEqual(providers.map((provider) => provider.name), ['gemini', 'offline']);
  assert.equal(providers[0].available(), true);
});

test('production provider factory skips missing cloud keys and loopback Ollama but retains offline', () => {
  const providers = buildProviders({
    nodeEnv: 'production',
    providers: ['gemini', 'groq', 'ollama', 'offline'],
    geminiKey: '', groqKey: '',
    ollamaBaseUrl: 'http://127.0.0.1:11434/v1', ollamaModel: 'test-model'
  });
  assert.deepEqual(providers.map((provider) => provider.name), ['offline']);
  assert.equal(providers[0].available(), true);
});

test('configured Groq remains active and a cloud failure falls back to offline', async () => {
  const providers = buildProviders({
    providers: ['groq'], groqKey: 'configured-groq-key', groqModel: 'test-model'
  });
  assert.deepEqual(providers.map((provider) => provider.name), ['groq', 'offline']);
  const failing = fakeProvider('groq', () => { throw new ProviderError('temporary provider failure', { status: 503 }); });
  const router = createRouter({ providers: [failing, createOffline()] });
  const result = await router.generate({ system: 's', messages: [{ role: 'user', content: 'q' }], passages: [{ text: 'Course text' }] });
  assert.equal(result.provider, 'offline');
  assert.match(result.text, /Course text/);
});

test('default configuration tries Gemini before local and offline fallbacks', () => {
  const cfg = loadConfig({});
  assert.deepEqual(cfg.providers, ['gemini', 'ollama', 'offline']);
  assert.equal(cfg.ollamaBaseUrl, 'http://127.0.0.1:11434/v1');
  assert.equal(cfg.ollamaModel, 'aya-expanse:8b');
});

test('non-loopback Ollama endpoints are treated as external for redaction', async () => {
  let requestBody = '';
  const ollama = createOllama({
    baseUrl: 'https://ollama.example/v1',
    model: 'test-model',
    fetchImpl: async (_url, options) => {
      requestBody = options.body;
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok [1]' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });
  const router = createRouter({ providers: [ollama] });
  await router.generate({
    system: 's',
    messages: [{ role: 'user', content: 'my email is learner@example.com' }],
    passages: []
  });

  assert.equal(ollama.cloud, true);
  assert.ok(!requestBody.includes('learner@example.com'));
});

test('Addis STT sends language, a unique request ID, and audio without exposing key in errors', async () => {
  let request;
  const speech = createAddisSpeech({
    apiKey: 'test-addis-secret',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return Response.json({ data: { request_id: 'mock-request', text: 'transcribed words' } });
    }
  });
  const result = await speech.transcribe({ audio: Buffer.from('mock'), mimeType: 'audio/webm', language: 'om' });
  assert.equal(new URL(request.url).pathname, '/api/v1/scribe/transcribe');
  assert.equal(new URL(request.url).searchParams.get('language'), 'om');
  assert.equal(new URL(request.url).searchParams.get('backend'), 'turbo');
  assert.ok(new URL(request.url).searchParams.get('request_id'));
  assert.equal(request.options.headers['x-api-key'], 'test-addis-secret');
  assert.equal(request.options.body.get('audio').name, 'recording.webm');
  assert.equal(result.text, 'transcribed words');
  assert.equal(result.language, 'om');
});

test('Addis STT keeps Telegram OGG voice notes labeled as OGG', async () => {
  let request;
  const speech = createAddisSpeech({
    apiKey: 'test-addis-secret',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return Response.json({ data: { text: 'transcribed voice' } });
    }
  });
  await speech.transcribe({ audio: Buffer.from('mock ogg'), mimeType: 'audio/ogg', language: 'am' });
  assert.equal(request.options.body.get('audio').name, 'recording.ogg');
  assert.equal(request.options.body.get('audio').type, 'audio/ogg');
});

test('Addis speech handles missing key, unsupported languages, and invalid credentials safely', async () => {
  let calls = 0;
  const missing = createAddisSpeech({ apiKey: '', fetchImpl: async () => { calls += 1; } });
  await assert.rejects(missing.transcribe({ audio: Buffer.from('x'), mimeType: 'audio/webm', language: 'am' }), (e) => e.code === 'speech_disabled');
  const configured = createAddisSpeech({ apiKey: 'do-not-leak-this', fetchImpl: async () => { calls += 1; return Response.json({ status: 'error' }, { status: 401 }); } });
  await assert.rejects(configured.transcribe({ audio: Buffer.from('x'), mimeType: 'audio/webm', language: 'so' }), (e) => e.code === 'unsupported_speech_language');
  await assert.rejects(configured.transcribe({ audio: Buffer.from('x'), mimeType: 'audio/webm', language: 'am' }), (e) => e.code === 'speech_auth_failed' && !e.message.includes('do-not-leak-this'));
  assert.equal(calls, 1, 'unsupported language is rejected before network access');
});

test('Addis STT maps provider failures and TTS selects a currently available catalog voice', async () => {
  let call = 0;
  const speech = createAddisSpeech({
    apiKey: 'test-key',
    fetchImpl: async (url, options) => {
      call += 1;
      if (url.includes('/scribe/transcribe')) return Response.json({}, { status: 503 });
      if (url.includes('/voice/voices')) return Response.json({ data: [{ id: 'am-hamen', is_available: true, is_default: true }] });
      assert.equal(url, 'https://api.addisassistant.com/api/v1/voice/generations');
      const body = JSON.parse(options.body);
      assert.equal(body.voice_id, 'am-hamen');
      assert.equal(body.language, 'am');
      assert.equal(body.output_format, 'mp3_44100');
      assert.ok(body.client_request_id);
      return Response.json({ data: { id: 'clip-1', audio_url: 'https://audio.example/signed.mp3' } });
    }
  });
  await assert.rejects(speech.transcribe({ audio: Buffer.from('x'), mimeType: 'audio/webm', language: 'ti' }), (e) => e.code === 'speech_provider_error');
  const audio = await speech.synthesize({ text: 'hello', language: 'am' });
  assert.deepEqual(audio, { audioUrl: 'https://audio.example/signed.mp3', voiceId: 'am-hamen', language: 'am', clipId: 'clip-1' });
  await assert.rejects(speech.synthesize({ text: 'hello', language: 'en' }), (e) => e.code === 'unsupported_speech_language');
  assert.equal(call, 3, 'voice catalog is queried once then reused for this language');
});

function makeWav(seconds = 1) {
  const sampleRate = 8000;
  const samples = sampleRate * seconds;
  const wav = Buffer.alloc(44 + samples);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + samples, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples, 40);
  return wav;
}

test('speech upload parser accepts allowed media and enforces duration, size, and language', async () => {
  const toNodeRequest = async (form) => {
    const request = new Request('http://local/speech', { method: 'POST', body: form });
    const nodeRequest = Readable.from([Buffer.from(await request.arrayBuffer())]);
    nodeRequest.headers = Object.fromEntries(request.headers.entries());
    return nodeRequest;
  };
  const form = new FormData();
  form.append('language', 'am');
  form.append('audio', new Blob([makeWav()], { type: 'audio/wav' }), 'voice.wav');
  const upload = await readSpeechUpload(await toNodeRequest(form));
  assert.equal(upload.language, 'am');
  assert.equal(upload.mimeType, 'audio/wav');
  assert.ok(upload.audio.length > 44);

  const longForm = new FormData();
  longForm.append('language', 'ti');
  longForm.append('audio', new Blob([makeWav(31)], { type: 'audio/wav' }), 'long.wav');
  await assert.rejects(readSpeechUpload(await toNodeRequest(longForm)), (e) => e.code === 'audio_too_long');

  const oversized = Readable.from([]);
  oversized.headers = { 'content-type': 'multipart/form-data; boundary=x', 'content-length': String(MAX_SPEECH_BYTES + 200000) };
  await assert.rejects(readSpeechUpload(oversized), (e) => e.code === 'audio_too_large');
});

test('speech buffer validator applies the shared upload limits to Telegram audio', async () => {
  const audio = makeWav();
  const parseMetadata = async () => ({ format: { duration: 1 } });
  assert.deepEqual(await validateSpeechAudio({ audio, mimeType: 'audio/wav', language: 'om', parseMetadata }), {
    audio, mimeType: 'audio/wav', language: 'om'
  });
  await assert.rejects(validateSpeechAudio({ audio, mimeType: 'application/octet-stream', language: 'en', parseMetadata }), (e) => e.code === 'unsupported_audio_format');
  await assert.rejects(validateSpeechAudio({ audio: Buffer.alloc(MAX_SPEECH_BYTES + 1), mimeType: 'audio/wav', language: 'en', parseMetadata }), (e) => e.code === 'audio_too_large');
  await assert.rejects(validateSpeechAudio({ audio, mimeType: 'audio/wav', language: 'so', parseMetadata }), (e) => e.code === 'unsupported_speech_language');
  await assert.rejects(validateSpeechAudio({ audio, mimeType: 'audio/wav', language: 'en', parseMetadata: async () => ({ format: { duration: 31 } }) }), (e) => e.code === 'audio_too_long');
});

test('Telegram remembers language and response mode and routes text and voice through existing services', async () => {
  const sent = [];
  const apiRequests = [];
  const transcripts = [];
  const spoken = [];
  const runtime = createTelegramRuntime({
    telegramCall: async (method, params) => { sent.push({ method, params }); return true; },
    apiCall: async (method, path, body) => {
      apiRequests.push({ method, path, body });
      return { answer: `${body.lang}: beginner answer [1]`, citations: [{ title: 'Course guide' }], escalate: false };
    },
    downloadFile: async (fileId) => ({ audio: makeWav(), mimeType: 'audio/wav', fileId }),
    speech: {
      async transcribe(input) { transcripts.push(input); return { text: 'Akkamitti hojii barnoota?', language: input.language }; },
      async synthesize(input) { spoken.push(input); return { audioUrl: 'https://speech.example/answer.mp3' }; }
    }
  });
  let nextUpdateId = 90010;
  const update = (chatId, text) => runtime.processUpdate({ update_id: nextUpdateId++, message: { chat: { id: chatId }, from: { language_code: 'en' }, text } });

  await update(9001, '/language Afaan Oromoo');
  await update(9001, '/voice');
  await update(9001, '/learn How do I find my courses?');
  await runtime.processUpdate({ update_id: 9002, message: { chat: { id: 9001 }, voice: { file_id: 'voice-id', file_size: 100, duration: 2, mime_type: 'audio/wav' } } });
  assert.equal(runtime.getSession(9001).lang, 'om');
  assert.equal(runtime.getSession(9001).languageExplicit, true);
  assert.equal(runtime.getSession(9001).responseMode, 'voice');
  assert.equal(apiRequests[0].body.lang, 'om');
  assert.equal(transcripts[0].language, 'om');
  assert.equal(transcripts[0].mimeType, 'audio/wav');
  assert.equal(apiRequests.length, 1, 'voice text waits for learner confirmation');
  assert.ok(sent.some((item) => item.params.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data === 'transcript_submit'));
  await runtime.processUpdate({ update_id: 9003, callback_query: { id: 'transcript-submit', data: 'transcript_submit', message: { chat: { id: 9001 } } } });
  assert.equal(apiRequests[1].body.lang, 'om');
  assert.equal(apiRequests[1].body.message, 'Akkamitti hojii barnoota?');
  assert.equal(apiRequests[1].body.history.length, 2);
  assert.equal(spoken.length, 2);
  assert.equal(sent.filter((item) => item.method === 'sendAudio').length, 2);

  await update(9001, '/text');
  await update(9001, 'How do I find my courses?');
  assert.equal(runtime.getSession(9001).responseMode, 'text');
  assert.equal(spoken.length, 2);

  const languageCommands = [['English', 'en'], ['Amharic', 'am'], ['Afaan Oromoo', 'om'], ['Tigrinya', 'ti']];
  for (const [label, expected] of languageCommands) {
    await update(9100 + languageCommands.findIndex(([name]) => name === label), `/language ${label}`);
    assert.equal(runtime.getSession(9100 + languageCommands.findIndex(([name]) => name === label)).lang, expected);
  }
});

test('Telegram downloads only Telegram-returned safe paths and reports unavailable speech', async () => {
  const urls = [];
  const sent = [];
  const runtime = createTelegramRuntime({
    token: 'test-telegram-token',
    fetchImpl: async (url) => {
      urls.push(url);
      if (url.endsWith('/getFile')) return Response.json({ ok: true, result: { file_path: 'voice/file.wav' } });
      if (url.includes('/file/bot')) return new Response(makeWav(), { headers: { 'content-type': 'audio/wav' } });
      return Response.json({ ok: true, result: true });
    },
    apiCall: async () => ({ answer: 'Typed answer', citations: [], escalate: false }),
    speech: { async transcribe() { return { text: 'How do I find my courses?', language: 'en' }; } }
  });
  await runtime.processUpdate({ update_id: 9201, message: { chat: { id: 9201 }, voice: { file_id: 'file-id', file_size: 100, duration: 1, mime_type: 'audio/wav' } } });
  assert.ok(urls.some((url) => url.endsWith('/getFile')));
  assert.ok(urls.some((url) => url.endsWith('/file/bottest-telegram-token/voice/file.wav')));

  const noSpeech = createTelegramRuntime({ telegramCall: async (method, params) => { sent.push({ method, params }); return true; } });
  await noSpeech.processUpdate({ update_id: 9202, message: { chat: { id: 9202 }, voice: { file_id: 'file-id', duration: 1 } } });
  assert.match(sent.at(-1).params.text, /Speech recognition|Speech service/);
});

test('Telegram reports speech authentication failures without logging provider details', async () => {
  const sent = [];
  const warnings = [];
  const previousWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    const runtime = createTelegramRuntime({
      telegramCall: async (_method, params) => { sent.push(params); return true; },
      downloadFile: async () => ({ audio: makeWav(), mimeType: 'audio/wav' }),
      speech: { async transcribe() { throw Object.assign(new Error('private provider response'), { code: 'speech_auth_failed' }); } }
    });
    await runtime.processUpdate({ update_id: 9250, message: { chat: { id: 9250 }, voice: { file_id: 'private-file-id', file_size: 100, duration: 1, mime_type: 'audio/wav' } } });
    assert.match(sent.at(-1).text, /could not authenticate/i);
    assert.deepEqual(warnings, [['Telegram speech processing failed: speech_auth_failed']]);
    assert.ok(!JSON.stringify(warnings).includes('private'));
  } finally {
    console.warn = previousWarn;
  }
});

test('Telegram language buttons acknowledge callbacks and transcript can be corrected, canceled, or expire', async () => {
  const sent = [];
  const chatRequests = [];
  let now = 1000;
  const runtime = createTelegramRuntime({
    now: () => now,
    telegramCall: async (method, params) => { sent.push({ method, params }); return true; },
    apiCall: async (_method, path, body) => {
      if (path === '/v1/chat') chatRequests.push(body);
      return { answer: 'Course answer', citations: [], escalate: false };
    },
    downloadFile: async () => ({ audio: makeWav(), mimeType: 'audio/wav' }),
    speech: { async transcribe() { return { text: 'unclear transcript', language: 'en' }; } }
  });
  await runtime.processUpdate({ update_id: 9401, message: { chat: { id: 9401 }, text: '/language' } });
  const menu = sent.at(-1).params.reply_markup.inline_keyboard.flat();
  assert.deepEqual(menu.map((button) => button.callback_data), ['language_en', 'language_am', 'language_om', 'language_ti']);
  await runtime.processUpdate({ update_id: 9402, callback_query: { id: 'lang-choice', data: 'language_am', message: { chat: { id: 9401 } } } });
  assert.ok(sent.some((item) => item.method === 'answerCallbackQuery' && item.params.callback_query_id === 'lang-choice'));
  assert.equal(runtime.getSession(9401).lang, 'am');
  assert.ok(sent.at(-1).params.reply_markup.inline_keyboard.flat().some((button) => button.text === '✓ አማርኛ'));
  runtime.getSession(9401).history.push({ role: 'user', content: 'old language question' });
  await runtime.processUpdate({ update_id: 9411, callback_query: { id: 'bad-language', data: 'language_invalid', message: { chat: { id: 9401 } } } });
  assert.equal(runtime.getSession(9401).lang, 'am');
  await runtime.processUpdate({ update_id: 9412, message: { chat: { id: 9401 }, text: '/language Afaan Oromoo' } });
  assert.equal(runtime.getSession(9401).history.length, 0);

  const voice = (update_id) => runtime.processUpdate({ update_id, message: { chat: { id: 9401 }, voice: { file_id: 'file', file_size: 100, duration: 1, mime_type: 'audio/wav' } } });
  const callback = (update_id, id, data) => runtime.processUpdate({ update_id, callback_query: { id, data, message: { chat: { id: 9401 } } } });
  await voice(9403);
  await callback(9404, 'edit-transcript', 'transcript_edit');
  await runtime.processUpdate({ update_id: 9405, message: { chat: { id: 9401 }, text: 'How do I find my courses?' } });
  assert.equal(chatRequests.length, 0, 'corrected transcript still waits for confirmation');
  await callback(9406, 'submit-transcript', 'transcript_submit');
  assert.equal(chatRequests[0].message, 'How do I find my courses?');
  assert.equal(chatRequests[0].lang, 'om');

  await voice(9407);
  await callback(9408, 'cancel-transcript', 'transcript_cancel');
  assert.equal(runtime.getSession(9401).pendingTranscript, null);
  assert.equal(chatRequests.length, 1);

  await voice(9409);
  now += 5 * 60 * 1000 + 1;
  await callback(9410, 'expired-transcript', 'transcript_submit');
  assert.equal(chatRequests.length, 1);
  assert.match(sent.at(-1).params.text, /expired|ጊዜው/i);
});

test('Telegram chunks long messages safely and suppresses duplicate concurrent updates per process', async () => {
  const longAnswer = 'beginner answer '.repeat(700);
  const sent = [];
  let apiCalls = 0;
  const runtime = createTelegramRuntime({
    telegramCall: async (method, params) => { sent.push({ method, params }); return true; },
    apiCall: async () => { apiCalls += 1; return { answer: longAnswer, citations: [{ title: 'Guide' }], escalate: false }; }
  });
  const update = { update_id: 9501, message: { chat: { id: 9501 }, text: 'How do I find my courses?' } };
  await Promise.all([runtime.processUpdate(update), runtime.processUpdate(update)]);
  await runtime.processUpdate(update);
  const chunks = sent.filter((item) => item.method === 'sendMessage').map((item) => item.params.text);
  assert.equal(apiCalls, 1);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 3900));
  assert.equal(chunks.join(''), `${longAnswer}\n\nSources: Guide`);
  assert.deepEqual(splitTelegramText('  \n'), []);
  assert.throws(() => splitTelegramText('x', 0), RangeError);

  const failing = createTelegramRuntime({ telegramCall: async () => false });
  await assert.rejects(failing.processUpdate({ update_id: 9502, message: { chat: { id: 9502 }, text: '/start' } }), (error) => error.code === 'telegram_delivery_failed');
});

test('Telegram jobs and accommodation flows disclose local listings and human follow-up', async () => {
  const sent = [];
  const requests = [];
  const runtime = createTelegramRuntime({
    telegramCall: async (_method, params) => { sent.push(params); return true; },
    apiCall: async (method, path, body) => {
      requests.push({ path, body });
      if (path === '/v1/accommodations') return { id: 'accommodation-1', token: 'learner-token' };
      if (method === 'GET') return { status: 'closed', messages: [] };
      return { answer: 'Career guidance from course material.', citations: [{ title: 'Local guide' }], escalate: false };
    }
  });
  await runtime.processUpdate({ update_id: 9600, message: { chat: { id: 9601 }, text: '/language Afaan Oromoo' } });
  await runtime.processUpdate({ update_id: 9601, message: { chat: { id: 9601 }, text: '/jobs' } });
  assert.match(sent.at(-1).text, /not verified live vacancies/i);
  assert.ok(requests.some((request) => request.path === '/v1/jobs/subscribe'));
  assert.ok(requests.some((request) => request.path === '/v1/chat'));
  const jobsRequest = requests.find((request) => request.path === '/v1/chat');
  assert.equal(jobsRequest.body.lang, 'om');
  assert.equal(jobsRequest.body.message, 'Odeeffannoo hojii argamu fi gorsa deeggarsa afeerraa hojii naaf agarsiisi.');
  assert.equal(jobsRequest.body.retrievalQuery, 'Show available job information and interview accommodation guidance.');

  await runtime.processUpdate({ update_id: 9602, message: { chat: { id: 9601 }, text: '/language English' } });
  await runtime.processUpdate({ update_id: 9603, message: { chat: { id: 9601 }, text: '/accommodation' } });
  assert.match(sent.at(-1).text, /cannot guarantee or arrange/i);
  await runtime.processUpdate({ update_id: 9604, message: { chat: { id: 9601 }, text: 'I need an interpreter for an interview.' } });
  assert.ok(requests.some((request) => request.path === '/v1/accommodations' && /interpreter/.test(request.body.request)));
  assert.match(sent.at(-1).text, /sent to a person/i);
});

test('Telegram voice transcript detection does not override an explicit language choice', async () => {
  const chatRequests = [];
  const runtime = createTelegramRuntime({
    telegramCall: async () => true,
    apiCall: async (_method, path, body) => {
      if (path === '/v1/chat') chatRequests.push(body);
      return { answer: 'Amharic course answer', citations: [], escalate: false };
    },
    downloadFile: async () => ({ audio: makeWav(), mimeType: 'audio/wav' }),
    speech: { async transcribe() { return { text: 'How do I find my courses?', language: 'en' }; } }
  });
  await runtime.processUpdate({ update_id: 9260, message: { chat: { id: 9260 }, text: '/language Amharic' } });
  await runtime.processUpdate({ update_id: 9261, message: { chat: { id: 9260 }, voice: { file_id: 'audio', file_size: 100, duration: 1, mime_type: 'audio/wav' } } });
  await runtime.processUpdate({ update_id: 9262, callback_query: { id: 'submit-amharic', data: 'transcript_submit', message: { chat: { id: 9260 } } } });
  assert.equal(runtime.getSession(9260).lang, 'am');
  assert.equal(chatRequests[0].lang, 'am');
  assert.equal(chatRequests[0].message, 'How do I find my courses?');
});

test('Telegram human support obtains consent, relays both ways, and ends cleanly', async () => {
  const sent = [];
  const calls = [];
  let releasePoll;
  let pollCount = 0;
  const runtime = createTelegramRuntime({
    telegramCall: async (method, params) => { sent.push({ method, params }); return true; },
    apiCall: async (method, path, body, token) => {
      calls.push({ method, path, body, token });
      if (path === '/v1/chat') return { answer: 'Learning response', citations: [], escalate: true };
      if (path === '/v1/handoff') return { id: 'handoff-1', token: 'learner-token' };
      if (path.endsWith('/messages')) return { id: 3 };
      if (path.endsWith('/close')) return { status: 'closed' };
      if (method === 'GET') {
        pollCount += 1;
        if (pollCount === 1) return { status: 'active', messages: [{ id: 1, from: 'agent', text: 'An agent joined.' }, { id: 2, from: 'agent', text: 'How can I help?' }] };
        return new Promise((resolve) => { releasePoll = resolve; });
      }
      throw new Error('unexpected API request');
    }
  });
  await runtime.processUpdate({ update_id: 9301, message: { chat: { id: 9301 }, text: '/start' } });
  await runtime.processUpdate({ update_id: 9302, message: { chat: { id: 9301 }, text: 'How do I find my courses?' } });
  await runtime.processUpdate({ update_id: 9303, message: { chat: { id: 9301 }, text: '/support' } });
  assert.ok(sent.some((item) => item.params.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data === 'escalate_yes'));
  await runtime.processUpdate({ update_id: 9307, message: { chat: { id: 9301 }, text: '/cancel' } });
  assert.equal(runtime.getSession(9301).pendingConsent, false);
  assert.equal(calls.some((call) => call.path === '/v1/handoff'), false);
  await runtime.processUpdate({ update_id: 9308, message: { chat: { id: 9301 }, text: '/support' } });
  await runtime.processUpdate({ update_id: 9304, callback_query: { id: 'callback-1', data: 'escalate_yes', message: { chat: { id: 9301 } } } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(sent.some((item) => item.params.text === 'How can I help?'));
  await runtime.processUpdate({ update_id: 9305, message: { chat: { id: 9301 }, text: 'I need more help.' } });
  assert.ok(calls.some((call) => call.path.endsWith('/messages') && call.body.text === 'I need more help.'));
  await runtime.processUpdate({ update_id: 9306, message: { chat: { id: 9301 }, text: '/end' } });
  assert.ok(calls.some((call) => call.path.endsWith('/close')));
  releasePoll?.({ status: 'closed', messages: [] });
  assert.equal(runtime.getSession(9301).handoff, null);
});

test('chat answers with citations when the course covers the question', async () => {
  const chat = createChat({ retriever, router: createRouter({ providers: [createOffline()] }) });
  const r = await chat({ message: 'How do I mark a lesson as complete?' });
  assert.equal(r.grounded, true);
  assert.equal(r.citations[0].id, 'en-complete');
  assert.equal(r.escalate, false);
});

test('chat retrieves host-provided course context and cites its page before calling the provider', async () => {
  const provider = fakeProvider('gemini', (request) => {
    assert.equal(request.passages[0].id, 'host-course-context');
    assert.match(request.system, /select Submit project/);
    return { text: 'Open the project assessment page and select Submit project. [1]' };
  });
  const chat = createChat({ retriever, router: createRouter({ providers: [provider] }) });
  const result = await chat({
    message: 'How do I submit my final project?',
    lang: 'en',
    context: {
      title: 'Submitting a project',
      text: 'To submit your final project in ALX, open the project assessment page, attach the completed repository link, and select Submit project.',
      url: 'https://alx.example/course/lesson-1?session=private',
      lang: 'en'
    }
  });
  assert.equal(result.grounded, true);
  assert.equal(result.citations[0].id, 'host-course-context');
  assert.equal(result.citations[0].url, 'https://alx.example/course/lesson-1');
  assert.equal(provider.calls.length, 1);
});

test('chat validates current-page context and still refuses unrelated questions', async () => {
  const provider = fakeProvider('gemini', () => ({ text: 'must not run' }));
  const chat = createChat({ retriever, router: createRouter({ providers: [provider] }) });
  const context = {
    title: 'Lesson',
    text: 'This lesson explains how to submit a project assessment.',
    lang: 'en'
  };
  const result = await chat({ message: 'Who won the world cup?', context });
  assert.equal(result.grounded, false);
  assert.equal(provider.calls.length, 0);

  await assert.rejects(
    chat({ message: 'submit project', context: { ...context, text: 'x'.repeat(4001) } }),
    (error) => error.status === 413 && error.code === 'course_context_too_large'
  );
  await assert.rejects(
    chat({ message: 'submit project', context: { ...context, url: 'javascript:alert(1)' } }),
    (error) => error.status === 400 && error.code === 'invalid_course_context'
  );
  await assert.rejects(
    chat({ message: 'submit project', context: { ...context, url: `https://alx.example/${'x'.repeat(1024)}` } }),
    (error) => error.status === 400 && error.code === 'invalid_course_context'
  );
});

test('chat refuses and offers a human, without calling a model, when uncovered', async () => {
  const spy = fakeProvider('gemini', () => ({ text: 'should not be called' }));
  const chat = createChat({ retriever, router: createRouter({ providers: [spy, createOffline()] }) });
  const r = await chat({ message: 'Who won the world cup in 2010?' });
  assert.equal(r.grounded, false);
  assert.equal(r.escalate, true);
  assert.equal(spy.calls.length, 0);
});

test('chat honours a model NO_ANSWER', async () => {
  const model = fakeProvider('gemini', () => ({ text: 'NO_ANSWER' }));
  const chat = createChat({ retriever, router: createRouter({ providers: [model] }) });
  const r = await chat({ message: 'how do I check my score' });
  assert.equal(r.grounded, false);
  assert.equal(r.escalate, true);
});

test('chat answers an Amharic question in Amharic', async () => {
  const chat = createChat({ retriever, router: createRouter({ providers: [createOffline()] }), minCoverage: 0.2 });
  const r = await chat({ message: 'ውጤቴን እንዴት ማየት እችላለሁ' });
  assert.equal(r.lang, 'am');
  assert.equal(r.citations[0].id, 'am-score');
});

test('offline provider does not return untranslated English course text as an Oromo answer', async () => {
  const chat = createChat({ retriever, router: createRouter({ providers: [createOffline()] }) });
  const result = await chat({ message: 'How do I mark a lesson as complete?', lang: 'om' });
  assert.equal(result.grounded, false);
  assert.equal(result.escalate, true);
  assert.equal(result.provider, 'offline');
  assert.equal(result.answer, FALLBACK.om);
});

test('chat searches English job content with a separate query while asking the model in Afaan Oromo', async () => {
  let request;
  const provider = fakeProvider('gemini', (value) => {
    request = value;
    return { text: 'Odeeffannoo hojii [1]' };
  });
  const chat = createChat({ retriever, router: createRouter({ providers: [provider] }) });
  const message = 'Odeeffannoo hojii argamu fi gorsa deeggarsa afeerraa hojii naaf agarsiisi.';
  const result = await chat({
    message,
    retrievalQuery: 'Show available job information and interview accommodation guidance.',
    lang: 'om'
  });

  assert.equal(result.grounded, true);
  assert.equal(result.contentLang, 'en');
  assert.equal(request.messages.at(-1).content, message);
  assert.match(request.system, /Reply only in Afaan Oromo/);
});

test('chat preserves each requested language and instructs the provider to answer in that language', async () => {
  const responses = [];
  const provider = fakeProvider('gemini', (request) => {
    responses.push(request.system);
    return { text: 'A grounded answer [1]' };
  });
  const chat = createChat({ retriever, router: createRouter({ providers: [provider] }) });
  const languages = {
    en: 'English',
    am: 'Amharic',
    ti: 'Tigrinya',
    om: 'Afaan Oromo',
    so: 'Somali',
    ar: 'Arabic'
  };
  for (const [lang, languageName] of Object.entries(languages)) {
    const result = await chat({ message: 'How do I mark a lesson as complete?', lang });
    assert.equal(result.lang, lang);
    assert.equal(result.grounded, true);
    assert.match(responses[responses.length - 1], new RegExp(`Reply only in ${languageName}`));
  }
  assert.equal(provider.calls.length, Object.keys(languages).length);
});

test('chat returns a language-matched human handoff when no course content is found', async () => {
  const provider = fakeProvider('gemini', () => ({ text: 'must not run' }));
  const chat = createChat({
    retriever: { search: () => ({ hits: [], lang: 'en' }) },
    router: createRouter({ providers: [provider] })
  });
  for (const lang of ['ti', 'om', 'so', 'ar']) {
    const result = await chat({ message: 'unmatched question', lang });
    assert.equal(result.answer, FALLBACK[lang]);
    assert.equal(result.lang, lang);
    assert.equal(result.escalate, true);
  }
  assert.equal(provider.calls.length, 0);
});

const baseCfg = { port: 0, providers: ['offline'], geminiKey: '', groqKey: '', timeoutMs: 500, minCoverage: 0.3, corsOrigin: '*', rateLimitPerMin: 100, handoffRateLimitPerMin: 100, agentKey: 'test-agent-key-123456', contentDir: '' };

async function withServer(cfg, fn, options = {}) {
  const { server } = createApp(cfg, options);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { server.closeAllConnections?.(); server.close(); }
}

test('HTTP: Telegram webhook requires the configured secret header', async () => {
  const secret = 'telegram_secret-test_1234567890';
  await withServer({ ...baseCfg, telegramWebhookSecret: secret }, async (base) => {
    const url = `${base}/telegram/webhook`;
    const body = JSON.stringify({ update_id: 42 });
    const missing = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    assert.equal(missing.status, 401);
    assert.equal((await missing.json()).error.code, 'unauthorized');

    const wrong = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'wrong-secret' }, body });
    assert.equal(wrong.status, 401);

    const valid = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret }, body });
    assert.equal(valid.status, 200);
    assert.deepEqual(await valid.json(), { ok: true });
  });

  await withServer({ ...baseCfg, telegramWebhookSecret: '' }, async (base) => {
    const response = await fetch(`${base}/telegram/webhook`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ update_id: 43 })
    });
    assert.equal(response.status, 503);
  });
});

test('HTTP: /health, /v1/chat, validation, 404 and OpenAPI', async () => {
  await withServer(baseCfg, async (base) => {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    const ok = await fetch(`${base}/v1/chat`, { method: 'POST', body: JSON.stringify({ message: 'find my courses' }) });
    const body = await ok.json();
    assert.equal(ok.status, 200);
    assert.equal(body.citations[0].id, 'en-courses');
    assert.equal((await fetch(`${base}/v1/chat`, { method: 'POST', body: 'not json' })).status, 400);
    assert.equal((await fetch(`${base}/v1/chat`, { method: 'POST', body: JSON.stringify({}) })).status, 400);
    assert.equal((await fetch(`${base}/nope`)).status, 404);
    assert.equal((await fetch(`${base}/v1/openapi.json`)).status, 200);
  });
});

test('HTTP: rate limit returns 429', async () => {
  await withServer({ ...baseCfg, rateLimitPerMin: 2 }, async (base) => {
    const post = () => fetch(`${base}/v1/chat`, { method: 'POST', body: JSON.stringify({ message: 'score' }) });
    await post(); await post();
    assert.equal((await post()).status, 429);
  });
});

test('HTTP: every error uses the same { error: { code, message } } shape', async () => {
  await withServer({ ...baseCfg, corsOrigin: 'https://partner.example' }, async (base) => {
    const cases = [
      [await fetch(`${base}/nope`), 404, 'not_found'],
      [await fetch(`${base}/v1/chat`, { method: 'POST', body: 'not json' }), 400, 'invalid_json'],
      [await fetch(`${base}/v1/chat`, { method: 'POST', body: JSON.stringify({}) }), 400, 'message_required']
    ];
    for (const [res, status, code] of cases) {
      assert.equal(res.status, status);
      const body = await res.json();
      assert.equal(body.error.code, code);
      assert.equal(typeof body.error.message, 'string');
    }
    const ok = await fetch(`${base}/health`, { headers: { origin: 'https://partner.example' } });
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://partner.example');
    const stranger = await fetch(`${base}/health`, { headers: { origin: 'https://evil.example' } });
    assert.equal(stranger.headers.get('access-control-allow-origin'), null);
    assert.equal(ok.headers.get('x-api-version'), '1');
  });
});

test('widget parses, stays small, and is served safely', async () => {
  const src = readFileSync(new URL('../widget/savanna-assistant.v1.js', import.meta.url), 'utf8');
  assert.doesNotThrow(() => new vm.Script(src), 'widget must be valid JavaScript');
  const elements = {};
  const customElements = {
    get(name) { return elements[name]; },
    define(name, element) { elements[name] = element; }
  };
  vm.runInNewContext(src, {
    window: { customElements },
    document: { currentScript: null },
    HTMLElement: class HTMLElement {}
  });
  assert.ok(elements['inclusive-assistant'], 'widget should initialize and register its custom element');
  assert.ok(elements['savanna-assistant'], 'legacy custom element remains registered');
  const assistant = Object.create(elements['inclusive-assistant'].prototype);
  assistant.setCourseContext({ title: 'Lesson', text: 'Lesson excerpt', lang: 'en' });
  assert.equal(assistant._courseContext.text, 'Lesson excerpt');
  assistant.setCourseContext(null);
  assert.equal(assistant._courseContext, null);
  assert.throws(() => assistant.setCourseContext({ text: 'x'.repeat(20001) }), /20000 characters/);
  const panel = Object.create(elements['inclusive-assistant'].prototype);
  panel.mode = 'inline';
  panel.getAttribute = (name) => name === 'mode' ? panel.mode : null;
  panel._shell = { className: '' };
  panel._box = { hidden: true };
  panel._launcher = { hidden: false, setAttribute(name, value) { this[name] = value; }, focus() { this.focused = true; } };
  panel._closeBtn = { hidden: false };
  panel._q = { focus() { this.focused = true; } };
  panel._applyMode();
  assert.equal(panel._shell.className, 'shell inline');
  assert.equal(panel._box.hidden, false);
  assert.equal(panel._launcher.hidden, true);
  assert.equal(panel._closeBtn.hidden, true);
  panel.mode = null;
  panel._applyMode();
  assert.equal(panel._box.hidden, true);
  panel._setOpen(true, true);
  assert.equal(panel._box.hidden, false);
  assert.equal(panel._launcher['aria-expanded'], 'true');
  assert.equal(panel._q.focused, true);
  panel._setOpen(false, true);
  assert.equal(panel._box.hidden, true);
  assert.equal(panel._launcher.focused, true);
  assert.ok(src.length < 70 * 1024, 'widget should stay small for 3G');
  assert.match(src, /MediaRecorder/);
  assert.match(src, /data-k="cancelRecording"/);
  assert.match(src, /\/v1\/speech\/transcribe/);
  assert.match(src, /\/v1\/speech\/synthesize/);
  
  // v1.3.5 uses a single language toggle that cycles through all six languages
  assert.match(src, /LANG_CYCLE/);
  assert.match(src, /LANG_CYCLE = \['en', 'am', 'ti', 'om', 'so', 'ar'\]/);
  assert.match(src, /id="langToggle"/);
  assert.match(src, /id="langCode"/);
  for (const lang of ['en', 'am', 'ti', 'om', 'so', 'ar']) {
    assert.match(src, new RegExp(`LANG_SHORT[^}]*\\b${lang}:`));
  }
  assert.match(src, /attachShadow\(\{ mode: 'open' \}\)/);
  
  // v1.3.5 prefixes :host with all:initial, then position:fixed
  assert.match(src, /:host\{[^}]*position:fixed/);
  assert.match(src, /aria-expanded="false"/);
  assert.match(src, /data-k="closeChat"/);
  assert.match(src, /Escape/);
  assert.match(src, /request\.context = this\._courseContext/);
  assert.match(src, /setCourseContext\(context\)/);
  
  await withServer(baseCfg, async (base) => {
    const js = await fetch(`${base}/widget/inclusive-assistant.v1.js`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type'), /javascript/);
    const widget = await js.text();
    assert.match(widget, /customElements\.define\('inclusive-assistant'/);
    assert.match(widget, /customElements\.define\('savanna-assistant', LegacyInclusiveAssistant\)/);
    assert.equal((await fetch(`${base}/widget/savanna-assistant.v1.js`)).status, 200, 'legacy asset URL remains compatible');
    assert.equal((await fetch(`${base}/demo`)).status, 200);
    assert.equal((await fetch(`${base}/widget/..%2Fapi%2Fserver.js`)).status, 404);
    assert.equal((await fetch(`${base}/widget/missing.js`)).status, 404);
  });
});

test('handoff: learner and person can talk, with auth and privacy checks', async () => {
  await withServer(baseCfg, async (base) => {
    const AK = baseCfg.agentKey;
    const post = (path, body, token) => fetch(base + path, { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) });
    const get = (path, token) => fetch(base + path, { headers: token ? { authorization: `Bearer ${token}` } : {} });

    const created = await post('/v1/handoff', { question: 'I need help', transcript: [{ role: 'user', content: 'hi' }], lang: 'en' });
    assert.equal(created.status, 201);
    const { id, token } = await created.json();
    assert.ok(id && token);

    assert.equal((await get(`/v1/handoff/${id}`, 'wrong-token')).status, 404, 'wrong token must not reveal the chat');
    assert.equal((await get('/v1/agent/handoffs')).status, 401, 'agent endpoints need the key');
    assert.equal((await get('/v1/agent/handoffs', 'wrong-key')).status, 401);
    const list = await (await get('/v1/agent/handoffs', AK)).json();
    assert.equal(list.handoffs[0].status, 'waiting');

    assert.equal((await post(`/v1/handoff/${id}/messages`, { text: 'hello' }, token)).status, 201);

    const pending = get(`/v1/handoff/${id}?after=1&wait=5`, token).then((r) => r.json());
    await new Promise((r) => setTimeout(r, 50));
    assert.equal((await post(`/v1/agent/handoffs/${id}/messages`, { text: 'Hi, how can I help?' }, AK)).status, 201);
    const got = await pending;
    assert.deepEqual(got.messages.map((m) => m.from), ['system', 'agent']);
    assert.equal(got.messages[0].code, 'agent_joined');
    assert.equal(got.status, 'active');

    const view = await (await get(`/v1/agent/handoffs/${id}`, AK)).json();
    assert.equal(view.transcript.length, 1);

    assert.equal((await post(`/v1/handoff/${id}/close`, {}, token)).status, 200);
    assert.equal((await post(`/v1/handoff/${id}/messages`, { text: 'x' }, token)).status, 409);
    const after = await (await get(`/v1/agent/handoffs/${id}`, AK)).json();
    assert.equal(after.status, 'closed');
    assert.equal(after.transcript.length, 0, 'shared transcript is erased on close');
    assert.equal(after.question, '');
  });
});

test('handoff: console is off without AGENT_KEY, empty text is rejected', async () => {
  await withServer({ ...baseCfg, agentKey: '' }, async (base) => {
    const off = await fetch(`${base}/v1/agent/handoffs`, { headers: { authorization: 'Bearer anything' } });
    assert.equal(off.status, 503);
    assert.equal((await off.json()).error.code, 'agent_disabled');
    const { id, token } = await (await fetch(`${base}/v1/handoff`, { method: 'POST', body: '{}' })).json();
    const empty = await fetch(`${base}/v1/handoff/${id}/messages`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ text: '   ' }) });
    assert.equal(empty.status, 400);
    assert.equal((await empty.json()).error.code, 'text_required');
  });
});

test('handoff store: closed chats are purged after an hour, open ones after a day', () => {
  let t = 0;
  const store = createHandoffStore({ now: () => t });
  const open = store.create({ question: 'a' });
  const done = store.create({ question: 'b' });
  store.close(store.get(done.id), 'learner');
  t += 61 * 60 * 1000;
  assert.throws(() => store.get(done.id), /Not found/);
  assert.equal(store.list().length, 1);
  t += 24 * 60 * 60 * 1000;
  assert.throws(() => store.get(open.id), /Not found/);
  assert.equal(store.list().length, 0);
});

test('internal key bypasses the per-IP chat rate limit, a wrong key does not', async () => {
  await withServer({ ...baseCfg, rateLimitPerMin: 2, internalKey: 'bot-secret-123456' }, async (base) => {
    const post = (headers) => fetch(`${base}/v1/chat`, { method: 'POST', headers, body: JSON.stringify({ message: 'find my courses' }) });

    for (let i = 0; i < 5; i++) {
      assert.equal((await post({ 'x-internal-key': 'bot-secret-123456' })).status, 200, `trusted request ${i + 1} should succeed`);
    }

    assert.equal((await post({ 'x-internal-key': 'wrong' })).status, 200);
    assert.equal((await post({ 'x-internal-key': 'wrong' })).status, 200);
    assert.equal((await post({ 'x-internal-key': 'wrong' })).status, 429, 'a wrong key does not bypass the limit');
  });
});

test('sms: grounded answer, HUMAN/YES consent flow, agent relay, and END', async () => {
  const smsChat = createChat({ retriever, router: createRouter({ providers: [createOffline()] }) });
  const smsStore = createHandoffStore();
  const adapter = createConsoleSmsAdapter();
  const runtime = createSmsRuntime({ chat: smsChat, store: smsStore, sendOutbound: (to, text) => adapter.send({ to, text }) });
  const phone = '+251911000000';
  const wait = () => new Promise((r) => setTimeout(r, 50));

  await runtime.handleInbound({ from: phone, text: 'how do i check my score' });
  let out = adapter.list(0);
  assert.equal(out.length, 1);
  assert.match(out[0].text, /score/i);

  await runtime.handleInbound({ from: phone, text: 'HUMAN' });
  out = adapter.list(0);
  assert.equal(out.length, 2);
  assert.match(out[1].text, /YES/);

  await runtime.handleInbound({ from: phone, text: 'YES' });
  out = adapter.list(0);
  assert.equal(out.length, 3, 'a waiting message is sent once the handoff is created');
  const { id } = smsStore.list()[0];

  smsStore.agentSay(smsStore.get(id), 'Hi, how can I help?');
  await wait();
  out = adapter.list(0);
  assert.equal(out.length, 5, 'both the join notice and the agent reply arrive');
  assert.equal(out[4].text, 'Hi, how can I help?');

  await runtime.handleInbound({ from: phone, text: 'thanks' });
  assert.equal(smsStore.get(id).messages.some((m) => m.from === 'learner' && m.text === 'thanks'), true);
  assert.equal(adapter.list(0).length, 5, 'the learner\u2019s own message to the agent is not echoed back to them');

  await runtime.handleInbound({ from: phone, text: 'END' });
  assert.equal(smsStore.get(id).status, 'closed');
  out = adapter.list(0);
  assert.equal(out.length, 6);
});

test('SMS HTTP route: disabled by default, requires the inbound key, feeds the console outbox', async () => {
  await withServer(baseCfg, async (base) => {
    const res = await fetch(`${base}/v1/sms/inbound`, { method: 'POST', body: JSON.stringify({ from: '+1', text: 'hi' }) });
    assert.equal(res.status, 503);
  });

  for (const smsInboundKey of [undefined, '', '   ']) {
    const config = {
      ...baseCfg,
      smsProvider: 'telerivet',
      smsInboundKey,
      telerivetApiKey: 'mock-key',
      telerivetProjectId: 'mock-project'
    };
    await withServer(config, async (base) => {
      const response = await fetch(`${base}/v1/sms/inbound`, {
        method: 'POST',
        body: JSON.stringify({ from: '+251911000000', text: 'HELP' })
      });
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error.code, 'sms_inbound_unconfigured');
    });
  }

  await withServer({ ...baseCfg, smsInboundKey: 'sms-secret-123456' }, async (base) => {
    for (const authorization of [undefined, 'Bearer ', 'Bearer wrong-key']) {
      const bad = await fetch(`${base}/v1/sms/inbound`, {
        method: 'POST',
        headers: authorization ? { authorization } : {},
        body: JSON.stringify({ from: '+1', text: 'hi' })
      });
      assert.equal(bad.status, 401);
    }

    const ok = await fetch(`${base}/v1/sms/inbound`, {
      method: 'POST',
      headers: { authorization: 'Bearer sms-secret-123456' },
      body: JSON.stringify({ from: '+251911000000', text: 'how do i check my score', messageId: 'gateway-message-1' })
    });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).duplicate, false);

    const duplicate = await fetch(`${base}/v1/sms/inbound`, {
      method: 'POST', headers: { authorization: 'Bearer sms-secret-123456' },
      body: JSON.stringify({ from: '+251911000000', text: 'how do i check my score', messageId: 'gateway-message-1' })
    });
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).duplicate, true);

    const invalid = await fetch(`${base}/v1/sms/inbound`, {
      method: 'POST', headers: { authorization: 'Bearer sms-secret-123456' },
      body: JSON.stringify({ from: 'not-a-phone', text: 'hello' })
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, 'invalid_sender');

    const out = await (await fetch(`${base}/v1/sms/outbox?after=0`, { headers: { authorization: 'Bearer sms-secret-123456' } })).json();
    assert.equal(out.messages.length, 1);
    assert.equal(out.messages[0].to, '+251911000000');
    assert.equal(out.messages[0].encoding, 'GSM-7');
  });

  await withServer({ ...baseCfg, smsInboundKey: 'sms-secret-123456' }, async (base) => {
    for (let i = 0; i < 60; i += 1) {
      const response = await fetch(`${base}/v1/sms/inbound`, {
        method: 'POST', headers: { authorization: 'Bearer sms-secret-123456' },
        body: JSON.stringify({ from: '+251911000333', text: 'HELP', messageId: `limit-${i}` })
      });
      assert.equal(response.status, 200);
    }
    const limited = await fetch(`${base}/v1/sms/inbound`, {
      method: 'POST', headers: { authorization: 'Bearer sms-secret-123456' },
      body: JSON.stringify({ from: '+251911000333', text: 'HELP', messageId: 'limit-overflow' })
    });
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).error.code, 'rate_limited');
  });
});

test('Telerivet webhook authenticates, queues URL-encoded messages, and identifies duplicates', async () => {
  const seen = new Set();
  const queued = [];
  const telerivetQueue = {
    async enqueue(message) {
      const duplicate = seen.has(message.messageId);
      if (!duplicate) {
        seen.add(message.messageId);
        queued.push(message);
      }
      return { duplicate };
    }
  };
  const config = {
    ...baseCfg,
    smsProvider: 'telerivet',
    telerivetApiKey: 'test-api-key',
    telerivetProjectId: 'test-project',
    telerivetWebhookSecret: 'test-webhook-secret'
  };

  await withServer(config, async (base) => {
    const post = (values) => fetch(`${base}/v1/sms/telerivet`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(values).toString()
    });
    const message = {
      event: 'incoming_message',
      id: 'telerivet-message-1',
      message_type: 'sms',
      from_number: '+251911000000',
      from_number_e164: '+251911000000',
      content: 'ኮርስ እንዴት አገኛለሁ?',
      secret: 'wrong-secret'
    };
    const { secret, ...missingSecret } = message;
    assert.equal((await post(missingSecret)).status, 403);
    message.secret = '';
    assert.equal((await post(message)).status, 403);
    message.secret = secret;
    assert.equal((await post(message)).status, 403);
    assert.equal(queued.length, 0);

    message.secret = 'test-webhook-secret';
    const first = await post(message);
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { ok: true, duplicate: false });
    assert.deepEqual(queued[0], {
      messageId: 'telerivet-message-1',
      from: '+251911000000',
      text: 'ኮርስ እንዴት አገኛለሁ?'
    });

    const duplicate = await post(message);
    assert.equal(duplicate.status, 200);
    assert.deepEqual(await duplicate.json(), { ok: true, duplicate: true });

    const ignored = await post({ ...message, id: 'status-1', event: 'send_status' });
    assert.equal(ignored.status, 200);
    assert.deepEqual(await ignored.json(), { ok: true, ignored: true });
    assert.equal(queued.length, 1);
  }, { telerivetQueue });

  await withServer({ ...config, telerivetWebhookSecret: 'short' }, async (base) => {
    const response = await fetch(`${base}/v1/sms/telerivet`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ event: 'incoming_message', secret: 'short' }).toString()
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'telerivet_webhook_unconfigured');
  }, { telerivetQueue });
});

test('agent can inspect and retry Telerivet dead letters only with AGENT_KEY', async () => {
  const calls = [];
  const telerivetQueue = {
    async listFailed(limit) {
      calls.push({ operation: 'list', limit });
      return [{ messageId: 'dead-letter-1', attempts: 5, errorCode: 'provider_network_error' }];
    },
    async retryFailed(messageId) {
      calls.push({ operation: 'retry', messageId });
      return { retried: messageId === 'dead-letter-1' };
    }
  };
  await withServer({ ...baseCfg, smsProvider: 'telerivet' }, async (base) => {
    const unauthorized = await fetch(`${base}/v1/agent/sms/failed`);
    assert.equal(unauthorized.status, 401);

    const headers = { authorization: `Bearer ${baseCfg.agentKey}` };
    const listed = await fetch(`${base}/v1/agent/sms/failed?limit=25`, { headers });
    assert.equal(listed.status, 200);
    assert.deepEqual((await listed.json()).messages, [{ messageId: 'dead-letter-1', attempts: 5, errorCode: 'provider_network_error' }]);

    const unauthorizedRetry = await fetch(`${base}/v1/agent/sms/failed/retry`, {
      method: 'POST',
      body: JSON.stringify({ messageId: 'dead-letter-1' })
    });
    assert.equal(unauthorizedRetry.status, 401);

    const retried = await fetch(`${base}/v1/agent/sms/failed/retry`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ messageId: 'dead-letter-1' })
    });
    assert.equal(retried.status, 202);

    const unknown = await fetch(`${base}/v1/agent/sms/failed/retry`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ messageId: 'not-failed' })
    });
    assert.equal(unknown.status, 404);
  }, { telerivetQueue });
  assert.deepEqual(calls, [
    { operation: 'list', limit: 25 },
    { operation: 'retry', messageId: 'dead-letter-1' },
    { operation: 'retry', messageId: 'not-failed' }
  ]);
});

test('jobs: subscribe, unsubscribe, and independent instances', () => {
  const jobs = createJobStore();
  assert.deepEqual(jobs.subscribe({ channel: 'sms', contact: '+1', lang: 'en' }), { subscribed: true });
  assert.equal(jobs.list().length, 1);
  jobs.subscribe({ channel: 'telegram', contact: '42', lang: 'am' });
  assert.equal(jobs.list().length, 2);
  assert.deepEqual(jobs.unsubscribe({ channel: 'sms', contact: '+1' }), { removed: true });
  assert.equal(jobs.list().length, 1);
  assert.deepEqual(jobs.unsubscribe({ channel: 'sms', contact: '+1' }), { removed: false });
});

test('HTTP: job alerts subscribe/broadcast reach SMS, telegram counted as failed with no token, validation enforced', async () => {
  await withServer({ ...baseCfg, smsInboundKey: 'sms-secret-123456' }, async (base) => {
    const post = (path, body, token) => fetch(`${base}${path}`, { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) });

    assert.equal((await post('/v1/jobs/subscribe', { contact: '+251911000000' })).status, 400);
    assert.equal((await post('/v1/jobs/subscribe', { channel: 'sms' })).status, 400);
    assert.equal((await post('/v1/jobs/subscribe', { channel: 'sms', contact: '+251911000000', lang: 'en' })).status, 201);
    assert.equal((await post('/v1/jobs/subscribe', { channel: 'telegram', contact: '555', lang: 'en' })).status, 201);

    assert.equal((await post('/v1/agent/jobs/broadcast', { text: 'New job: data entry clerk' })).status, 401);

    const result = await (await post('/v1/agent/jobs/broadcast', { text: 'New job: data entry clerk' }, baseCfg.agentKey)).json();
    assert.equal(result.total, 2);
    assert.equal(result.sent, 1, 'the sms subscriber is delivered to');
    assert.equal(result.failed, 1, 'the telegram subscriber fails with no bot token configured in this test');

    const outbox = await (await fetch(`${base}/v1/sms/outbox?after=0`, { headers: { authorization: 'Bearer sms-secret-123456' } })).json();
    assert.equal(outbox.messages.length, 1);
    assert.match(outbox.messages[0].text, /data entry clerk/);
  });
});

test('accommodations: usable through the normal handoff endpoints, tagged for the agent', async () => {
  await withServer(baseCfg, async (base) => {
    const post = (path, body, token) => fetch(`${base}${path}`, { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) });
    const get = (path, token) => fetch(`${base}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });

    assert.equal((await post('/v1/accommodations', {})).status, 400);

    const created = await post('/v1/accommodations', { request: 'I need a sign language interpreter', lang: 'en' });
    assert.equal(created.status, 201);
    const { id, token } = await created.json();

    const list = await (await get('/v1/agent/handoffs', baseCfg.agentKey)).json();
    assert.equal(list.handoffs[0].kind, 'accommodation');

    assert.equal((await post(`/v1/handoff/${id}/messages`, { text: 'Also a quiet room, please' }, token)).status, 201);

    const view = await (await get(`/v1/agent/handoffs/${id}`, baseCfg.agentKey)).json();
    assert.equal(view.kind, 'accommodation');
    assert.match(view.question, /interpreter/);
  });
});

test('HTTP: speech routes are disabled without ADDIS_API_KEY and proxy mocked speech requests', async () => {
  await withServer(baseCfg, async (base) => {
    const disabled = await fetch(`${base}/v1/speech/synthesize`, { method: 'POST', body: JSON.stringify({ text: 'hello', language: 'am' }) });
    assert.equal(disabled.status, 503);
    assert.equal((await disabled.json()).error.code, 'speech_disabled');
  });

  let transcriptRequest;
  let speechRequest;
  const mockedSpeech = {
    async transcribe(input) { transcriptRequest = input; return { text: 'ሰላም', language: input.language }; },
    async synthesize(input) { speechRequest = input; return { audioUrl: 'https://audio.example/mock.mp3', voiceId: 'am-hamen', language: input.language }; }
  };
  await withServer({ ...baseCfg, addisApiKey: 'test-key' }, async (base) => {
    const form = new FormData();
    form.append('language', 'am');
    form.append('audio', new Blob([makeWav()], { type: 'audio/wav' }), 'voice.wav');
    const stt = await fetch(`${base}/v1/speech/transcribe`, { method: 'POST', body: form });
    assert.equal(stt.status, 200);
    assert.deepEqual(await stt.json(), { text: 'ሰላም', language: 'am' });
    assert.equal(transcriptRequest.mimeType, 'audio/wav');

    const tts = await fetch(`${base}/v1/speech/synthesize`, { method: 'POST', body: JSON.stringify({ text: 'ሰላም', language: 'am' }) });
    assert.equal(tts.status, 200);
    assert.equal((await tts.json()).audioUrl, 'https://audio.example/mock.mp3');
    assert.deepEqual(speechRequest, { text: 'ሰላም', language: 'am' });

    const unsupported = await fetch(`${base}/v1/speech/synthesize`, { method: 'POST', body: JSON.stringify({ text: 'hello', language: 'en' }) });
    assert.equal(unsupported.status, 422);
    assert.equal((await unsupported.json()).error.code, 'unsupported_speech_language');

    const badFormat = new FormData();
    badFormat.append('language', 'am');
    badFormat.append('audio', new Blob(['not audio'], { type: 'application/octet-stream' }), 'bad.bin');
    const invalid = await fetch(`${base}/v1/speech/transcribe`, { method: 'POST', body: badFormat });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, 'unsupported_audio_format');

    const empty = await fetch(`${base}/v1/speech/synthesize`, { method: 'POST', body: JSON.stringify({ text: '', language: 'am' }) });
    assert.equal(empty.status, 400);
    const overlong = await fetch(`${base}/v1/speech/synthesize`, { method: 'POST', body: JSON.stringify({ text: 'a'.repeat(601), language: 'am' }) });
    assert.equal(overlong.status, 413);
  }, { speech: mockedSpeech });
});

test('Addis STT returns a clear authentication error when key is invalid', async () => {
  const speech = createAddisSpeech({
    apiKey: 'invalid-test-key',
    fetchImpl: async () => Response.json({ status: 'error', error: { code: 'invalid_api_key', message: 'invalid' } }, { status: 401 })
  });
  await assert.rejects(speech.transcribe({ audio: Buffer.from('mock'), mimeType: 'audio/webm', language: 'am' }), (e) => {
    assert.equal(e.code, 'speech_auth_failed');
    assert.ok(!e.message.includes('invalid-test-key'));
    return true;
  });
});

test('Addis TTS returns configured errors and rejects unavailable voices', async () => {
  const unauthorized = createAddisSpeech({ apiKey: 'test-key', fetchImpl: async () => Response.json({}, { status: 401 }) });
  await assert.rejects(unauthorized.synthesize({ text: 'test', language: 'am' }), (e) => e.code === 'speech_auth_failed');
  const noVoice = createAddisSpeech({ apiKey: 'test-key', fetchImpl: async () => Response.json({ data: [] }) });
  await assert.rejects(noVoice.synthesize({ text: 'test', language: 'am' }), (e) => e.code === 'speech_voice_unavailable');
});

test('channel language selection recognizes four language names and conservatively detects messages', () => {
  assert.equal(parseChannelLanguage('ENGLISH'), 'en');
  assert.equal(parseChannelLanguage('AMHARIC'), 'am');
  assert.equal(parseChannelLanguage('AFAAN OROMOO'), 'om');
  assert.equal(parseChannelLanguage('TIGRINYA'), 'ti');
  assert.equal(parseChannelLanguage('ትግርኛ'), 'ti');
  assert.equal(detectChannelLanguage('How do I check my score?'), 'en');
  assert.equal(detectChannelLanguage('ኮርስ ውጤት እንዴት'), 'am');
  assert.equal(detectChannelLanguage('Akkamitti hojii barnoota'), 'om');
  assert.equal(detectChannelLanguage('kemey tigrinya dehan'), 'ti');
  assert.equal(detectChannelLanguage('hello'), null, 'uncertain text asks user to choose');
});

test('SMS encoding reports GSM and Unicode multipart lengths', () => {
  assert.deepEqual(smsEncoding('Hello'), { encoding: 'GSM-7', units: 5, segments: 1 });
  assert.deepEqual(smsEncoding('a'.repeat(161)), { encoding: 'GSM-7', units: 161, segments: 2 });
  assert.deepEqual(smsEncoding('አ'.repeat(71)), { encoding: 'UCS-2', units: 71, segments: 2 });
});

test('SMS language commands, opt-out, invalid input, deduplication, and throttling', async () => {
  const adapter = createConsoleSmsAdapter();
  const smsStore = createHandoffStore();
  const jobs = createJobStore();
  let time = 1000;
  const runtime = createSmsRuntime({
    chat: async ({ message, lang }) => ({ answer: `${lang}:${message}`, escalate: false }),
    store: smsStore,
    jobStore: jobs,
    now: () => time,
    maxPerMinute: 10,
    sendOutbound: (to, text, meta) => adapter.send({ to, text, ...meta })
  });
  const phone = '+251911000111';

  assert.equal((await runtime.handleInbound({ from: phone, text: 'Help' })).accepted, true);
  assert.match(adapter.list(0).at(-1).text, /LANGUAGE/);
  await runtime.handleInbound({ from: phone, text: 'JOBS ON' });
  assert.equal(jobs.list().length, 1);
  await runtime.handleInbound({ from: phone, text: 'JOBS OFF' });
  assert.equal(jobs.list().length, 0);
  assert.equal((await runtime.handleInbound({ from: phone, text: 'AFAAN OROMOO', messageId: 'm-1' })).language, 'om');
  assert.equal(runtime.getSession(phone).lang, 'om');
  const beforeDuplicate = adapter.list(0).length;
  assert.equal((await runtime.handleInbound({ from: phone, text: 'AFAAN OROMOO', messageId: 'm-1' })).duplicate, true);
  assert.equal(adapter.list(0).length, beforeDuplicate, 'duplicate webhook delivery is not processed twice');

  await runtime.handleInbound({ from: phone, text: 'How do I check my score?' });
  assert.match(adapter.list(0).at(-1).text, /Afaan Ingiliffaa.*Amaaraa/);
  await runtime.handleInbound({ from: phone, text: 'AMHARIC' });
  await runtime.handleInbound({ from: phone, text: 'ኮርስ ውጤት እንዴት' });
  assert.match(adapter.list(0).at(-1).text, /^am:/);
  await runtime.handleInbound({ from: phone, text: 'TIGRINYA' });
  assert.equal(runtime.getSession(phone).lang, 'ti');
  await runtime.handleInbound({ from: phone, text: 'kemey tigrinya dehan' });
  assert.match(adapter.list(0).at(-1).text, /English.*Amharic|English.*Amharic/i);

  await runtime.handleInbound({ from: phone, text: 'STOP' });
  assert.equal(runtime.getSession(phone).optedOut, true);
  const afterStop = adapter.list(0).length;
  assert.equal((await runtime.handleInbound({ from: phone, text: 'some follow-up text' })).reason, 'opted_out');
  assert.equal(adapter.list(0).length, afterStop);
  await runtime.handleInbound({ from: phone, text: 'START' });
  assert.equal(runtime.getSession(phone).optedOut, false);

  assert.equal((await runtime.handleInbound({ from: 'invalid', text: 'hi' })).reason, 'invalid_sender');
  assert.equal((await runtime.handleInbound({ from: phone, text: 'x'.repeat(1001) })).reason, 'message_too_long');
  const limitedPhone = '+251911000222';
  await runtime.handleInbound({ from: limitedPhone, text: 'ENGLISH' });
  for (let i = 0; i < 10; i += 1) await runtime.handleInbound({ from: limitedPhone, text: 'How do I check my score?' });
  assert.equal((await runtime.handleInbound({ from: limitedPhone, text: 'How do I check my score?' })).reason, 'rate_limited');
  time += 60001;
  assert.equal((await runtime.handleInbound({ from: limitedPhone, text: 'HELP' })).accepted, true);
});

test('console SMS records Unicode segment metadata and webhook adapter reports gateway failures', async () => {
  const consoleSms = createConsoleSmsAdapter();
  const metadata = smsEncoding('አ'.repeat(71));
  await consoleSms.send({ to: '+251911000000', text: 'አ'.repeat(71), ...metadata });
  assert.equal(consoleSms.list()[0].encoding, 'UCS-2');
  assert.equal(consoleSms.list()[0].segments, 2);

  let request;
  const webhook = createWebhookSmsAdapter({
    url: 'https://gateway.example/messages', key: 'secret-for-test',
    fetchImpl: async (url, options) => { request = { url, options }; return new Response('', { status: 202 }); }
  });
  await webhook.send({ to: '+251911000000', text: 'ሰላም', ...smsEncoding('ሰላም') });
  assert.equal(JSON.parse(request.options.body).encoding, 'UCS-2');
  assert.equal(request.options.headers.authorization, 'Bearer secret-for-test');
  const failed = createWebhookSmsAdapter({ url: 'https://gateway.example/messages', fetchImpl: async () => new Response('', { status: 503 }) });
  await assert.rejects(failed.send({ to: '+251911000000', text: 'hi' }), /HTTP 503/);
});

test('Telerivet adapter uses the documented REST endpoint, Basic authentication, and JSON payload', async () => {
  let request;
  const adapter = createTelerivetSmsAdapter({
    apiKey: 'test-api-key',
    projectId: 'prj-test',
    routeId: 'route-test',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return Response.json({ id: 'msg-test', status: 'queued' });
    }
  });
  const result = await adapter.send({ to: '+251911000000', text: 'ሰላም' });
  assert.equal(result.id, 'msg-test');
  assert.equal(request.url, 'https://api.telerivet.com/v1/projects/prj-test/messages/send');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.authorization, `Basic ${Buffer.from('test-api-key:').toString('base64')}`);
  assert.deepEqual(JSON.parse(request.options.body), {
    to_number: '+251911000000',
    content: 'ሰላም',
    route_id: 'route-test'
  });

  const failed = createTelerivetSmsAdapter({
    apiKey: 'test-api-key',
    projectId: 'prj-test',
    fetchImpl: async () => new Response(JSON.stringify({ error: { code: 'unauthorized' } }), { status: 401 })
  });
  await assert.rejects(failed.send({ to: '+251911000000', text: 'Hello' }), (error) => {
    assert.match(error.message, /HTTP 401/);
    assert.equal(error.retryable, false);
    return true;
  });

  const temporary = createTelerivetSmsAdapter({
    apiKey: 'test-api-key',
    projectId: 'prj-test',
    fetchImpl: async () => new Response('', { status: 503 })
  });
  await assert.rejects(temporary.send({ to: '+251911000000', text: 'Hello' }), (error) => {
    assert.equal(error.retryable, true);
    assert.equal(error.status, 503);
    return true;
  });

  const networkFailure = createTelerivetSmsAdapter({
    apiKey: 'test-api-key',
    projectId: 'prj-test',
    fetchImpl: async () => { throw new Error('offline'); }
  });
  await assert.rejects(networkFailure.send({ to: '+251911000000', text: 'Hello' }), (error) => {
    assert.equal(error.retryable, true);
    assert.equal(error.code, 'provider_network_error');
    return true;
  });
});

function createTelerivetRedis() {
  let time = 100000;
  let nextId = 0;
  const values = new Map();
  const valueExpiry = new Map();
  const hashes = new Map();
  const hashExpiry = new Map();
  const streams = new Map();
  const pending = new Map();
  const groups = new Set();
  const retries = new Map();

  function getString(key) {
    const expires = valueExpiry.get(key);
    if (expires !== undefined && expires <= time) {
      values.delete(key);
      valueExpiry.delete(key);
    }
    return values.get(key) || null;
  }

  function setString(key, value, options = {}) {
    values.set(key, String(value));
    if (options.PX !== undefined) valueExpiry.set(key, time + Number(options.PX));
    else if (options.EX !== undefined) valueExpiry.set(key, time + Number(options.EX) * 1000);
    else valueExpiry.delete(key);
    return 'OK';
  }

  function getHash(key) {
    const expires = hashExpiry.get(key);
    if (expires !== undefined && expires <= time) {
      hashes.delete(key);
      hashExpiry.delete(key);
    }
    if (!hashes.has(key)) hashes.set(key, {});
    return hashes.get(key);
  }

  function append(stream, message) {
    const id = `${++nextId}-0`;
    const entries = streams.get(stream) || [];
    entries.push({ id, message: Object.fromEntries(Object.entries(message).map(([key, value]) => [key, String(value)])) });
    streams.set(stream, entries);
    return id;
  }

  function removeEntry(id) {
    for (const [stream, entries] of streams) {
      streams.set(stream, entries.filter((entry) => entry.id !== id));
    }
    pending.delete(id);
  }

  function entryById(id) {
    for (const entries of streams.values()) {
      const entry = entries.find((candidate) => candidate.id === id);
      if (entry) return entry;
    }
    return null;
  }

  return {
    async eval(script, { keys, arguments: args }) {
      const operation = script.match(/-- operation:([\w_]+)/)?.[1];
      if (operation === 'enqueue') {
        const existing = getString(keys[0]);
        if (existing) return [0, existing];
        const id = append(keys[1], { job_key: keys[2], message_id: args[0], from: args[1], text: args[2] });
        Object.assign(getHash(keys[2]), {
          status: 'queued', attempts: '0', message_id: args[0], from: args[1],
          text: args[2], created_at: args[3], updated_at: args[3], stream_id: id
        });
        setString(keys[0], 'queued');
        return [1, id];
      }
      if (operation === 'start_processing') {
        if (getString(keys[0]) !== args[0]) return [0, 'lock_lost'];
        const state = getHash(keys[1]);
        if (state.status === 'done' || state.status === 'dead') return [0, state.status];
        if (!state.status) Object.assign(state, {
          status: 'queued', attempts: '0', message_id: args[3], from: args[4],
          text: args[5], created_at: args[1], updated_at: args[1]
        });
        const attempt = Number(state.attempts || 0) + 1;
        Object.assign(state, { status: 'processing', attempts: String(attempt), updated_at: args[1], stream_id: args[2], worker: args[0] });
        return [1, attempt];
      }
      if (operation === 'renew_lease') {
        if (getString(keys[0]) !== args[0]) return 0;
        setString(keys[0], args[0], { PX: args[1] });
        return 1;
      }
      if (operation === 'release_lease') {
        if (getString(keys[0]) !== args[0]) return 0;
        values.delete(keys[0]);
        valueExpiry.delete(keys[0]);
        return 1;
      }
      if (operation === 'complete') {
        if (getString(keys[0]) !== args[0]) return 0;
        Object.assign(getHash(keys[1]), {
          status: 'done', completed_at: args[3], updated_at: args[3],
          last_error: '', error_code: '', next_attempt_at: ''
        });
        hashExpiry.set(keys[1], time + Number(args[2]) * 1000);
        setString(keys[2], 'done', { EX: args[2] });
        removeEntry(args[1]);
        values.delete(keys[0]);
        valueExpiry.delete(keys[0]);
        return 1;
      }
      if (operation === 'fail_or_retry') {
        if (getString(keys[0]) !== args[0]) return [0, 'lock_lost'];
        removeEntry(args[1]);
        const state = getHash(keys[1]);
        if (args[7] === '1' || Number(args[2]) >= Number(args[3])) {
          const deadId = append(keys[5], {
            job_key: keys[1], message_id: state.message_id, from: state.from, text: state.text,
            attempts: args[2], error_code: args[4], error: args[5], failed_at: args[9]
          });
          Object.assign(state, {
            status: 'dead', last_error: args[5], error_code: args[4],
            failed_at: args[9], dead_stream_id: deadId, next_attempt_at: '', updated_at: args[9]
          });
          setString(keys[2], 'dead');
          values.delete(keys[0]);
          valueExpiry.delete(keys[0]);
          return [2, deadId];
        }
        Object.assign(state, {
          status: 'retry', last_error: args[5], error_code: args[4],
          next_attempt_at: args[6], updated_at: args[9]
        });
        retries.set(keys[1], Number(args[6]));
        setString(keys[2], 'retry');
        values.delete(keys[0]);
        valueExpiry.delete(keys[0]);
        return [1, args[6]];
      }
      if (operation === 'dispatch_retries') {
        const due = [...retries.entries()]
          .filter(([, retryAt]) => retryAt <= Number(args[0]))
          .sort((a, b) => a[1] - b[1])
          .slice(0, Number(args[1]));
        for (const [jobKey] of due) {
          const state = getHash(jobKey);
          if (state.status === 'retry') {
            const id = append(keys[1], { job_key: jobKey, message_id: state.message_id, from: state.from, text: state.text });
            Object.assign(state, { status: 'queued', stream_id: id, next_attempt_at: '', updated_at: args[0] });
            setString(`inclusive:sms:telerivet:message:${jobKey.split(':').pop()}`, 'queued');
          }
          retries.delete(jobKey);
        }
        return due.length;
      }
      if (operation === 'retry_failed') {
        const state = getHash(keys[0]);
        if (state.status !== 'dead') return [0, state.status || 'missing'];
        if (state.dead_stream_id) removeEntry(state.dead_stream_id);
        const id = append(keys[2], { job_key: keys[0], message_id: args[0], from: state.from, text: state.text });
        Object.assign(state, {
          status: 'queued', attempts: '0', updated_at: args[1], stream_id: id,
          last_error: '', error_code: '', failed_at: '', dead_stream_id: '', next_attempt_at: ''
        });
        retries.delete(keys[0]);
        setString(keys[1], 'queued');
        return [1, id];
      }
      throw new Error(`Unknown fake Redis script operation: ${operation}`);
    },
    async get(key) { return getString(key); },
    async set(key, value, options = {}) {
      if (options.NX && getString(key) !== null) return null;
      return setString(key, value, options);
    },
    async hGetAll(key) { return { ...getHash(key) }; },
    async xGroupCreate(stream, group) {
      const key = `${stream}:${group}`;
      if (groups.has(key)) throw new Error('BUSYGROUP Consumer Group name already exists');
      groups.add(key);
    },
    async xReadGroup(_group, consumer, streamArgs, options = {}) {
      const stream = streamArgs[0].key;
      const entries = (streams.get(stream) || []).filter((entry) => !pending.has(entry.id)).slice(0, options.COUNT || 1);
      if (!entries.length) {
        await new Promise((resolve) => setTimeout(resolve, 3));
        return null;
      }
      for (const entry of entries) pending.set(entry.id, { consumer, deliveredAt: time });
      return [{ name: stream, messages: entries }];
    },
    async xAutoClaim(stream, _group, consumer, minIdle, _start, options = {}) {
      const messages = [];
      for (const entry of streams.get(stream) || []) {
        const delivery = pending.get(entry.id);
        if (!delivery || time - delivery.deliveredAt < Number(minIdle)) continue;
        pending.set(entry.id, { consumer, deliveredAt: time });
        messages.push(entry);
        if (messages.length >= (options.COUNT || 1)) break;
      }
      return { messages };
    },
    async xAck(_stream, _group, id) { const existed = pending.delete(id); return existed ? 1 : 0; },
    async xDel(_stream, id) { const existed = entryById(id); removeEntry(id); return existed ? 1 : 0; },
    async xRange(stream, _start, _end, options = {}) { return (streams.get(stream) || []).slice(0, options.COUNT || 100); },
    seedPending(id, consumer = 'stopped-worker') { pending.set(id, { consumer, deliveredAt: time }); },
    seedState(key, fields) { Object.assign(getHash(key), fields); },
    advance(ms) { time += ms; },
    currentTime() { return time; },
    readState(key) { return { ...getHash(key) }; },
    delete(key) { values.delete(key); valueExpiry.delete(key); }
  };
}

function testQueueKeys(messageId) {
  const hash = createHash('sha256').update(messageId).digest('hex');
  return {
    state: `inclusive:sms:telerivet:state:${hash}`,
    dedupe: `inclusive:sms:telerivet:message:${hash}`
  };
}

function createMockedTelerivetRuntime(fetchImpl) {
  const adapter = createTelerivetSmsAdapter({
    apiKey: 'mock-key',
    projectId: 'mock-project',
    fetchImpl
  });
  return createSmsRuntime({
    chat: async () => ({ answer: 'mock answer', escalate: false }),
    store: createHandoffStore(),
    jobStore: createJobStore(),
    sendOutbound: (to, text) => adapter.send({ to, text })
  });
}

async function waitForTest(predicate, message) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(message);
}

test('Telerivet Redis queue deduplicates webhook IDs and processes one response', async () => {
  const redis = createTelerivetRedis();
  const received = [];
  const queue = createTelerivetSmsQueue({
    client: redis,
    runtime: { async handleInbound(message, options) { received.push({ message, options }); return { accepted: true }; } }
  });
  const message = { messageId: 'queue-message-1', from: '+251911000000', text: 'HELP' };
  assert.equal((await queue.enqueue(message)).duplicate, false);
  assert.equal((await queue.enqueue(message)).duplicate, true);
  await queue.start();
  try {
    await waitForTest(() => redis.readState(testQueueKeys(message.messageId).state).status === 'done', 'queued SMS was not completed');
  } finally {
    await queue.stop();
  }
  assert.equal(received.length, 1);
  assert.deepEqual(received[0], {
    message: { from: message.from, text: message.text, messageId: message.messageId },
    options: { retryDelivery: true }
  });
});

test('Telerivet queue retries temporary provider failures with backoff and eventually succeeds', async () => {
  const redis = createTelerivetRedis();
  let attempts = 0;
  const runtime = createMockedTelerivetRuntime(async () => {
    attempts += 1;
    return attempts < 3
      ? new Response('', { status: 503 })
      : Response.json({ id: 'mock-sent-message' });
  });
  const queue = createTelerivetSmsQueue({
    client: redis,
    maxAttempts: 3,
    retryBaseMs: 5,
    retryMaxMs: 20,
    leaseMs: 3000,
    claimIdleMs: 1000,
    now: () => redis.currentTime(),
    runtime,
    logError: () => {}
  });
  const messageId = 'temporary-retry-1';
  await queue.enqueue({ messageId, from: '+251911000000', text: 'HELP' });
  await queue.start();
  try {
    await waitForTest(() => redis.readState(testQueueKeys(messageId).state).status === 'retry', 'first temporary failure was not scheduled');
    let state = redis.readState(testQueueKeys(messageId).state);
    assert.equal(Number(state.next_attempt_at) - Number(state.updated_at), 5);
    redis.advance(5);
    await waitForTest(() => redis.readState(testQueueKeys(messageId).state).status === 'retry' && redis.readState(testQueueKeys(messageId).state).attempts === '2', 'second temporary failure was not scheduled');
    state = redis.readState(testQueueKeys(messageId).state);
    assert.equal(Number(state.next_attempt_at) - Number(state.updated_at), 10);
    redis.advance(10);
    await waitForTest(() => redis.readState(testQueueKeys(messageId).state).status === 'done', 'temporary failure was not retried');
  } finally {
    await queue.stop();
  }
  assert.equal(attempts, 3);
  assert.equal(redis.readState(testQueueKeys(messageId).state).attempts, '3');
});

test('Telerivet queue moves exhausted temporary failures to dead letters', async () => {
  const redis = createTelerivetRedis();
  const queue = createTelerivetSmsQueue({
    client: redis,
    maxAttempts: 2,
    retryBaseMs: 5,
    leaseMs: 3000,
    claimIdleMs: 1000,
    now: () => redis.currentTime(),
    runtime: {
      async handleInbound() {
        throw new TelerivetSmsError('temporary provider error', { code: 'provider_network_error', retryable: true });
      }
    },
    logError: () => {}
  });
  const messageId = 'exhausted-retry-1';
  await queue.enqueue({ messageId, from: '+251911000000', text: 'HELP' });
  await queue.start();
  try {
    await waitForTest(() => redis.readState(testQueueKeys(messageId).state).status === 'retry', 'first failure was not retried');
    redis.advance(5);
    await waitForTest(() => redis.readState(testQueueKeys(messageId).state).status === 'dead', 'exhausted job was not dead-lettered');
  } finally {
    await queue.stop();
  }
  const [failed] = await queue.listFailed();
  assert.equal(failed.messageId, messageId);
  assert.equal(failed.attempts, 2);
});

test('Telerivet queue dead-letters permanent failures and permits an explicit retry', async () => {
  const redis = createTelerivetRedis();
  let fail = true;
  let attempts = 0;
  const runtime = createMockedTelerivetRuntime(async () => {
    attempts += 1;
    return fail
      ? new Response(JSON.stringify({ error: { code: 'unauthorized' } }), { status: 401 })
      : Response.json({ id: 'mock-sent-message' });
  });
  const queue = createTelerivetSmsQueue({
    client: redis,
    retryBaseMs: 5,
    leaseMs: 3000,
    claimIdleMs: 1000,
    runtime,
    logError: () => {}
  });
  const messageId = 'permanent-failure-1';
  await queue.enqueue({ messageId, from: '+251911000000', text: 'HELP' });
  await queue.start();
  try {
    await waitForTest(() => redis.readState(testQueueKeys(messageId).state).status === 'dead', 'permanent failure was not dead-lettered');
    const [failed] = await queue.listFailed();
    assert.equal(failed.messageId, messageId);
    assert.equal(failed.errorCode, 'provider_http_error');
    assert.equal(failed.attempts, 1);
    const retried = await queue.retryFailed(messageId);
    assert.equal(retried.retried, true);
    assert.equal(typeof retried.status, 'string');
    fail = false;
    await waitForTest(() => redis.readState(testQueueKeys(messageId).state).status === 'done', 'manually retried dead letter did not complete');
  } finally {
    await queue.stop();
  }
  assert.equal(attempts, 2);
  assert.deepEqual(await queue.listFailed(), []);
});

test('Telerivet queue recovers a pending job after the previous worker lease expires', async () => {
  const redis = createTelerivetRedis();
  const messageId = 'restart-recovery-1';
  const message = { messageId, from: '+251911000000', text: 'HELP' };
  const enqueueQueue = createTelerivetSmsQueue({ client: redis, runtime: { async handleInbound() { return { accepted: true }; } } });
  const queued = await enqueueQueue.enqueue(message);
  const keys = testQueueKeys(messageId);
  redis.seedPending(queued.streamId);
  redis.seedState(keys.state, {
    status: 'processing', attempts: '1', message_id: messageId,
    from: message.from, text: message.text
  });
  await redis.set(`${keys.state}:lease`, 'abandoned-worker', { PX: 1000 });
  redis.advance(2000);

  let processed = 0;
  const restarted = createTelerivetSmsQueue({
    client: redis,
    leaseMs: 3000,
    claimIdleMs: 1000,
    runtime: { async handleInbound() { processed += 1; return { accepted: true }; } }
  });
  await restarted.start();
  try {
    await waitForTest(() => redis.readState(keys.state).status === 'done', 'restarted worker did not recover pending job');
  } finally {
    await restarted.stop();
  }
  assert.equal(processed, 1);
  assert.equal(redis.readState(keys.state).attempts, '2');
});

test('Telerivet queue lease prevents concurrent workers from handling the same message', async () => {
  const redis = createTelerivetRedis();
  const messageId = 'concurrent-worker-1';
  const message = { messageId, from: '+251911000000', text: 'HELP' };
  const enqueueQueue = createTelerivetSmsQueue({ client: redis, runtime: { async handleInbound() { return { accepted: true }; } } });
  const queued = await enqueueQueue.enqueue(message);
  const keys = testQueueKeys(messageId);
  redis.seedPending(queued.streamId);
  redis.seedState(keys.state, { status: 'processing', attempts: '1', message_id: messageId, from: message.from, text: message.text });
  await redis.set(`${keys.state}:lease`, 'active-worker', { PX: 5000 });
  redis.advance(1100);

  let processed = 0;
  const competingWorker = createTelerivetSmsQueue({
    client: redis,
    leaseMs: 5000,
    claimIdleMs: 1000,
    runtime: { async handleInbound() { processed += 1; return { accepted: true }; } }
  });
  await competingWorker.start();
  try {
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(processed, 0, 'a live lease prevents a second worker from entering the runtime');
    redis.delete(`${keys.state}:lease`);
    redis.advance(1100);
    await waitForTest(() => redis.readState(keys.state).status === 'done', 'message was not recovered after lease release');
  } finally {
    await competingWorker.stop();
  }
  assert.equal(processed, 1);
});

test('Telerivet queue shutdown waits for active work and preserves completion', async () => {
  const redis = createTelerivetRedis();
  let releaseWork;
  let enteredWork;
  const entered = new Promise((resolve) => { enteredWork = resolve; });
  const queue = createTelerivetSmsQueue({
    client: redis,
    leaseMs: 3000,
    claimIdleMs: 1000,
    runtime: {
      async handleInbound() {
        enteredWork();
        return new Promise((resolve) => { releaseWork = resolve; });
      }
    }
  });
  const messageId = 'shutdown-active-1';
  await queue.enqueue({ messageId, from: '+251911000000', text: 'HELP' });
  await queue.start();
  await entered;
  let stopped = false;
  const stopping = queue.stop().then(() => { stopped = true; });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(stopped, false);
  releaseWork({ accepted: true });
  await stopping;
  assert.equal(redis.readState(testQueueKeys(messageId).state).status, 'done');
});

test('Telegram command parser supports new commands, bot mentions, and all language selections', () => {
  assert.deepEqual(parseTelegramInput('/learn How do I check my score?'), {
    text: '/learn How do I check my score?', command: '/learn', argument: 'How do I check my score?', language: null, knownCommand: true
  });
  assert.equal(parseTelegramInput('/language Afaan Oromoo').language, 'om');
  assert.equal(parseTelegramInput('/ti@InclusiveBot').command, '/ti');
  assert.equal(parseTelegramInput('/support').knownCommand, true);
  assert.equal(parseTelegramInput('/unknown').knownCommand, false);
  const session = { lang: null, languageExplicit: false };
  assert.equal(applyTelegramLanguage(session, parseTelegramInput('/language Tigrinya')), 'ti');
  assert.deepEqual(session, { lang: 'ti', languageExplicit: true });
  for (const [label, expected] of [['English', 'en'], ['Amharic', 'am'], ['Afaan Oromoo', 'om'], ['Tigrinya', 'ti']]) {
    assert.equal(parseTelegramInput(`/language ${label}`).language, expected);
  }
});

test('Telegram webhook registration requires Telegram-compatible secret tokens', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return Response.json({ ok: true, result: true });
  };
  const invalid = await registerWebhook({
    token: 'test-token', baseUrl: 'https://assistant.example', secret: 'invalid secret!', fetchImpl
  });
  assert.deepEqual(invalid, { ok: false, reason: 'invalid_secret' });
  assert.equal(request, undefined);

  const registered = await registerWebhook({
    token: 'test-token', baseUrl: 'https://assistant.example', path: '/telegram/webhook',
    secret: 'telegram_secret-test_1234567890', fetchImpl
  });
  assert.deepEqual(registered, { ok: true, url: 'https://assistant.example/telegram/webhook' });
  assert.equal(request.url, 'https://api.telegram.org/bottest-token/setWebhook');
  assert.deepEqual(JSON.parse(request.options.body), {
    url: 'https://assistant.example/telegram/webhook', secret_token: 'telegram_secret-test_1234567890'
  });

  const failed = await registerWebhook({
    token: 'test-token', baseUrl: 'https://assistant.example', secret: 'safe_secret_123456',
    fetchImpl: async () => Response.json({ ok: false, description: 'includes secret safe_secret_123456' }, { status: 400 })
  });
  assert.deepEqual(failed, { ok: false, reason: 'telegram_error' });
});