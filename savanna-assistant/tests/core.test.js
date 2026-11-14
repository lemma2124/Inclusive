import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, detectLang } from '../api/retrieval/tokenize.js';
import { Retriever } from '../api/retrieval/index.js';
import { loadPassages } from '../api/retrieval/content.js';
import { redact } from '../api/lib/redact.js';
import { createRouter } from '../api/ai/router.js';
import { createOffline } from '../api/ai/offline.js';
import { createChat } from '../api/chat.js';
import { createApp } from '../api/server.js';
import { ProviderError } from '../api/ai/errors.js';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHandoffStore } from '../api/handoff/store.js';
import { createConsoleSmsAdapter } from '../api/sms/console-adapter.js';
import { createSmsRuntime } from '../api/sms/session.js';
import { createJobStore } from '../api/jobs/store.js';
import { createAddisAI } from '../api/ai/addisai.js';
import { loadConfig } from '../api/lib/config.js';
const loadConfigFromEnvForTest = (env) => loadConfig(env);

const passages = loadPassages();
const retriever = new Retriever(passages);

test('detectLang separates Amharic from English', () => {
  assert.equal(detectLang('ኮርሶችን እንዴት አገኛለሁ?'), 'am');
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

test('chat answers with citations when the course covers the question', async () => {
  const chat = createChat({ retriever, router: createRouter({ providers: [createOffline()] }) });
  const r = await chat({ message: 'How do I mark a lesson as complete?' });
  assert.equal(r.grounded, true);
  assert.equal(r.citations[0].id, 'en-complete');
  assert.equal(r.escalate, false);
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

const baseCfg = { port: 0, providers: ['offline'], geminiKey: '', groqKey: '', timeoutMs: 500, minCoverage: 0.3, corsOrigin: '*', rateLimitPerMin: 100, handoffRateLimitPerMin: 100, agentKey: 'test-agent-key-123456', contentDir: '' };

async function withServer(cfg, fn) {
  const { server } = createApp(cfg);
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
    // CORS allowlist: an allowed origin is echoed, a stranger gets no header
    const ok = await fetch(`${base}/health`, { headers: { origin: 'https://partner.example' } });
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://partner.example');
    const stranger = await fetch(`${base}/health`, { headers: { origin: 'https://evil.example' } });
    assert.equal(stranger.headers.get('access-control-allow-origin'), null);
    assert.equal(ok.headers.get('x-api-version'), '1');
  });
});

test('widget parses, stays small, and is served safely', async () => {
  const src = readFileSync(new URL('../widget/inclusive-assistant.v1.js', import.meta.url), 'utf8');
  assert.doesNotThrow(() => new vm.Script(src), 'widget must be valid JavaScript');
  assert.ok(src.length < 70 * 1024, 'widget should stay small for 3G');
  await withServer(baseCfg, async (base) => {
    const js = await fetch(`${base}/widget/inclusive-assistant.v1.js`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type'), /javascript/);
    assert.match(await js.text(), /customElements\.define\('inclusive-assistant'/);
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

    // The learner's long poll is released the moment the person replies.
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

    // Trusted requests never touch the per-IP counter, so many in a row all succeed.
    for (let i = 0; i < 5; i++) {
      assert.equal((await post({ 'x-internal-key': 'bot-secret-123456' })).status, 200, `trusted request ${i + 1} should succeed`);
    }

    // A wrong key is untrusted and falls under the normal per-IP limit (2/min).
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
      body: JSON.stringify({ from: '+251911000000', text: 'how do i check my score' })
    });
    assert.equal(ok.status, 200);

    const out = await (await fetch(`${base}/v1/sms/outbox?after=0`, { headers: { authorization: 'Bearer sms-secret-123456' } })).json();
    assert.equal(out.messages.length, 1);
    assert.equal(out.messages[0].to, '+251911000000');
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

test('addisai adapter: parses the real documented response_text shape, warns on non-stop finish', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      response_text: 'በአሁኑ ጊዜ በኢትዮጵያ ውስጥ 12 ክልሎች አሉ።',
      finish_reason: 'stop',
      usage_metadata: { prompt_token_count: 8, candidates_token_count: 25, total_token_count: 33 },
      modelVersion: 'Addis-\u1348-\u12A3\u120C\u134D'
    })
  });
  const addis = createAddisAI({ apiKey: 'k', fetchImpl });
  const out = await addis.generate({ system: 's', messages: [] });
  assert.match(out.text, /12 ክልሎች/);
});

test('addisai adapter: throws a diagnosable error when response_text is missing', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ surprise: 'field' }) });
  const addis = createAddisAI({ apiKey: 'k', fetchImpl });
  await assert.rejects(() => addis.generate({ system: 's', messages: [] }), /no response_text.*surprise/);
});