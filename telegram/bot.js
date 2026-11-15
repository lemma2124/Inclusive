/*! INCLUSIVE Telegram bot — zero dependencies, long polling.
    Reuses the same /v1/chat and /v1/handoff endpoints as the web widget,
    so grounding, citations, and human handoff behave identically here. */

import { detectChannelLanguage, parseChannelLanguage } from '../api/sms/language.js';
import { applyTelegramLanguage, parseTelegramInput } from './commands.js';
import { pathToFileURL } from 'node:url';

export const BOT_ENV = {
    API_URL: process.env.API_URL || 'http://localhost:8787',
    INTERNAL_KEY: process.env.INTERNAL_KEY || '',
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
    TELEGRAM_WEBHOOK_URL: process.env.TELEGRAM_WEBHOOK_URL || '',
    TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET || process.env.INTERNAL_KEY || '',
    TELEGRAM_WEBHOOK_PATH: process.env.TELEGRAM_WEBHOOK_PATH || '/telegram/webhook',
    TELEGRAM_POLLING: process.env.TELEGRAM_POLLING === 'true'
};

const API_URL = BOT_ENV.API_URL;
const INTERNAL_KEY = BOT_ENV.INTERNAL_KEY;
const TELEGRAM_BOT_TOKEN = BOT_ENV.TELEGRAM_BOT_TOKEN;
const TG = TELEGRAM_BOT_TOKEN ? `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}` : null;

const STRINGS = {
    en: {
        welcome: 'Welcome to INCLUSIVE! Ask about your course in English or Amharic. Use /help for commands, /language to choose a language, /jobs for job information and alerts, or /support to request a person.',
        help: 'Commands: /learn ask a course question; /jobs job information and alerts; /support request a person; /language choose English, Amharic, Afaan Oromo, or Tigrinya; /help show this menu. Course chat is currently English and Amharic.',
        languagePrompt: 'Choose a language: /en English, /am Amharic, /om Afaan Oromo, /ti Tigrinya.',
        languageSet: 'Language preference updated.',
        learnPrompt: 'Type your course question after /learn, or send the question directly.',
        languageUnclear: 'I could not identify your language. Please use /language to choose one.',
        chatUnsupported: 'Course chat currently supports English and Amharic only. Your language preference is saved for this bot session; use /en or /am to ask course questions.',
        commandUnknown: 'I did not recognize that command. Send /help to see available options.',
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
        welcome: 'ወደ INCLUSIVE እንኳን በደህና መጡ! በአማርኛ ወይም በእንግሊዝኛ ስለ ኮርስዎ ይጠይቁ። ትዕዛዞችን ለማየት /help፣ ቋንቋ ለመምረጥ /language፣ ለሥራ መረጃ /jobs ወይም ሰው ለማግኘት /support ይላኩ።',
        help: 'ትዕዛዞች፦ /learn የኮርስ ጥያቄ፣ /jobs የስራ መረጃ፣ /support ሰው ለማግኘት፣ /language ቋንቋ ለመምረጥ፣ /help ይህን ዝርዝር ለማየት። የኮርስ ውይይት አማርኛንና እንግሊዝኛን ይደግፋል።',
        languagePrompt: 'ቋንቋ ይምረጡ፦ /en እንግሊዝኛ፣ /am አማርኛ፣ /om Afaan Oromo፣ /ti ትግርኛ።',
        languageSet: 'ቋንቋ ተቀይሯል።',
        learnPrompt: 'ጥያቄዎን ከ /learn በኋላ ይጻፉ ወይም ጥያቄዎን በቀጥታ ይላኩ።',
        languageUnclear: 'ቋንቋውን መለየት አልቻልኩም። /language በመጠቀም ቋንቋ ይምረጡ።',
        chatUnsupported: 'የኮርስ ውይይት አማርኛንና እንግሊዝኛን ብቻ ይደግፋል። ለጥያቄዎች /en ወይም /am ይጠቀሙ።',
        commandUnknown: 'ይህን ትዕዛዝ አላወቅሁትም። የሚገኙትን አማራጮች ለማየት /help ይላኩ።',
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

const t = (s, key) => (STRINGS[s.lang] || STRINGS.en)[key];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- per-chat state (in memory; resets if the bot restarts) ----
const sessions = new Map();
const updateLimits = new Map();
function limited(chatId, text) {
    const now = Date.now();
    let entry = updateLimits.get(chatId);
    if (!entry || now - entry.startedAt >= 60000) {
        entry = { startedAt: now, count: 0 };
        updateLimits.set(chatId, entry);
    }
    const command = String(text || '').split(/\s+/, 1)[0].toLowerCase();
    if (['/help', '/start', '/language', '/lang', '/end', '/en', '/am', '/om', '/ti'].includes(command)) return false;
    entry.count += 1;
    return entry.count > 30;
}
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

    const detected = detectChannelLanguage(text);
    if (detected && !s.languageExplicit) s.lang = detected;
    const lang = s.lang;
    if (!lang) return send(chatId, t(s, 'languageUnclear'));
    if (lang !== 'en' && lang !== 'am') return send(chatId, t(s, 'chatUnsupported'));
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
    if (limited(chatId, text)) return send(chatId, t(s, 'rateLimited'));
    if (text.length > 1000) return send(chatId, t(s, 'error'));
    const parsed = parseTelegramInput(text);
    const { command, argument } = parsed;

    if (command === '/start') {
        if (!s.lang) s.lang = 'en';
        return send(chatId, t(s, 'welcome'));
    }
    if (command === '/help') return send(chatId, t(s, 'help'));
    if (command === '/language' || command === '/lang') {
        const selected = parsed.language;
        if (!selected) return send(chatId, t(s, 'languagePrompt'));
        s.lang = selected;
        s.languageExplicit = true;
        return send(chatId, t(s, 'languageSet') + '\n' + t(s, 'welcome'));
    }
    if (command === '/en' || command === '/am' || command === '/om' || command === '/ti') {
        s.lang = command.slice(1);
        s.languageExplicit = true;
        return send(chatId, t(s, 'languageSet') + '\n' + t(s, 'welcome'));
    }
    if (!command) {
        const plainLanguage = applyTelegramLanguage(s, parsed);
        if (plainLanguage) return send(chatId, t(s, 'languageSet') + '\n' + t(s, 'welcome'));
    }
    if (command === '/learn') return argument ? handleText(chatId, s, argument) : send(chatId, t(s, 'learnPrompt'));
    if (command === '/support' || command === '/human') return s.handoff ? send(chatId, t(s, 'already')) : consentPrompt(chatId, s);
    if (command === '/end') {
        if (!s.handoff) return send(chatId, t(s, 'noActive'));
        const h = s.handoff;
        s.handoff = null;
        api('POST', `/v1/handoff/${h.id}/close`, {}, h.token).catch(() => { /* best effort */ });
        return send(chatId, t(s, 'endedYou'));
    }
    if (s.pendingAccommodation && text.startsWith('/') && text !== '/cancel' && text !== '/accommodation') {
        s.pendingAccommodation = false;
    }
    if (command === '/jobs') {
        try {
            await api('POST', '/v1/jobs/subscribe', { channel: 'telegram', contact: String(chatId), lang: s.lang === 'am' ? 'am' : 'en' });
            if (s.lang !== 'en' && s.lang !== 'am') return send(chatId, t(s, 'chatUnsupported') + '\n' + t(s, 'jobsSubscribed'));
            const jobs = await api('POST', '/v1/chat', {
                message: s.lang === 'am' ? 'የሚገኙ የሥራ መረጃዎችን እና የቃለ መጠይቅ ድጋፍን አሳየኝ።' : 'Show available job information and interview accommodation guidance.',
                lang: s.lang,
                history: s.history.slice(-4)
            });
            const sources = jobs.citations && jobs.citations.length ? `\n\n${t(s, 'sources')} ${jobs.citations.map((c) => c.title).join('; ')}` : '';
            return send(chatId, `${jobs.answer}${sources}\n\n${t(s, 'jobsSubscribed')}`);
        }
        catch (e) { return send(chatId, t(s, 'error')); }
    }
    if (command === '/unsubscribe') {
        try { await api('POST', '/v1/jobs/unsubscribe', { channel: 'telegram', contact: String(chatId) }); return send(chatId, t(s, 'jobsUnsubscribed')); }
        catch (e) { return send(chatId, t(s, 'error')); }
    }
    if (command === '/accommodation') {
        if (s.handoff) return send(chatId, t(s, 'already'));
        s.pendingAccommodation = true;
        return send(chatId, t(s, 'accommodationPrompt'));
    }
    if (command === '/cancel' && s.pendingAccommodation) { s.pendingAccommodation = false; return send(chatId, t(s, 'accommodationCancelled')); }

    if (command.startsWith('/')) return send(chatId, t(s, 'commandUnknown'));

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

export async function registerWebhook({ baseUrl = BOT_ENV.TELEGRAM_WEBHOOK_URL, path = BOT_ENV.TELEGRAM_WEBHOOK_PATH, secret = BOT_ENV.TELEGRAM_WEBHOOK_SECRET } = {}) {
    if (!TELEGRAM_BOT_TOKEN) return { ok: false, reason: 'missing_token' };
    if (!baseUrl) return { ok: false, reason: 'missing_base_url' };
    const url = new URL(path, baseUrl).toString();
    const res = await fetch(`${TG}/setWebhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url, secret_token: secret || '' })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.ok) {
        console.error('Telegram setWebhook failed:', data || res.statusText);
        return { ok: false, reason: 'telegram_error', data };
    }
    return { ok: true, url };
}

export async function processTelegramWebhook(body, { secret } = {}) {
    if (!body || !body.update_id) {
        console.error('Telegram webhook received an empty or invalid update payload.', body);
        return { ok: false, reason: 'empty_update' };
    }
    const expected = secret || BOT_ENV.TELEGRAM_WEBHOOK_SECRET || BOT_ENV.INTERNAL_KEY || '';
    if (expected && body.secret_token && body.secret_token !== expected) {
        console.error('Telegram webhook secret mismatch.', { receivedSecret: !!body.secret_token, expectedSecretPresent: !!expected });
        return { ok: false, reason: 'secret_mismatch' };
    }
    try {
        await handleUpdate(body);
        return { ok: true };
    } catch (e) {
        console.error('Telegram update processing failed:', e && e.stack ? e.stack : e);
        return { ok: false, reason: 'processing_error', error: e && e.message ? e.message : String(e) };
    }
}

async function main() {
    if (!TELEGRAM_BOT_TOKEN) {
        console.error('TELEGRAM_BOT_TOKEN is not set. Export it before starting the Telegram bot.');
        process.exit(1);
    }
    if (BOT_ENV.TELEGRAM_POLLING || !BOT_ENV.TELEGRAM_WEBHOOK_URL) {
        console.log(`INCLUSIVE Telegram bot running in polling mode, talking to ${API_URL}${INTERNAL_KEY ? ' (trusted)' : ' (no INTERNAL_KEY set — subject to normal rate limits)'}`);
        let offset = 0;
        for (;;) {
            const updates = await tg('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] });
            if (updates === null) { await sleep(3000); continue; }
            for (const u of updates) {
                offset = u.update_id + 1;
                handleUpdate(u).catch((e) => {
                    console.error('handleUpdate error:', e && e.message ? e.message : 'unknown error');
                    const chatId = u.message && u.message.chat ? u.message.chat.id :
                        u.callback_query && u.callback_query.message && u.callback_query.message.chat ? u.callback_query.message.chat.id : null;
                    if (chatId) send(chatId, t(session(chatId), 'error')).catch(() => {});
                });
            }
        }
    } else {
        console.log(`INCLUSIVE Telegram bot running in webhook mode at ${BOT_ENV.TELEGRAM_WEBHOOK_URL}${BOT_ENV.TELEGRAM_WEBHOOK_PATH}`);
        const result = await registerWebhook();
        if (!result.ok) {
            console.error('Telegram webhook registration failed. Check TELEGRAM_WEBHOOK_URL and TELEGRAM_BOT_TOKEN.');
            process.exit(1);
        }
        // Keep the process alive for the server to serve webhook requests when this file is run directly.
        setInterval(() => {}, 60000);
    }
}

if (process.argv[1] && process.argv[1].endsWith('telegram/bot.js')) {
    main();
}