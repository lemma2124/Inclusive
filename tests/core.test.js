import { test } from 'node:test';
import assert from 'node:assert/strict';
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
import { detectChannelLanguage, parseChannelLanguage, smsEncoding } from '../api/sms/language.js';
import { parseTelegramInput } from '../telegram/commands.js';
import { applyTelegramLanguage } from '../telegram/commands.js';
import { createJobStore } from '../api/jobs/store.js';
import { MAX_SPEECH_BYTES, readSpeechUpload } from '../api/speech/upload.js';

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
  assert.equal(result.text, 'transcribed words');
  assert.equal(result.language, 'om');
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
  oversized.headers = { 'content-type': 'multipart/form-data; boundary=x', 'content-length': String(MAX_SPEECH_BYTES + 100000) };
  await assert.rejects(readSpeechUpload(oversized), (e) => e.code === 'audio_too_large');
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
  assert.throws(() => assistant.setCourseContext({ text: 'x'.repeat(1001) }), /1000 characters/);
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

  await withServer({ ...baseCfg, smsInboundKey: 'sms-secret-123456' }, async (base) => {
    const bad = await fetch(`${base}/v1/sms/inbound`, { method: 'POST', body: JSON.stringify({ from: '+1', text: 'hi' }) });
    assert.equal(bad.status, 401);

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