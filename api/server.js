import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './lib/config.js';
import { bearer, safeEqual } from './lib/auth.js';
import { loadPassages, DEFAULT_CONTENT_DIR } from './retrieval/content.js';
import { Retriever } from './retrieval/index.js';
import { createGemini } from './ai/gemini.js';
import { createOpenAICompatible } from './ai/groq.js';
import { createOllama } from './ai/ollama.js';
import { createAddisSpeech } from './ai/addis-speech.js';
import { createOffline } from './ai/offline.js';
import { createRouter } from './ai/router.js';
import { createChat } from './chat.js';
import { createHandoffStore } from './handoff/store.js';
import { createConsoleSmsAdapter } from './sms/console-adapter.js';
import { createWebhookSmsAdapter } from './sms/webhook-adapter.js';
import { createSmsRuntime } from './sms/session.js';
import { createJobStore } from './jobs/store.js';
import { createTelegramSender } from './jobs/telegram-send.js';
import { createAlertService } from './jobs/alerts.js';
import { openapi } from './openapi.js';
import { readSpeechUpload } from './speech/upload.js';

const MAX_BODY = 16 * 1024;
const WIDGET_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'widget');
const MIME = { '.js': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8' };
const WIDGET_ASSET_ALIASES = { 'inclusive-assistant.v1.js': 'savanna-assistant.v1.js' };
const ID = '([0-9a-f-]{36})';
const HANDOFF_RE = new RegExp(`^/v1/handoff/${ID}(?:/(messages|close|signal))?$`);
const AGENT_RE = new RegExp(`^/v1/agent/handoffs(?:/${ID}(?:/(messages|close|signal))?)?$`);
const PAGES = { '/demo': 'demo.html', '/agent': 'agent.html', '/sms-demo': 'sms-demo.html' };

export function buildProviders(cfg) {
  const registry = {
    ollama: () => createOllama({ baseUrl: cfg.ollamaBaseUrl, model: cfg.ollamaModel }),
    gemini: () => createGemini({ apiKey: cfg.geminiKey, model: cfg.geminiModel }),
    groq: () => createOpenAICompatible({ name: 'groq', apiKey: cfg.groqKey, model: cfg.groqModel }),
    offline: () => createOffline()
  };
  const list = cfg.providers.filter((n) => registry[n]).map((n) => registry[n]());
  if (!list.some((p) => p.name === 'offline')) list.push(createOffline()); // never run without a floor
  return list;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Request body is too large.'), { status: 413, code: 'body_too_large' }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req);
  try { return raw.trim() ? JSON.parse(raw) : {}; } catch {
    throw Object.assign(new Error('Body must be valid JSON.'), { status: 400, code: 'invalid_json' });
  }
}

function makeLimiter(max, windowMs = 60000) {
  const seen = new Map();
  return (ip) => {
    const t = Date.now();
    if (seen.size > 5000) for (const [k, v] of seen) if (v.reset < t) seen.delete(k);
    const e = seen.get(ip);
    if (!e || e.reset < t) { seen.set(ip, { count: 1, reset: t + windowMs }); return false; }
    e.count += 1;
    return e.count > max;
  };
}

const num = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : 0; };
const waitMs = (v) => Math.min(num(v), 25) * 1000;

export function createApp(cfg = loadConfig(), { providers, speech: speechOverride } = {}) {
  const passages = loadPassages(cfg.contentDir || DEFAULT_CONTENT_DIR);
  const retriever = new Retriever(passages);
  const router = createRouter({ providers: providers || buildProviders(cfg), timeoutMs: cfg.timeoutMs });
  const chat = createChat({ retriever, router, minCoverage: cfg.minCoverage });
  const speech = speechOverride || createAddisSpeech({ apiKey: cfg.addisApiKey, timeoutMs: 90000 });
  const store = createHandoffStore();
  const smsAdapter = cfg.smsProvider === 'webhook'
    ? createWebhookSmsAdapter({ url: cfg.smsWebhookUrl, key: cfg.smsWebhookKey })
    : createConsoleSmsAdapter();
  const jobStore = createJobStore();
  const telegramSender = createTelegramSender(cfg.telegramBotToken);
  const alerts = createAlertService({ jobStore, telegramSender, smsAdapter });
  const sms = cfg.smsInboundKey ? createSmsRuntime({ chat, store, jobStore, sendOutbound: (to, text) => smsAdapter.send({ to, text }) }) : null;
  const chatLimited = makeLimiter(cfg.rateLimitPerMin);
  const handoffLimited = makeLimiter(cfg.handoffRateLimitPerMin || 5);
  const pollLimited = makeLimiter(240);
  const agentLimited = makeLimiter(240);
  const jobsLimited = makeLimiter(20);
  const speechLimited = makeLimiter(5);
  const ttsLimited = makeLimiter(5);
  const trusted = (req) => Boolean(cfg.internalKey) && safeEqual(req.headers['x-internal-key'] || '', cfg.internalKey);
  const allowedOrigins = cfg.corsOrigin.split(',').map((s) => s.trim()).filter(Boolean);
  function corsFor(req) {
    if (allowedOrigins.includes('*')) return '*';
    const origin = req.headers.origin;
    return origin && allowedOrigins.includes(origin) ? origin : null;
  }

  const handler = async (req, res) => {
    const ip = req.socket.remoteAddress || 'unknown';
    const send = (status, body, extra = {}) => {
      const headers = {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-headers': 'content-type, authorization',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'cache-control': 'no-store',
        vary: 'Origin',
        'x-api-version': '1',
        ...extra
      };
      if (status === 204) headers['access-control-max-age'] = '600';
      const origin = corsFor(req);
      if (origin) headers['access-control-allow-origin'] = origin;
      res.writeHead(status, headers);
      if (status === 204) res.end();
      else res.end(JSON.stringify(body));
    };
    const fail = (status, code, message, extra) => send(status, { error: { code, message } }, extra);

    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      const GET = req.method === 'GET';
      const POST = req.method === 'POST';
      if (req.method === 'OPTIONS') return send(204);
      if (GET && path === '/health') return send(200, { ok: true, passages: passages.length, providers: providers ? 'custom' : cfg.providers, humanHelp: Boolean(cfg.agentKey) });
      if (GET && path === '/v1/openapi.json') return send(200, openapi);

      // Addis AI speech stays server-side; uploaded audio is processed in memory only.
      if (POST && path === '/v1/speech/transcribe') {
        if (!cfg.addisApiKey) return fail(503, 'speech_disabled', 'Speech recognition is not configured.');
        if (speechLimited(ip)) return fail(429, 'rate_limited', 'Too many voice requests. Please wait a minute.', { 'retry-after': '60' });
        const upload = await readSpeechUpload(req);
        if (!speech || typeof speech.transcribe !== 'function') return fail(503, 'speech_disabled', 'Speech recognition is not configured.');
        try { return send(200, await speech.transcribe(upload)); }
        finally { upload.audio.fill(0); }
      }
      if (POST && path === '/v1/speech/synthesize') {
        if (!cfg.addisApiKey) return fail(503, 'speech_disabled', 'Addis speech generation is not configured.');
        if (ttsLimited(ip)) return fail(429, 'rate_limited', 'Too many speech requests. Please wait a minute.', { 'retry-after': '60' });
        const b = await readJson(req);
        if (!['am', 'om', 'ti'].includes(b.language)) return fail(422, 'unsupported_speech_language', 'Addis voices are available here for Amharic, Afaan Oromo, and Tigrinya.');
        if (typeof b.text !== 'string' || !b.text.trim()) return fail(400, 'text_required', 'Text is required for speech generation.');
        if (b.text.length > 600) return fail(413, 'speech_text_too_long', 'Text is too long to read aloud in one request.');
        if (!speech || typeof speech.synthesize !== 'function') return fail(503, 'speech_disabled', 'Addis speech generation is not configured.');
        return send(200, await speech.synthesize({ text: b.text, language: b.language }));
      }

      // Widget files and pages. Names are a flat, safe pattern, so nothing outside widget/ is ever served.
      if (GET && (PAGES[path] || path.startsWith('/widget/'))) {
        const requestedName = PAGES[path] || path.slice('/widget/'.length);
        const name = WIDGET_ASSET_ALIASES[requestedName] || requestedName;
        if (!/^[A-Za-z0-9._-]+$/.test(name) || !MIME[extname(name)]) return fail(404, 'not_found', 'Not found.');
        let file;
        try { file = await readFile(join(WIDGET_DIR, name)); } catch { return fail(404, 'not_found', 'Not found.'); }
        const headers = { 'content-type': MIME[extname(name)], 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff' };
        if (name === 'agent.html' || name === 'sms-demo.html') {
          headers['cache-control'] = 'no-store';
          headers['x-frame-options'] = 'DENY';
          headers['content-security-policy'] = "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'";
        }
        const origin = corsFor(req);
        if (origin) headers['access-control-allow-origin'] = origin;
        res.writeHead(200, headers);
        return res.end(file);
      }

      if (POST && path === '/v1/chat') {
        if (!trusted(req) && chatLimited(ip)) return fail(429, 'rate_limited', 'Too many requests. Please wait a minute.', { 'retry-after': '60' });
        return send(200, await chat(await readJson(req)));
      }

      // ---- Learner side of human help ----
      if (POST && path === '/v1/handoff') {
        if (!trusted(req) && handoffLimited(ip)) return fail(429, 'rate_limited', 'Too many requests. Please wait a minute.', { 'retry-after': '60' });
        const b = await readJson(req);
        return send(201, store.create({ question: b.question, transcript: b.transcript, lang: b.lang }));
      }
      let m = path.match(HANDOFF_RE);
      if (m) {
        if (pollLimited(ip)) return fail(429, 'rate_limited', 'Too many requests. Please wait a minute.', { 'retry-after': '60' });
        const s = store.learner(m[1], bearer(req));
        if (!m[2] && GET) {
          const after = num(url.searchParams.get('after'));
          await store.wait(s, after, waitMs(url.searchParams.get('wait')));
          return send(200, store.viewForLearner(s, after));
        }
        if (m[2] === 'messages' && POST) {
          const msg = store.learnerSay(s, (await readJson(req)).text);
          return send(201, { id: msg.id });
        }
        if (m[2] === 'close' && POST) { store.close(s, 'learner'); return send(200, { status: 'closed' }); }
        if (m[2] === 'signal' && POST) {
          const msg = store.learnerSignal(s, (await readJson(req)).signal);
          return send(201, { id: msg.id });
        }
      }
      // ---- Low-bandwidth SMS/text route (same process, no extra infra) ----
      if (POST && path === '/v1/sms/inbound') {
        if (!sms) return fail(503, 'sms_disabled', 'The SMS route is off. Set SMS_INBOUND_KEY on the server.');
        if (!safeEqual(bearer(req), cfg.smsInboundKey)) return fail(401, 'unauthorized', 'The SMS inbound key is missing or wrong.', { 'www-authenticate': 'Bearer' });
        const b = await readJson(req);
        sms.handleInbound({ from: b.from, text: b.text }).catch((e) => console.error('SMS handleInbound error:', e));
        return send(200, { ok: true });
      }
      if (GET && path === '/v1/sms/outbox' && typeof smsAdapter.list === 'function') {
        if (!sms) return fail(503, 'sms_disabled', 'The SMS route is off. Set SMS_INBOUND_KEY on the server.');
        if (!safeEqual(bearer(req), cfg.smsInboundKey)) return fail(401, 'unauthorized', 'The SMS inbound key is missing or wrong.', { 'www-authenticate': 'Bearer' });
        return send(200, { messages: smsAdapter.list(num(url.searchParams.get('after'))) });
      }

            // ---- Career gateway: job alerts and interview accommodations ----
      if (POST && path === '/v1/jobs/subscribe') {
        if (jobsLimited(ip)) return fail(429, 'rate_limited', 'Too many requests. Please wait a minute.', { 'retry-after': '60' });
        const b = await readJson(req);
        if (b.channel !== 'telegram' && b.channel !== 'sms') return fail(400, 'channel_required', 'channel must be "telegram" or "sms".');
        if (!String(b.contact || '').trim()) return fail(400, 'contact_required', 'contact is required.');
        return send(201, jobStore.subscribe({ channel: b.channel, contact: String(b.contact).trim(), lang: b.lang }));
      }
      if (POST && path === '/v1/jobs/unsubscribe') {
        if (jobsLimited(ip)) return fail(429, 'rate_limited', 'Too many requests. Please wait a minute.', { 'retry-after': '60' });
        const b = await readJson(req);
        if (!String(b.contact || '').trim()) return fail(400, 'contact_required', 'contact is required.');
        return send(200, jobStore.unsubscribe({ channel: b.channel, contact: String(b.contact).trim() }));
      }
      if (POST && path === '/v1/accommodations') {
        if (handoffLimited(ip)) return fail(429, 'rate_limited', 'Too many requests. Please wait a minute.', { 'retry-after': '60' });
        const b = await readJson(req);
        if (!String(b.request || '').trim()) return fail(400, 'request_required', 'request is required.');
        return send(201, store.create({ question: b.request, transcript: [], lang: b.lang, kind: 'accommodation' }));
      }
      if (POST && path === '/v1/agent/jobs/broadcast') {
        if (agentLimited(ip)) return fail(429, 'rate_limited', 'Too many requests. Please wait a minute.', { 'retry-after': '60' });
        if (!cfg.agentKey) return fail(503, 'agent_disabled', 'The support console is off. Set AGENT_KEY on the server.');
        if (!safeEqual(bearer(req), cfg.agentKey)) return fail(401, 'unauthorized', 'The agent key is missing or wrong.', { 'www-authenticate': 'Bearer' });
        const b = await readJson(req);
        if (!String(b.text || '').trim()) return fail(400, 'text_required', 'text is required.');
        return send(200, await alerts.broadcast(String(b.text).trim()));
      }

      // ---- Support person side ----
      m = path.match(AGENT_RE);
      if (m) {
        if (agentLimited(ip)) return fail(429, 'rate_limited', 'Too many requests. Please wait a minute.', { 'retry-after': '60' });
        if (!cfg.agentKey) return fail(503, 'agent_disabled', 'The support console is off. Set AGENT_KEY on the server.');
        if (!safeEqual(bearer(req), cfg.agentKey)) return fail(401, 'unauthorized', 'The agent key is missing or wrong.', { 'www-authenticate': 'Bearer' });
        const [, id, sub] = m;
        if (!id && GET) return send(200, { handoffs: store.list() });
        if (id) {
          const s = store.get(id);
          if (!sub && GET) {
            const after = num(url.searchParams.get('after'));
            await store.wait(s, after, waitMs(url.searchParams.get('wait')));
            return send(200, store.viewForAgent(s, after));
          }
          if (sub === 'messages' && POST) {
            const msg = store.agentSay(s, (await readJson(req)).text);
            return send(201, { id: msg.id });
          }
          if (sub === 'close' && POST) { store.close(s, 'agent'); return send(200, { status: 'closed' }); }
          if (sub === 'signal' && POST) {
            const msg = store.agentSignal(s, (await readJson(req)).signal);
            return send(201, { id: msg.id });
          }
        }
      }
      return fail(404, 'not_found', 'Not found.');
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) {
        console.error(e);
        return fail(500, 'internal_error', 'Something went wrong. Please try again.');
      }
      return fail(status, e.code || 'bad_request', e.message);
    }
  };
  return { server: createServer(handler), retriever, router, chat, store };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { process.loadEnvFile('.env'); } catch { /* .env is optional */ }
  const cfg = loadConfig();
  if (cfg.agentKey && cfg.agentKey.length < 16) console.warn('AGENT_KEY is short. Use at least 16 random characters.');
  const { server } = createApp(cfg);
  server.listen(cfg.port, () => {
    console.log(`INCLUSIVE API on http://localhost:${cfg.port} (providers: ${cfg.providers.join(', ')})`);
    console.log(`Demo: http://localhost:${cfg.port}/demo   Support console: ${cfg.agentKey ? `http://localhost:${cfg.port}/agent` : 'OFF (set AGENT_KEY)'}`);
  });
}