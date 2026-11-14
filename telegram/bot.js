/*! Savanna Telegram bot — zero dependencies, long polling.
    Reuses the same /v1/chat and /v1/handoff endpoints as the web widget,
    so grounding, citations, and human handoff behave identically here. */

import { detectLang } from '../api/retrieval/tokenize.js';

try { process.loadEnvFile('.env'); } catch { /* .env is optional */ }

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API_URL = (process.env.API_URL || 'http://localhost:8787').replace(/\/+$/, '');
const INTERNAL_KEY = process.env.INTERNAL_KEY || '';
const TG = `https://api.telegram.org/bot${TOKEN}`;

if (!TOKEN) {
    console.error('TELEGRAM_BOT_TOKEN is not set. Copy .env.example to .env, add your token, then run: npm run bot');
    process.exit(1);
}

const STRINGS = {
    en: {
        welcome: 'Hello! Ask me anything about your course, in English or Amharic. Send /am for Amharic, /en for English, /human to ask for a person, /jobs for job alerts, /accommodation for interview accommodations.',
        consent: 'A person can help you. If you continue, they will see your questions and answers from this chat. Please do not share passwords or ID numbers.',
        yes: 'Yes, connect me', no: 'No, thanks',
        cancelled: 'OK. You can keep asking me questions.',
        connecting: 'Connecting you to a person…',
        waiting: 'Your request was sent. Please wait for a person to join. What you send now goes to that person. Send /end to stop.',
        joined: 'A person has joined the chat.',
        closedAgent: 'The person ended the chat. You can keep asking me questions.',
        endedYou: 'You ended the chat with the person. You can keep asking me questions.',
        lost: 'The connection to the person was lost. Please try /human again.',
        already: 'You are already connected to a person. Send /end to stop.',
        noActive: 'You are not connected to a person right now.',
        sendFail: 'Your message was not sent. Please try again.',
        busy: 'Support is very busy right now. Please try again later.',
        sentFail: 'I could not connect you to a person right now. Please try again later.',
        sources: 'Sources:',
        talk: 'Talk to a person',
        error: 'Sorry, I could not get an answer right now. Please try again.',
        rateLimited: 'Too many questions at once. Please wait a minute and try again.',
        voiceUnsupported: 'I cannot listen to voice messages here yet. Please type your question.',
        jobsSubscribed: 'You are now subscribed to job alerts here. Send /unsubscribe to stop.',
        jobsUnsubscribed: 'You will no longer receive job alerts.',
        accommodationPrompt: 'Please describe what you need for your interview (for example: more time, a sign language interpreter, or a quiet room). You do not need to state a medical condition. Send /cancel to stop.',
        accommodationCancelled: 'OK, no request was sent.',
        accommodationWaiting: 'Your request was sent to a person. They may reply here. Send /end to stop.'
    },
    am: {
        welcome: 'ሰላም! ስለ ኮርስዎ በአማርኛ ወይም በእንግሊዝኛ ይጠይቁኝ። ለአማርኛ /am፣ ለእንግሊዝኛ /en፣ ሰው ለማግኘት /human፣ ለስራ ማስታወቂያ /jobs፣ ለቃለ መጠይቅ ድጋፍ /accommodation ይላኩ።',
        consent: 'አንድ ሰው ሊረዳዎት ይችላል። ከቀጠሉ፣ በዚህ ውይይት ውስጥ ያሉትን ጥያቄዎችዎን እና መልሶቹን ያያሉ። እባክዎ የይለፍ ቃል ወይም የመታወቂያ ቁጥር አያጋሩ።',
        yes: 'አዎ፣ አገናኙኝ', no: 'አይ፣ አመሰግናለሁ',
        cancelled: 'እሺ። መጠየቅ መቀጠል ይችላሉ።',
        connecting: 'ከሰው ጋር እያገናኘሁ ነው…',
        waiting: 'ጥያቄዎ ተልኳል። አንድ ሰው እስኪመጣ እባክዎ ይጠብቁ። አሁን የሚልኩት ለዚያ ሰው ይደርሰዋል። ለማቆም /end ይላኩ።',
        joined: 'አንድ ሰው ውይይቱን ተቀላቅሏል።',
        closedAgent: 'ሰውየው ውይይቱን ዘግቷል። መጠየቅ መቀጠል ይችላሉ።',
        endedYou: 'ከሰው ጋር የነበረውን ውይይት አብቅተዋል። መጠየቅ መቀጠል ይችላሉ።',
        lost: 'ከሰው ጋር ያለው ግንኙነት ተቋርጧል። እባክዎ /human በድጋሚ ይሞክሩ።',
        already: 'አስቀድመው ከሰው ጋር ተገናኝተዋል። ለማቆም /end ይላኩ።',
        noActive: 'አሁን ከሰው ጋር አልተገናኙም።',
        sendFail: 'መልዕክቱ አልተላከም። እባክዎ እንደገና ይሞክሩ።',
        busy: 'አሁን የድጋፍ አገልግሎቱ ተጨናንቋል። እባክዎ ቆይተው ይሞክሩ።',
        sentFail: 'አሁን ከሰው ጋር ማገናኘት አልተቻለም። እባክዎ ቆይተው ይሞክሩ።',
        sources: 'ምንጮች፦',
        talk: 'ሰው ያነጋግሩ',
        error: 'ይቅርታ፣ አሁን መልስ ማግኘት አልተቻለም። እባክዎ እንደገና ይሞክሩ።',
        rateLimited: 'በአንድ ጊዜ ብዙ ጥያቄዎች ተጠይቀዋል። እባክዎ ትንሽ ቆይተው ይሞክሩ።',
        voiceUnsupported: 'እዚህ የድምፅ መልዕክት ገና መስማት አልችልም። እባክዎ ጥያቄዎን ይጻፉ።',
        jobsSubscribed: 'በዚህ ለስራ ማስታወቂያዎች ተመዝግበዋል። ለማቆም /unsubscribe ይላኩ።',
        jobsUnsubscribed: 'ከዚህ በኋላ የስራ ማስታወቂያ አይደርስዎትም።',
        accommodationPrompt: 'ለቃለ መጠይቅ ምን እንደሚያስፈልግዎ ይግለጹ (ለምሳሌ፦ ተጨማሪ ጊዜ፣ የምልክት ቋንቋ አስተርጓሚ፣ ወይም ጸጥ ያለ ክፍል)። የህክምና ሁኔታ መግለጽ አያስፈልግም። ለመሰረዝ /cancel ይላኩ።',
        accommodationCancelled: 'እሺ፣ ምንም ጥያቄ አልተላከም።',
        accommodationWaiting: 'ጥያቄዎ ለሰው ተልኳል። እዚህ ሊመልስልዎት ይችላል። ለማቆም /end ይላኩ።'
    }
};

const t = (s, key) => STRINGS[s.lang || 'en'][key];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- per-chat state (in memory; resets if the bot restarts) ----
const sessions = new Map();
function session(chatId) {
    let s = sessions.get(chatId);
    if (!s) { s = { lang: null, history: [], handoff: null, pendingAccommodation: false, pendingQuestion: '' }; sessions.set(chatId, s); }
    return s;
}

// ---- Telegram Bot API ----
async function tg(method, params) {
    try {
        const res = await fetch(`${TG}/${method}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(params || {})
        });
        const data = await res.json().catch(() => null);
        if (!data || !data.ok) { console.error(`Telegram ${method} failed:`, data && data.description); return null; }
        return data.result;
    } catch (e) {
        console.error(`Telegram ${method} network error:`, e.message);
        return null;
    }
}
const send = (chatId, text, extra) => tg('sendMessage', { chat_id: chatId, text, ...extra });

// ---- our own API (same one the web widget calls) ----
async function api(method, path, body, token) {
    const headers = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    if (INTERNAL_KEY) headers['x-internal-key'] = INTERNAL_KEY;
    let res;
    try {
        res = await fetch(`${API_URL}${path}`, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
    } catch (e) {
        throw Object.assign(new Error('network_error'), { code: 'network_error' });
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error((data && data.error && data.error.message) || 'request failed'), { code: data && data.error && data.error.code, status: res.status });
    return data;
}

// ---- grounded tutoring ----
async function handleText(chatId, s, text) {
    if (s.handoff) return relayToHuman(chatId, s, text);

    const lang = s.lang || detectLang(text);
    let data;
    try {
        data = await api('POST', '/v1/chat', { message: text, lang, history: s.history.slice(-4) });
    } catch (e) {
        await send(chatId, e.code === 'rate_limited' ? t(s, 'rateLimited') : t(s, 'error'));
        return;
    }
    s.history.push({ role: 'user', content: text });
    s.history.push({ role: 'assistant', content: data.answer });
    s.pendingQuestion = text;

    let out = data.answer;
    if (data.citations && data.citations.length) out += `\n\n${t(s, 'sources')} ` + data.citations.map((c) => c.title).join('; ');
    const extra = data.escalate ? { reply_markup: { inline_keyboard: [[{ text: t(s, 'talk'), callback_data: 'escalate' }]] } } : undefined;
    await send(chatId, out, extra);
}

// ---- one-click human help (consent, then handoff, matching the widget) ----
function consentPrompt(chatId, s) {
    return send(chatId, t(s, 'consent'), {
        reply_markup: { inline_keyboard: [[{ text: t(s, 'yes'), callback_data: 'escalate_yes' }, { text: t(s, 'no'), callback_data: 'escalate_no' }]] }
    });
}

async function startHuman(chatId, s) {
    await send(chatId, t(s, 'connecting'));
    try {
        const r = await api('POST', '/v1/handoff', { question: s.pendingQuestion, transcript: s.history.slice(-10), lang: s.lang || 'en' });
        const h = { id: r.id, token: r.token, after: 0 };
        s.handoff = h;
        await send(chatId, t(s, 'waiting'));
        pollHuman(chatId, s, h);
    } catch (e) {
        await send(chatId, e.code === 'busy' ? t(s, 'busy') : t(s, 'sentFail'));
    }
}

async function relayToHuman(chatId, s, text) {
    const h = s.handoff;
    try {
        await api('POST', `/v1/handoff/${h.id}/messages`, { text }, h.token);
    } catch (e) {
        if (s.handoff !== h) return;
        if (e.status === 409 || e.status === 404) endHuman(s, chatId, t(s, 'lost'));
        else await send(chatId, t(s, 'sendFail'));
    }
}

function endHuman(s, chatId, message) {
    s.handoff = null;
    if (message) send(chatId, message);
}

// Long polling: the server holds each request up to 20s, so this makes
// about 3 requests a minute per learner, not one every second.
async function pollHuman(chatId, s, h) {
    let fails = 0;
    while (s.handoff === h) {
        let d;
        try {
            d = await api('GET', `/v1/handoff/${h.id}?after=${h.after}&wait=20`, null, h.token);
            fails = 0;
        } catch (e) {
            if (s.handoff !== h) return;
            if (e.status === 404) return endHuman(s, chatId, t(s, 'lost'));
            fails += 1;
            if (fails >= 5) return endHuman(s, chatId, t(s, 'lost'));
            await sleep(Math.min(2000 * fails, 10000));
            continue;
        }
        if (s.handoff !== h) return;
        for (const m of d.messages || []) {
            h.after = Math.max(h.after, m.id);
            if (m.from === 'agent') await send(chatId, m.text);
            else if (m.code === 'agent_joined') await send(chatId, t(s, 'joined'));
            else if (m.code === 'closed_by_agent') return endHuman(s, chatId, t(s, 'closedAgent'));
        }
        if (d.status === 'closed') return endHuman(s, chatId, null);
    }
}

// ---- update routing ----
async function handleCallback(cb) {
    const chatId = cb.message.chat.id;
    const s = session(chatId);
    await tg('answerCallbackQuery', { callback_query_id: cb.id });
    if (cb.data === 'escalate') {
        if (s.handoff) return send(chatId, t(s, 'already'));
        return consentPrompt(chatId, s);
    }
    if (cb.data === 'escalate_yes') return startHuman(chatId, s);
    if (cb.data === 'escalate_no') return send(chatId, t(s, 'cancelled'));
}

async function handleUpdate(u) {
    if (u.callback_query) return handleCallback(u.callback_query);
    const msg = u.message;
    if (!msg) return;
    const chatId = msg.chat.id;
    const s = session(chatId);

    if (msg.voice || msg.audio) return send(chatId, t(s, 'voiceUnsupported'));
    const text = (msg.text || '').trim();
    if (!text) return;

    if (text === '/start') return send(chatId, t(s, 'welcome'));
    if (text === '/en') { s.lang = 'en'; return send(chatId, t(s, 'welcome')); }
    if (text === '/am') { s.lang = 'am'; return send(chatId, t(s, 'welcome')); }
    if (text === '/human') return s.handoff ? send(chatId, t(s, 'already')) : consentPrompt(chatId, s);
    if (text === '/end') {
        if (!s.handoff) return send(chatId, t(s, 'noActive'));
        const h = s.handoff;
        s.handoff = null;
        api('POST', `/v1/handoff/${h.id}/close`, {}, h.token).catch(() => { /* best effort */ });
        return send(chatId, t(s, 'endedYou'));
    }
    if (s.pendingAccommodation && text.startsWith('/') && text !== '/cancel' && text !== '/accommodation') {
        s.pendingAccommodation = false;
    }
    if (text === '/jobs') {
        try { await api('POST', '/v1/jobs/subscribe', { channel: 'telegram', contact: String(chatId), lang: s.lang || 'en' }); return send(chatId, t(s, 'jobsSubscribed')); }
        catch (e) { return send(chatId, t(s, 'error')); }
    }
    if (text === '/unsubscribe') {
        try { await api('POST', '/v1/jobs/unsubscribe', { channel: 'telegram', contact: String(chatId) }); return send(chatId, t(s, 'jobsUnsubscribed')); }
        catch (e) { return send(chatId, t(s, 'error')); }
    }
    if (text === '/accommodation') {
        if (s.handoff) return send(chatId, t(s, 'already'));
        s.pendingAccommodation = true;
        return send(chatId, t(s, 'accommodationPrompt'));
    }
    if (text === '/cancel' && s.pendingAccommodation) { s.pendingAccommodation = false; return send(chatId, t(s, 'accommodationCancelled')); }

    if (s.pendingAccommodation) {
        s.pendingAccommodation = false;
        try {
            const r = await api('POST', '/v1/accommodations', { request: text, lang: s.lang || 'en' });
            const h = { id: r.id, token: r.token, after: 0 };
            s.handoff = h;
            await send(chatId, t(s, 'accommodationWaiting'));
            pollHuman(chatId, s, h);
        } catch (e) {
            await send(chatId, e.code === 'busy' ? t(s, 'busy') : t(s, 'sentFail'));
        }
        return;
    }

    return handleText(chatId, s, text);
}

async function main() {
    console.log(`Savanna Telegram bot running, talking to ${API_URL}${INTERNAL_KEY ? ' (trusted)' : ' (no INTERNAL_KEY set — subject to normal rate limits)'}`);
    let offset = 0;
    for (;;) {
        const updates = await tg('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] });
        if (updates === null) { await sleep(3000); continue; }
        for (const u of updates) {
            offset = u.update_id + 1;
            handleUpdate(u).catch((e) => console.error('handleUpdate error:', e));
        }
    }
}

main();