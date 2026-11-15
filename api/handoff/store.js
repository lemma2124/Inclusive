import { randomBytes, randomUUID } from 'node:crypto';
import { safeEqual } from '../lib/auth.js';

const clip = (v, n) => String(v ?? '').trim().slice(0, n);

function fail(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function clipSignal(payload) {
  const raw = JSON.stringify(payload === undefined ? null : payload);
  if (!raw || raw === 'null') throw fail(400, 'signal_required', 'Signal payload is required.');
  if (raw.length > 8000) throw fail(413, 'signal_too_large', 'Signal payload is too large.');
  return JSON.parse(raw);
}

// In-memory human-help sessions. Privacy by design:
//  - no name, phone or email is collected
//  - when a chat is closed, the shared transcript and question are erased
//  - closed chats are deleted after 1 hour, abandoned ones after 24 hours
// It resets when the server restarts, which is fine for a demo and is stated in the README.
export function createHandoffStore({
  ttlMs = 24 * 60 * 60 * 1000,
  closedTtlMs = 60 * 60 * 1000,
  maxSessions = 500,
  maxMessages = 300, // raised from 200: ICE candidates add several messages per side
  now = Date.now
} = {}) {
  const sessions = new Map();
  const waiters = new Map();

  function notify(id) {
    const set = waiters.get(id);
    if (!set) return;
    for (const f of [...set]) f();
    waiters.delete(id);
  }

  function sweep() {
    const t = now();
    for (const [id, s] of sessions) {
      const limit = s.status === 'closed' ? closedTtlMs : ttlMs;
      if (t - s.updatedAt > limit) {
        sessions.delete(id);
        notify(id);
      }
    }
  }

  function push(s, from, text, code = '', data = null) {
    s.messages.push({ id: s.nextId++, from, text, code, data, at: now() });
    s.updatedAt = now();
    notify(s.id);
    return s.messages[s.messages.length - 1];
  }

  function say(s, from, raw) {
    if (s.status === 'closed') throw fail(409, 'closed', 'This chat has ended.');
    const text = clip(raw, 1000);
    if (!text) throw fail(400, 'text_required', 'Message text is required.');
    if (s.messages.length >= maxMessages) throw fail(429, 'too_many_messages', 'This chat is too long. Please start a new one.');
    return push(s, from, text);
  }

  // Signaling (WebRTC offer/answer/ICE) only once a person has joined: a
  // learner should never be prompted to share with no one on the other end.
  function signal(s, from, raw) {
    if (s.status === 'closed') throw fail(409, 'closed', 'This chat has ended.');
    if (s.status !== 'active') throw fail(409, 'not_active', 'Screen sharing needs a person to be connected first.');
    if (s.messages.length >= maxMessages) throw fail(429, 'too_many_messages', 'This chat is too long. Please start a new one.');
    const payload = clipSignal(raw);
    return push(s, from, '', 'webrtc', payload);
  }

  function cleanTranscript(list) {
    if (!Array.isArray(list)) return [];
    return list
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-10)
      .map((m) => ({ role: m.role, content: clip(m.content, 600) }));
  }

  function viewMessages(s, after) {
    return s.messages.filter((m) => m.id > after).map((m) => ({ id: m.id, from: m.from, text: m.text, code: m.code, data: m.data, at: m.at }));
  }

  return {
    create({ question, transcript, lang, kind } = {}) {
      sweep();
      if (sessions.size >= maxSessions) throw fail(503, 'busy', 'Help is very busy right now. Please try again later.');
      const t = now();
      const id = randomUUID();
      const token = randomBytes(24).toString('hex');
      sessions.set(id, {
        id, token, lang: ['am', 'om', 'ti'].includes(lang) ? lang : 'en', question: clip(question, 1000),
        kind: kind === 'accommodation' ? 'accommodation' : 'support',
        transcript: cleanTranscript(transcript), status: 'waiting', messages: [], nextId: 1, createdAt: t, updatedAt: t
      });
      return { id, token, status: 'waiting' };
    },

    // Same "not found" for a wrong id and a wrong token, so ids cannot be probed.
    learner(id, token) {
      sweep();
      const s = sessions.get(id);
      if (!s || !safeEqual(token, s.token)) throw fail(404, 'not_found', 'Not found.');
      return s;
    },

    get(id) {
      sweep();
      const s = sessions.get(id);
      if (!s) throw fail(404, 'not_found', 'Not found.');
      return s;
    },

    list() {
      sweep();
      return [...sessions.values()]
        .filter((s) => s.status !== 'closed')
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((s) => ({ id: s.id, status: s.status, lang: s.lang, question: s.question, kind: s.kind, createdAt: s.createdAt, updatedAt: s.updatedAt, messageCount: s.messages.length }));
    },

    learnerSay: (s, text) => say(s, 'learner', text),

    agentSay(s, raw) {
      if (s.status === 'closed') throw fail(409, 'closed', 'This chat has ended.');
      if (!clip(raw, 1000)) throw fail(400, 'text_required', 'Message text is required.');
      if (s.status === 'waiting') {
        s.status = 'active';
        push(s, 'system', '', 'agent_joined');
      }
      return say(s, 'agent', raw);
    },

    learnerSignal: (s, payload) => signal(s, 'learner', payload),
    agentSignal: (s, payload) => signal(s, 'agent', payload),

    close(s, by) {
      if (s.status === 'closed') return;
      s.status = 'closed';
      s.transcript = [];
      s.question = '';
      push(s, 'system', '', by === 'agent' ? 'closed_by_agent' : 'closed_by_learner');
    },

    // Long polling: resolves as soon as there is something new, or after ms.
    wait(s, after, ms) {
      const pending = () => s.status === 'closed' || s.messages.some((m) => m.id > after);
      if (ms <= 0 || pending()) return Promise.resolve();
      return new Promise((resolve) => {
        let set = waiters.get(s.id);
        if (!set) { set = new Set(); waiters.set(s.id, set); }
        const done = () => { clearTimeout(timer); set.delete(done); resolve(); };
        const timer = setTimeout(done, ms);
        set.add(done);
      });
    },

    viewForLearner: (s, after) => ({ status: s.status, messages: viewMessages(s, after) }),

    viewForAgent: (s, after) => ({
      id: s.id, status: s.status, lang: s.lang, question: s.question, kind: s.kind, transcript: s.transcript,
      messages: viewMessages(s, after)
    })
  };
}