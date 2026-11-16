import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from 'redis';
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
import { createTelerivetSmsAdapter } from './sms/telerivet-adapter.js';
import { createTelerivetSmsQueue } from './sms/telerivet-queue.js';
import { createSmsRuntime } from './sms/session.js';
import { createJobStore } from './jobs/store.js';
import { createTelegramSender } from './jobs/telegram-send.js';
import { createAlertService } from './jobs/alerts.js';
import { openapi } from './openapi.js';
import { readSpeechUpload } from './speech/upload.js';
import { processTelegramWebhook, registerWebhook } from '../telegram/bot.js';

const MAX_BODY = 16 * 1024;
const WIDGET_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'widget');
const MIME = { '.js': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8' };
const WIDGET_ASSET_ALIASES = { 'inclusive-assistant.v1.js': 'savanna-assistant.v1.js' };
const ID = '([0-9a-f-]{36})';
const HANDOFF_RE = new RegExp(`^/v1/handoff/${ID}(?:/(messages|close|signal))?$`);
const AGENT_RE = new RegExp(`^/v1/agent/handoffs(?:/${ID}(?:/(messages|close|signal))?)?$`);
const PAGES = { '/demo': 'demo.html', '/agent': 'agent.html', '/sms-demo': 'sms-demo.html' };

export function buildProviders(cfg) {
  const isLoopbackOllama = cfg.nodeEnv === 'production' && ['localhost', '127.0.0.1', '::1'].includes(new URL(cfg.ollamaBaseUrl || 'http://127.0.0.1:11434/v1').hostname);
  const registry = {
    ollama: () => isLoopbackOllama ? null : createOllama({ baseUrl: cfg.ollamaBaseUrl, model: cfg.ollamaModel }),
    gemini: () => cfg.geminiKey ? createGemini({ apiKey: cfg.geminiKey, model: cfg.geminiModel }) : null,
    groq: () => cfg.groqKey ? createOpenAICompatible({ name: 'groq', apiKey: cfg.groqKey, model: cfg.groqModel }) : null,
    offline: () => createOffline()
  };
  const list = cfg.providers.filter((n) => registry[n]).map((n) => registry[n]()).filter(Boolean);
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

async function readForm(req) {
  const contentType = String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/x-www-form-urlencoded') {
    throw Object.assign(new Error('Body must use application/x-www-form-urlencoded.'), { status: 415, code: 'unsupported_media_type' });
  }
  return new URLSearchParams(await readBody(req));
}

function withTimeout(promise, timeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('SMS queue request timed out.'), { code: 'sms_queue_timeout' })), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
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

export function createApp(cfg = loadConfig(), {
  providers,
  speech: speechOverride,
  redisClient,
  telerivetQueue: telerivetQueueOverride,
  telerivetFetchImpl
} = {}) {
  const passages = loadPassages(cfg.contentDir || DEFAULT_CONTENT_DIR);
  const retriever = new Retriever(passages);
  const activeProviders = providers || buildProviders(cfg);
  const router = createRouter({ providers: activeProviders, timeoutMs: cfg.timeoutMs });
  const chat = createChat({ retriever, router, minCoverage: cfg.minCoverage });
  const speech = speechOverride || createAddisSpeech({ apiKey: cfg.addisApiKey, timeoutMs: 90000 });
  const store = createHandoffStore();
  const smsAdapter = cfg.smsProvider === 'telerivet'
    ? createTelerivetSmsAdapter({
      apiKey: cfg.telerivetApiKey,
      projectId: cfg.telerivetProjectId,
      routeId: cfg.telerivetRouteId,
      fetchImpl: telerivetFetchImpl
    })
    : cfg.smsProvider === 'webhook'
      ? createWebhookSmsAdapter({ url: cfg.smsWebhookUrl, key: cfg.smsWebhookKey })
      : createConsoleSmsAdapter();
  const jobStore = createJobStore();
  const telegramSender = createTelegramSender(cfg.telegramBotToken);
  const alerts = createAlertService({ jobStore, telegramSender, smsAdapter });
  const sms = cfg.smsInboundKey || cfg.smsProvider === 'telerivet'
    ? createSmsRuntime({ chat, store, jobStore, sendOutbound: (to, text, smsMeta) => smsAdapter.send({ to, text, ...smsMeta }) })
    : null;
  const telerivetQueue = telerivetQueueOverride || (
    cfg.smsProvider === 'telerivet' && redisClient
      ? createTelerivetSmsQueue({ client: redisClient, runtime: sms })
      : null
  );
  const chatLimited = makeLimiter(cfg.rateLimitPerMin);
  const handoffLimited = makeLimiter(cfg.handoffRateLimitPerMin || 5);
  const pollLimited = makeLimiter(240);
  const agentLimited = makeLimiter(240);
  const jobsLimited = makeLimiter(20);
  const smsLimited = makeLimiter(60);
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
      if (GET && path === '/health') return send(200, { ok: true, passages: passages.length, providers: activeProviders.map((provider) => provider.name), humanHelp: Boolean(cfg.agentKey) });
      if (GET && path === '/v1/openapi.json') return send(200, openapi);
      const telegramWebhookMatch = (POST && path === (cfg.telegramWebhookPath || '/telegram/webhook')) || (cfg.telegramWebhookUrl && POST && path === new URL(cfg.telegramWebhookPath || '/telegram/webhook', cfg.telegramWebhookUrl).pathname);
      if (telegramWebhookMatch) {
        if (!cfg.telegramWebhookSecret) return fail(503, 'telegram_webhook_unconfigured', 'Telegram webhook authentication is not configured.');
        const receivedSecret = req.headers['x-telegram-bot-api-secret-token'] || '';
        if (!safeEqual(receivedSecret, cfg.telegramWebhookSecret)) return fail(401, 'unauthorized', 'Telegram webhook authentication failed.');
        try {
          const body = await readJson(req);
          const result = await processTelegramWebhook(body, {
            secret: cfg.telegramWebhookSecret,
            receivedSecret,
            speech
          });
          if (!result.ok) {
            if (result.reason === 'secret_not_configured') return fail(503, 'telegram_webhook_unconfigured', 'Telegram webhook authentication is not configured.');
            if (result.reason === 'unauthorized') return fail(401, 'unauthorized', 'Telegram webhook authentication failed.');
            return fail(400, result.reason || 'telegram_webhook_error', 'Telegram webhook rejected the update.');
          }
          return send(200, { ok: true });
        } catch (e) {
          console.error('Telegram webhook request failed.');
          return fail(400, 'telegram_webhook_error', 'Telegram webhook request failed.');
        }
      }

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

      if (POST && path === '/v1/sms/telerivet') {
        if (cfg.smsProvider !== 'telerivet') return fail(503, 'sms_disabled', 'Telerivet SMS is not configured.');
        if (typeof cfg.telerivetWebhookSecret !== 'string' || cfg.telerivetWebhookSecret.replace(/\s/g, '').length < 16) {
          return fail(503, 'telerivet_webhook_unconfigured', 'Telerivet webhook authentication requires a secret with at least 16 characters.');
        }
        if (!telerivetQueue) return fail(503, 'sms_queue_unavailable', 'The Telerivet SMS queue is not available.');

        const fields = await readForm(req);
        if (!safeEqual(fields.get('secret') || '', cfg.telerivetWebhookSecret)) {
          return fail(403, 'unauthorized', 'Telerivet webhook authentication failed.');
        }
        if (fields.get('event') !== 'incoming_message' || fields.get('message_type') !== 'sms') {
          return send(200, { ok: true, ignored: true });
        }
        const messageId = fields.get('id') || '';
        const from = fields.get('from_number_e164') || fields.get('from_number') || '';
        const text = fields.get('content') || '';
        if (!messageId || messageId.length > 34 || !from || !text) {
          return fail(400, 'invalid_telerivet_message', 'Telerivet message ID, sender, and content are required.');
        }

        let queued;
        try {
          queued = await withTimeout(telerivetQueue.enqueue({ messageId, from, text }), 5000);
        } catch (error) {
          console.error('Telerivet SMS webhook could not queue a message:', error && error.message ? error.message : 'unknown error');
          return fail(503, 'sms_queue_unavailable', 'The message could not be queued. Telerivet may retry it.');
        }
        return send(200, { ok: true, duplicate: Boolean(queued.duplicate) });
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
        if (typeof cfg.smsInboundKey !== 'string' || !cfg.smsInboundKey.trim()) {
          return fail(503, 'sms_inbound_unconfigured', 'The SMS inbound route requires SMS_INBOUND_KEY.');
        }
        if (!safeEqual(bearer(req), cfg.smsInboundKey)) return fail(401, 'unauthorized', 'The SMS inbound key is missing or wrong.', { 'www-authenticate': 'Bearer' });
        if (smsLimited(ip)) return fail(429, 'rate_limited', 'Too many inbound SMS requests. Please retry later.', { 'retry-after': '60' });
        const b = await readJson(req);
        if (typeof b.from !== 'string' || typeof b.text !== 'string') return fail(400, 'invalid_sms', 'from and text must be strings.');
        if (b.text.length > 1000) return fail(413, 'sms_too_long', 'SMS text must be 1000 characters or fewer.');
        const result = await sms.handleInbound({ from: b.from, text: b.text, messageId: b.messageId, sourceIp: ip });
        if (result && result.accepted === false) {
          const codes = { invalid_sender: 'invalid_sender', empty_message: 'invalid_sms', message_too_long: 'sms_too_long', rate_limited: 'rate_limited' };
          if (result.reason && codes[result.reason]) {
            return fail(result.reason === 'rate_limited' ? 429 : 400, codes[result.reason], 'The SMS request was not accepted.');
          }
          return fail(502, 'sms_delivery_failed', 'The message was received, but a reply could not be delivered.');
        }
        return send(200, { ok: true, duplicate: Boolean(result && result.duplicate) });
      }
      if (GET && path === '/v1/sms/outbox' && typeof smsAdapter.list === 'function') {
        if (!sms) return fail(503, 'sms_disabled', 'The SMS route is off. Set SMS_INBOUND_KEY on the server.');
        if (typeof cfg.smsInboundKey !== 'string' || !cfg.smsInboundKey.trim()) {
          return fail(503, 'sms_inbound_unconfigured', 'The SMS inbound route requires SMS_INBOUND_KEY.');
        }
        if (!safeEqual(bearer(req), cfg.smsInboundKey)) return fail(401, 'unauthorized', 'The SMS inbound key is missing or wrong.', { 'www-authenticate': 'Bearer' });
        return send(200, { messages: smsAdapter.list(num(url.searchParams.get('after'))) });
      }

      if ((GET && path === '/v1/agent/sms/failed') || (POST && path === '/v1/agent/sms/failed/retry')) {
        if (!cfg.agentKey) return fail(503, 'agent_disabled', 'The support console is off. Set AGENT_KEY on the server.');
        if (!safeEqual(bearer(req), cfg.agentKey)) return fail(401, 'unauthorized', 'The agent key is missing or wrong.', { 'www-authenticate': 'Bearer' });
        if (!telerivetQueue) return fail(503, 'sms_queue_unavailable', 'The Telerivet SMS queue is not available.');
        if (agentLimited(ip)) return fail(429, 'rate_limited', 'Too many requests. Please wait a minute.', { 'retry-after': '60' });

        if (GET) {
          const limit = num(url.searchParams.get('limit')) || 50;
          return send(200, { messages: await telerivetQueue.listFailed(limit) });
        }

        const body = await readJson(req);
        if (typeof body.messageId !== 'string' || !body.messageId.trim() || body.messageId.length > 128) {
          return fail(400, 'message_id_required', 'A valid Telerivet messageId is required.');
        }
        const result = await telerivetQueue.retryFailed(body.messageId);
        if (!result.retried) return fail(404, 'sms_dead_letter_not_found', 'No failed SMS job was found for that messageId.');
        return send(202, { ok: true, status: 'queued' });
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
  return { server: createServer(handler), retriever, router, chat, store, providers: activeProviders, smsQueue: telerivetQueue };
}

async function startServer() {
  try { process.loadEnvFile('.env'); } catch { /* .env is optional */ }
  const cfg = loadConfig();
  if (!['console', 'webhook', 'telerivet'].includes(cfg.smsProvider)) {
    throw new Error('SMS_PROVIDER must be console, webhook, or telerivet.');
  }
  if (!cfg.geminiKey) console.warn('Gemini is disabled: GEMINI_API_KEY is not set.');
  else if (!cfg.providers.includes('gemini')) console.warn('Gemini key is configured but gemini is not in AI_PROVIDERS.');
  if (!cfg.groqKey) console.warn('Groq is disabled: GROQ_API_KEY is not set.');
  else if (!cfg.providers.includes('groq')) console.warn('Groq key is configured but groq is not in AI_PROVIDERS.');
  if (!cfg.addisApiKey) console.warn('Speech recognition and synthesis are disabled: ADDIS_API_KEY is not set.');
  if (cfg.telegramBotToken && cfg.telegramWebhookUrl && !cfg.telegramWebhookSecret) console.warn('Telegram webhook is not configured securely: TELEGRAM_WEBHOOK_SECRET is not set.');
  const unknownProviders = cfg.providers.filter((name) => !['gemini', 'groq', 'ollama', 'offline'].includes(name));
  if (unknownProviders.length) console.warn(`Unknown AI_PROVIDERS entries will be ignored: ${unknownProviders.join(', ')}.`);
  if (cfg.providers.includes('ollama') && cfg.nodeEnv === 'production' && ['localhost', '127.0.0.1', '::1'].includes(new URL(cfg.ollamaBaseUrl).hostname)) {
    console.warn('Ollama is configured at a loopback URL and will be skipped in production. Set OLLAMA_BASE_URL to a reachable service or remove ollama from AI_PROVIDERS.');
  }
  if (cfg.agentKey && cfg.agentKey.length < 16) console.warn('AGENT_KEY is short. Use at least 16 random characters.');
  let redisClient;
  if (cfg.smsProvider === 'telerivet') {
    const required = [
      ['TELERIVET_API_KEY', cfg.telerivetApiKey],
      ['TELERIVET_PROJECT_ID', cfg.telerivetProjectId],
      ['TELERIVET_WEBHOOK_SECRET', cfg.telerivetWebhookSecret],
      ['REDIS_URL', cfg.redisUrl]
    ];
    const missing = required.filter(([, value]) => !value).map(([name]) => name);
    if (missing.length) throw new Error(`Telerivet SMS configuration is incomplete: ${missing.join(', ')}.`);
    if (cfg.telerivetWebhookSecret.replace(/\s/g, '').length < 16) {
      throw new Error('TELERIVET_WEBHOOK_SECRET must contain at least 16 non-whitespace characters.');
    }
    redisClient = createClient({ url: cfg.redisUrl });
    redisClient.on('error', (error) => console.error('Redis SMS connection error:', error.message));
    await redisClient.connect();
  }

  const app = createApp(cfg, { redisClient });
  try {
    if (app.smsQueue) await app.smsQueue.start();
  } catch (error) {
    if (redisClient && redisClient.isOpen) await redisClient.quit();
    throw error;
  }
  const { server, providers } = app;
  server.listen(cfg.port, async () => {
    console.log(`INCLUSIVE API on http://localhost:${cfg.port} (providers: ${providers.map((provider) => provider.name).join(', ')})`);
    console.log(`Demo: http://localhost:${cfg.port}/demo   Support console: ${cfg.agentKey ? `http://localhost:${cfg.port}/agent` : 'OFF (set AGENT_KEY)'}`);
    if (!cfg.telegramBotToken) {
      console.warn('Telegram bot is disabled: TELEGRAM_BOT_TOKEN is not set.');
      return;
    }
    if (!cfg.telegramWebhookUrl) {
      console.warn('Telegram bot is running without a webhook URL. Set TELEGRAM_WEBHOOK_URL to register the webhook.');
      return;
    }
    const result = await registerWebhook({ baseUrl: cfg.telegramWebhookUrl, path: cfg.telegramWebhookPath || '/telegram/webhook', secret: cfg.telegramWebhookSecret });
    if (result.ok) console.log(`Telegram webhook registered: ${result.url}`);
    else console.warn('Telegram webhook registration failed. Check TELEGRAM_WEBHOOK_URL, TELEGRAM_WEBHOOK_PATH, TELEGRAM_WEBHOOK_SECRET, and TELEGRAM_BOT_TOKEN.');
  });
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await new Promise((resolve) => server.close(resolve));
    if (app.smsQueue) await app.smsQueue.stop();
    if (redisClient && redisClient.isOpen) await redisClient.quit();
  };
  process.once('SIGINT', () => { void shutdown().catch((error) => console.error('API shutdown failed:', error.message)); });
  process.once('SIGTERM', () => { void shutdown().catch((error) => console.error('API shutdown failed:', error.message)); });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer().catch((error) => {
    console.error('API startup failed:', error.message);
    process.exitCode = 1;
  });
}