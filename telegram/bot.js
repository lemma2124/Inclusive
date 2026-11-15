/*! INCLUSIVE Telegram bot — zero dependencies, long polling.
    Reuses the same /v1/chat and /v1/handoff endpoints as the web widget,
    so grounding, citations, and human handoff behave identically here. */

import { detectChannelLanguage } from '../api/sms/language.js';
import { translateSmsMessage } from '../api/sms/session.js';
import { safeEqual } from '../api/lib/auth.js';
import { createAddisSpeech } from '../api/ai/addis-speech.js';
import { MAX_SPEECH_BYTES, MAX_SPEECH_SECONDS, validateSpeechAudio } from '../api/speech/upload.js';
import { applyTelegramLanguage, parseTelegramInput } from './commands.js';
import { pathToFileURL } from 'node:url';

export const BOT_ENV = {
    API_URL: process.env.NODE_ENV === 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(process.env.API_URL || '')
        ? `http://127.0.0.1:${process.env.PORT || 10000}`
        : process.env.API_URL || `http://127.0.0.1:${process.env.PORT || 8787}`,
    INTERNAL_KEY: process.env.INTERNAL_KEY || '',
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
    TELEGRAM_WEBHOOK_URL: process.env.TELEGRAM_WEBHOOK_URL || '',
    TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET || process.env.INTERNAL_KEY || '',
        TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET || '',
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
        help: 'Commands: /learn ask a course question; /jobs job information and alerts; /support or /human request a person; /accommodation request interview support; /language choose English, Amharic, Afaan Oromo, or Tigrinya; /voice enable spoken replies where available; /text use text replies; /end end support; /cancel cancel a pending request; /unsubscribe stop job alerts; /help show this menu.',
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
        speechUnavailable: 'Speech recognition or speech playback is not configured right now. Please type your question or use text replies.',
        voiceUnavailable: 'English voice playback is not available. Your answer is shown as text; use /text to turn off voice replies.',
        speechLanguageUnavailable: 'Speech recognition is not available for this language. Choose English, Amharic, Afaan Oromo, or Tigrinya with /language.',
        transcriptionFailed: 'I could not transcribe that recording. Please try a shorter, clearer recording or type your question.',
        audioTooLarge: 'That audio file is too large. Send a recording under 8 MB.',
        audioTooLong: 'That recording is too long. Keep it to 30 seconds or less.',
            speechRateLimited: 'Too many speech requests. Please wait a minute and try again.',
        transcriptPrefix: 'I heard:',
        voiceMode: 'Voice replies enabled where a speech voice is available. Use /text to switch back.',
        textMode: 'Text replies enabled.',
        jobsSubscribed: 'You are now subscribed to job alerts here. Send /unsubscribe to stop.',
        jobsUnsubscribed: 'You will no longer receive job alerts.',
        accommodationPrompt: 'Please describe what you need for your interview (for example: more time, a sign language interpreter, or a quiet room). You do not need to state a medical condition. Send /cancel to stop.',
        accommodationCancelled: 'OK, no request was sent.',
        accommodationWaiting: 'Your request was sent to a person. They may reply here. Send /end to stop.'
    },
    am: {
        welcome: 'ወደ INCLUSIVE እንኳን በደህና መጡ! በአማርኛ ወይም በእንግሊዝኛ ስለ ኮርስዎ ይጠይቁ። ትዕዛዞችን ለማየት /help፣ ቋንቋ ለመምረጥ /language፣ ለሥራ መረጃ /jobs ወይም ሰው ለማግኘት /support ይላኩ።',
        help: 'ትዕዛዞች፦ /learn የኮርስ ጥያቄ፤ /jobs የስራ መረጃና ማስታወቂያ፤ /support ወይም /human ሰው ለማግኘት፤ /accommodation የቃለ መጠይቅ ድጋፍ፤ /language ቋንቋ ለመምረጥ፤ /voice የድምፅ መልስ ለማንቃት፤ /text የጽሑፍ መልስ፤ /end ድጋፍን ለማቆም፤ /cancel ጥያቄን ለመሰረዝ፤ /unsubscribe ማስታወቂያን ለማቆም፤ /help ይህን ዝርዝር ለማየት።',
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
        speechUnavailable: 'የድምፅ መለየት ወይም ማጫወት አሁን አልተዋቀረም። እባክዎ ጥያቄዎን ይጻፉ ወይም /text ይጠቀሙ።',
        voiceUnavailable: 'ለእንግሊዝኛ የድምፅ መልስ አይገኝም። መልሱ በጽሑፍ ተልኳል።',
        speechLanguageUnavailable: 'ለዚህ ቋንቋ የድምፅ መለየት አይገኝም። /language በመጠቀም ቋንቋ ይምረጡ።',
        transcriptionFailed: 'ድምፁን ወደ ጽሑፍ መቀየር አልተቻለም። እባክዎ አጭርና ግልጽ ድምፅ ይላኩ ወይም ይጻፉ።',
        audioTooLarge: 'የድምፅ ፋይሉ በጣም ትልቅ ነው። ከ8 MB በታች ይላኩ።',
        audioTooLong: 'ድምፁ በጣም ረጅም ነው። 30 ሰከንድ ወይም ከዚያ በታች ይላኩ።',
            speechRateLimited: 'ብዙ የድምፅ ጥያቄዎች ተልከዋል። እባክዎ ቆይተው ይሞክሩ።',
            speechRateLimited: 'rateLimited',
        transcriptPrefix: 'የሰማሁት፦',
        voiceMode: 'ድምፅ መልስ የሚደግፉ ቋንቋዎች ላይ ተነቅቷል። ወደ /text ለመመለስ /text ይላኩ።',
        textMode: 'በጽሑፍ መልስ ተመርጧል።',
        jobsSubscribed: 'በዚህ ለስራ ማስታወቂያዎች ተመዝግበዋል። ለማቆም /unsubscribe ይላኩ።',
        jobsUnsubscribed: 'ከዚህ በኋላ የስራ ማስታወቂያ አይደርስዎትም።',
        accommodationPrompt: 'ለቃለ መጠይቅ ምን እንደሚያስፈልግዎ ይግለጹ (ለምሳሌ፦ ተጨማሪ ጊዜ፣ የምልክት ቋንቋ አስተርጓሚ፣ ወይም ጸጥ ያለ ክፍል)። የህክምና ሁኔታ መግለጽ አያስፈልግም። ለመሰረዝ /cancel ይላኩ።',
        accommodationCancelled: 'እሺ፣ ምንም ጥያቄ አልተላከም።',
        accommodationWaiting: 'ጥያቄዎ ለሰው ተልኳል። እዚህ ሊመልስልዎት ይችላል። ለማቆም /end ይላኩ።'
    }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHARED_SMS_KEYS = {
    languagePrompt: 'languagePrompt', languageSet: 'languageSet', learnPrompt: 'learnPrompt',
    languageUnclear: 'languageUnclear', chatUnsupported: 'unsupportedChat', consent: 'consent',
    cancelled: 'cancelled', joined: 'joined', closedAgent: 'closedAgent', endedYou: 'endedYou',
    lost: 'lost', busy: 'busy', sentFail: 'sentFail', error: 'error', rateLimited: 'rateLimited',
    jobsSubscribed: 'jobsSubscribed', jobsUnsubscribed: 'jobsUnsubscribed',
    accommodationPrompt: 'accommodationPrompt', accommodationCancelled: 'accommodationCancelled',
    accommodationWaiting: 'accommodationWaiting'
};

STRINGS.om = {
    welcome: 'Baga gara INCLUSIVE dhuftan! Gaaffii barnootaa gaafadhaa. /learn, /jobs, /support, /language, /voice yookaan /help ergaa.',
    help: 'Ajajoota: /learn gaaffii barnootaa; /jobs odeeffannoo hojii; /support yookaan /human nama; /accommodation gargaarsa afeerraa hojii; /language afaan filadhaa; /voice sagalee yoo jiraate; /text barruu; /end deeggarsa dhaabi; /cancel gaaffii haqii; /unsubscribe beeksisa dhaabi; /help ajajoota.',
    commandUnknown: 'Ajaja kana hin beekne. Ajajoota argachuuf /help ergaa.',
    connecting: 'Nama deeggarsa kennu waliin isin walqunnamsiisaa jira.',
    waiting: 'Gaaffiin keessan ergameera. Nama deeggarsa kennu eeggadhaa. Amma ergaa ergitan isatti ni geessa. Dhaabuuf /end ergaa.',
    already: 'Nama deeggarsa kennu waliin walqabattaniittu. Dhaabuuf /end ergaa.',
    noActive: 'Amma nama waliin deeggarsa irratti hin jirtan.',
    sendFail: 'Ergaan keessan hin ergamne. Irra deebiʼaa.',
    sources: 'Madda:', talk: 'Nama waliin haasaʼi', yes: 'Eeyyee, nama na qunnamsiisi', no: 'Lakki, galatoomi',
    speechUnavailable: 'Tajaajilli sagalee amma hin qophoofne. Gaaffii keessan barreessaa.',
    voiceUnavailable: 'Deebiin sagalee Afaan Ingiliffaaf hin jiru. Deebiin barruun ergameera.',
    speechLanguageUnavailable: 'Afaan kanaaf beekamtiin sagalee hin jiru. /language fayyadamuun afaan filadhaa.',
    transcriptionFailed: 'Sagalee kana gara barruutti jijjiiruu hin dandeenye. Sagalee gabaabaa ergaa yookaan barreessaa.',
    audioTooLarge: 'Faayiliin sagalee kun guddaa dha. 8 MB gadi ergaa.', audioTooLong: 'Sagaleen kun dheeraa dha. Sekondii 30 gadi taasisaa.',
    transcriptPrefix: 'Sagaleen keessan akkana hiikame:',
    voiceMode: 'Deebiin sagalee afaan kanaaf yoo jiraate ni hojjeta. Barruutti deebiʼuuf /text ergaa.',
    textMode: 'Deebiin barruu filatameera.'
};
STRINGS.ti = {
    welcome: 'ናብ INCLUSIVE ብደሓን መጻእኩም! ሕቶ ትምህርቲ ሕተቱ። /learn፣ /jobs፣ /support፣ /language፣ /voice ወይ /help ስደዱ።',
    help: 'ትእዛዛት፦ /learn ሕቶ ትምህርቲ፤ /jobs ሓበሬታ ስራሕ፤ /support ወይ /human ሰብ ሓገዝ፤ /accommodation ናይ ቃለ መሕትት ሓገዝ፤ /language ቋንቋ ምረጹ፤ /voice ድምጺ እንተሎ፤ /text ጽሑፍ፤ /end ሓገዝ ኣቋርጹ፤ /cancel ሕቶ ሰርዙ፤ /unsubscribe ሓበሬታ ስራሕ ኣቋርጹ፤ /help ትእዛዛት።',
    commandUnknown: 'ነዚ ትእዛዝ ኣይፈለጥናዮን። /help ስደዱ።',
    connecting: 'ምስ ሓጋዚ ሰብ ከነራኽበኩም ኢና።',
    waiting: 'ሕቶኹም ተላኢኹ። ሓጋዚ ሰብ ተጸበዩ። ሕጂ እትሰድድዎ መልእኽቲ ናብኡ ክኸይድ እዩ። ንምቁራጽ /end ስደዱ።',
    already: 'ምስ ሓጋዚ ሰብ ተራኺብኩም ኣለኹም። /end ስደዱ።',
    noActive: 'ሕጂ ምስ ሓጋዚ ሰብ ኣይተራኸብኩምን።',
    sendFail: 'መልእኽትኹም ኣይተላእከን። ደጊምኩም ፈትኑ።',
    sources: 'ምንጪ:', talk: 'ምስ ሰብ ተዛረቡ', yes: 'እወ፣ ኣራኽቡኒ', no: 'ኣይፋል፣ የቐንየለይ',
    speechUnavailable: 'ኣገልግሎት ድምጺ ሕጂ ኣይተዳለወን። ሕቶኹም ጽሓፉ።',
    voiceUnavailable: 'ንእንግሊዝኛ ድምጺ መልሲ የለን። መልሲ ብጽሑፍ ተላኢኹ።',
    speechLanguageUnavailable: 'ንዚ ቋንቋ ድምጺ ምቕያር ኣይድገፍን። /language ተጠቒምኩም ቋንቋ ምረጹ።',
    transcriptionFailed: 'ድምጺ ናብ ጽሑፍ ምቕያር ኣይከኣልናን። ሓጺር ድምጺ ስደዱ ወይ ጽሓፉ።',
    audioTooLarge: 'እቲ ድምጺ ፋይል ዓቢ እዩ። ትሕቲ 8 MB ስደዱ።', audioTooLong: 'እቲ ድምጺ ነዊሕ እዩ። 30 ሰከንድ ወይ ትሕቲኡ ስደዱ።',
    transcriptPrefix: 'ዝሰማዕኩዎ:',
    voiceMode: 'ድምጺ መልሲ ኣብ ዝድግፉ ቋንቋታት ተኸፊቱ። /text ስደዱ ንምቕያር።',
    textMode: 'ጽሑፍ መልሲ ተመሪጹ።'
};

const t = (s, key) => {
    const local = (STRINGS[s.lang] || STRINGS.en)[key];
    if (local) return local;
    const smsKey = SHARED_SMS_KEYS[key];
    return (smsKey && translateSmsMessage(s.lang, smsKey)) || STRINGS.en[key] || '';
};

function createRuntimeContext({
    token = TELEGRAM_BOT_TOKEN,
    apiUrl = API_URL,
    internalKey = INTERNAL_KEY,
    fetchImpl = fetch,
    telegramCall,
    apiCall,
    downloadFile,
    speech = null,
    now = Date.now,
    sessions = new Map(),
    updateLimits = new Map(),
    speechLimits = new Map(),
    ttsLimits = new Map()
} = {}) {
    const telegramBase = token ? `https://api.telegram.org/bot${token}` : '';
    const telegramFileBase = token ? `https://api.telegram.org/file/bot${token}` : '';

    async function tg(method, params) {
        if (telegramCall) return telegramCall(method, params);
        if (!telegramBase) return null;
        try {
            const res = await fetchImpl(`${telegramBase}/${method}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(params || {})
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data || !data.ok) {
                console.error(`Telegram ${method} failed.`);
                return null;
            }
            return data.result;
        } catch {
            console.error(`Telegram ${method} network request failed.`);
            return null;
        }
    }

    const send = (chatId, text, extra) => tg('sendMessage', { chat_id: chatId, text, ...extra });

    async function api(method, path, body, bearerToken) {
        if (apiCall) return apiCall(method, path, body, bearerToken);
        const headers = { 'content-type': 'application/json' };
        if (bearerToken) headers.authorization = `Bearer ${bearerToken}`;
        if (internalKey) headers['x-internal-key'] = internalKey;
        let res;
        try {
            res = await fetchImpl(`${apiUrl}${path}`, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
        } catch {
            throw Object.assign(new Error('network_error'), { code: 'network_error' });
        }
        const data = await res.json().catch(() => null);
        if (!res.ok) throw Object.assign(new Error((data && data.error && data.error.message) || 'request failed'), { code: data && data.error && data.error.code, status: res.status });
        return data;
    }

    async function fetchTelegramFile(fileId, media) {
        if (media.file_size && media.file_size > MAX_SPEECH_BYTES) throw Object.assign(new Error('audio_too_large'), { code: 'audio_too_large' });
        const file = await tg('getFile', { file_id: fileId });
        const filePath = file && file.file_path;
        const segments = typeof filePath === 'string' ? filePath.split('/') : [];
        if (!telegramFileBase || !segments.length || segments.some((segment) => !segment || segment === '.' || segment === '..' || !/^[A-Za-z0-9._-]+$/.test(segment))) {
            throw Object.assign(new Error('audio_download_failed'), { code: 'audio_download_failed' });
        }
        let response;
        try {
            response = await fetchImpl(`${telegramFileBase}/${filePath}`, { signal: AbortSignal.timeout(20000) });
        } catch {
            throw Object.assign(new Error('audio_download_failed'), { code: 'audio_download_failed' });
        }
        const declaredSize = Number(response.headers.get('content-length') || 0);
        if (!response.ok || declaredSize > MAX_SPEECH_BYTES || !response.body) {
            throw Object.assign(new Error(declaredSize > MAX_SPEECH_BYTES ? 'audio_too_large' : 'audio_download_failed'), {
                code: declaredSize > MAX_SPEECH_BYTES ? 'audio_too_large' : 'audio_download_failed'
            });
        }
        const reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                size += value.byteLength;
                if (size > MAX_SPEECH_BYTES) {
                    await reader.cancel();
                    throw Object.assign(new Error('audio_too_large'), { code: 'audio_too_large' });
                }
                chunks.push(Buffer.from(value));
            }
        } catch (error) {
            if (error.code === 'audio_too_large') throw error;
            throw Object.assign(new Error('audio_download_failed'), { code: 'audio_download_failed' });
        }
        const extension = filePath.split('.').pop().toLowerCase();
        const extensionTypes = { oga: 'audio/ogg', ogg: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', wav: 'audio/wav', webm: 'audio/webm' };
        const mimeType = media.mime_type || extensionTypes[extension] || '';
        return { audio: Buffer.concat(chunks, size), mimeType };
    }

    function session(chatId) {
        let value = sessions.get(chatId);
        if (!value) {
            value = { lang: null, languageExplicit: false, responseMode: 'text', history: [], handoff: null, pendingConsent: false, pendingAccommodation: false, pendingQuestion: '' };
            sessions.set(chatId, value);
        }
        return value;
    }

    function limited(chatId, text) {
        const time = now();
        let entry = updateLimits.get(chatId);
        if (!entry || time - entry.startedAt >= 60000) {
            entry = { startedAt: time, count: 0 };
            updateLimits.set(chatId, entry);
        }
        const command = String(text || '').split(/\s+/, 1)[0].toLowerCase();
        if (['/help', '/start', '/language', '/lang', '/end', '/en', '/am', '/om', '/ti', '/text', '/voice'].includes(command)) return false;
        entry.count += 1;
        return entry.count > 30;
    }

    function speechLimited(map, chatId) {
        const time = now();
        let entry = map.get(chatId);
        if (!entry || time - entry.startedAt >= 60000) {
            entry = { startedAt: time, count: 0 };
            map.set(chatId, entry);
        }
        entry.count += 1;
        return entry.count > 5;
    }

    return {
        api, fetchImpl, limited, session, send, speech, tg,
        speechLimited: (chatId) => speechLimited(speechLimits, chatId),
        ttsLimited: (chatId) => speechLimited(ttsLimits, chatId),
        downloadFile: downloadFile || fetchTelegramFile
    };
}

export function createTelegramRuntime(options = {}) {
    const context = createRuntimeContext(options);
    return {
        getSession: context.session,
        send: context.send,
        processUpdate: (update, overrides = {}) => handleUpdate(update, { ...context, ...overrides })
    };
}

const defaultRuntime = createTelegramRuntime({ speech: createAddisSpeech({ apiKey: process.env.ADDIS_API_KEY || '' }) });

// ---- grounded tutoring ----
async function sendAnswer(chatId, s, text, extra, context) {
    await context.send(chatId, text, extra);
    if (s.responseMode !== 'voice') return;
    if (s.lang === 'en') return context.send(chatId, t(s, 'voiceUnavailable'));
    if (!context.speech || typeof context.speech.synthesize !== 'function') return context.send(chatId, t(s, 'speechUnavailable'));
    if (context.ttsLimited(chatId)) return context.send(chatId, t(s, 'speechRateLimited'));
    try {
        const audio = await context.speech.synthesize({ text: text.replace(/\s*\[\d+\]/g, '').slice(0, 600), language: s.lang });
        await context.tg('sendAudio', { chat_id: chatId, audio: audio.audioUrl });
    } catch {
        await context.send(chatId, t(s, 'speechUnavailable'));
    }
}

async function handleText(chatId, s, text, context) {
    if (s.handoff) return relayToHuman(chatId, s, text, context);

    const detected = detectChannelLanguage(text);
    if (detected && !s.languageExplicit) s.lang = detected;
    const lang = s.lang;
    if (!lang) return context.send(chatId, t(s, 'languageUnclear'));
    let data;
    try {
        data = await context.api('POST', '/v1/chat', { message: text, lang, history: s.history.slice(-4) });
    } catch (e) {
        await context.send(chatId, e.code === 'rate_limited' ? t(s, 'rateLimited') : t(s, 'error'));
        return;
    }
    s.history.push({ role: 'user', content: text });
    s.history.push({ role: 'assistant', content: data.answer });
    s.pendingQuestion = text;

    let out = data.answer;
    if (data.citations && data.citations.length) out += `\n\n${t(s, 'sources')} ` + data.citations.map((c) => c.title).join('; ');
    const extra = data.escalate ? { reply_markup: { inline_keyboard: [[{ text: t(s, 'talk'), callback_data: 'escalate' }]] } } : undefined;
    await sendAnswer(chatId, s, out, extra, context);
}

// ---- one-click human help (consent, then handoff, matching the widget) ----
function consentPrompt(chatId, s, context) {
    s.pendingConsent = true;
    return context.send(chatId, t(s, 'consent'), {
        reply_markup: { inline_keyboard: [[{ text: t(s, 'yes'), callback_data: 'escalate_yes' }, { text: t(s, 'no'), callback_data: 'escalate_no' }]] }
    });
}

async function startHuman(chatId, s, context) {
    await context.send(chatId, t(s, 'connecting'));
    try {
        const r = await context.api('POST', '/v1/handoff', { question: s.pendingQuestion, transcript: s.history.slice(-10), lang: s.lang || 'en' });
        const h = { id: r.id, token: r.token, after: 0 };
        s.handoff = h;
        await context.send(chatId, t(s, 'waiting'));
        pollHuman(chatId, s, h, context);
    } catch (e) {
        await context.send(chatId, e.code === 'busy' ? t(s, 'busy') : t(s, 'sentFail'));
    }
}

async function relayToHuman(chatId, s, text, context) {
    const h = s.handoff;
    try {
        await context.api('POST', `/v1/handoff/${h.id}/messages`, { text }, h.token);
    } catch (e) {
        if (s.handoff !== h) return;
        if (e.status === 409 || e.status === 404) endHuman(s, chatId, t(s, 'lost'), context);
        else await context.send(chatId, t(s, 'sendFail'));
    }
}

function endHuman(s, chatId, message, context) {
    s.handoff = null;
    if (message) context.send(chatId, message);
}

// Long polling: the server holds each request up to 20s, so this makes
// about 3 requests a minute per learner, not one every second.
async function pollHuman(chatId, s, h, context) {
    let fails = 0;
    while (s.handoff === h) {
        let d;
        try {
            d = await context.api('GET', `/v1/handoff/${h.id}?after=${h.after}&wait=20`, null, h.token);
            fails = 0;
        } catch (e) {
            if (s.handoff !== h) return;
            if (e.status === 404) return endHuman(s, chatId, t(s, 'lost'), context);
            fails += 1;
            if (fails >= 5) return endHuman(s, chatId, t(s, 'lost'), context);
            await sleep(Math.min(2000 * fails, 10000));
            continue;
        }
        if (s.handoff !== h) return;
        for (const m of d.messages || []) {
            h.after = Math.max(h.after, m.id);
            if (m.from === 'agent') await context.send(chatId, m.text);
            else if (m.code === 'agent_joined') await context.send(chatId, t(s, 'joined'));
            else if (m.code === 'closed_by_agent') return endHuman(s, chatId, t(s, 'closedAgent'), context);
        }
        if (d.status === 'closed') return endHuman(s, chatId, null, context);
    }
}

// ---- update routing ----
function telegramLanguage(value) {
    const language = String(value || '').toLowerCase().split('-', 1)[0];
    return ['en', 'am', 'om', 'ti'].includes(language) ? language : null;
}

async function handleVoice(chatId, s, message, context) {
    const media = message.voice || message.audio;
    if (!context.speech || typeof context.speech.transcribe !== 'function') return context.send(chatId, t(s, 'speechUnavailable'));
    if (context.speechLimited(chatId)) return context.send(chatId, t(s, 'speechRateLimited'));
    if ((media.file_size || 0) > MAX_SPEECH_BYTES) return context.send(chatId, t(s, 'audioTooLarge'));
    if ((media.duration || 0) > MAX_SPEECH_SECONDS) return context.send(chatId, t(s, 'audioTooLong'));
    const language = s.lang || telegramLanguage(message.from && message.from.language_code) || 'en';
    try {
        const downloaded = await context.downloadFile(media.file_id, media);
        const audio = await validateSpeechAudio({ ...downloaded, language });
        const transcript = await context.speech.transcribe(audio);
        const detected = detectChannelLanguage(transcript.text);
        if (!s.languageExplicit && detected) s.lang = detected;
        else if (!s.lang) s.lang = language;
        await context.send(chatId, `${t(s, 'transcriptPrefix')}\n${transcript.text}`);
        return handleText(chatId, s, transcript.text, context);
    } catch (e) {
        const key = e.code === 'speech_disabled' ? 'speechUnavailable' :
            e.code === 'audio_too_large' ? 'audioTooLarge' :
                e.code === 'audio_too_long' ? 'audioTooLong' :
                    e.code === 'unsupported_speech_language' ? 'speechLanguageUnavailable' : 'transcriptionFailed';
        return context.send(chatId, t(s, key));
    }
}

async function handleCallback(cb, context) {
    const chatId = cb.message.chat.id;
    const s = context.session(chatId);
    await context.tg('answerCallbackQuery', { callback_query_id: cb.id });
    if (cb.data === 'escalate') {
        if (s.handoff) return context.send(chatId, t(s, 'already'));
        return consentPrompt(chatId, s, context);
    }
    if (cb.data === 'escalate_yes') {
        if (!s.pendingConsent) return;
        s.pendingConsent = false;
        return startHuman(chatId, s, context);
    }
    if (cb.data === 'escalate_no') { s.pendingConsent = false; return context.send(chatId, t(s, 'cancelled')); }
}

async function handleUpdate(u, context = defaultRuntime) {
    if (u.callback_query) return handleCallback(u.callback_query, context);
    const msg = u.message;
    if (!msg) return;
    const chatId = msg.chat.id;
    const s = context.session(chatId);

    if (msg.voice || msg.audio) return handleVoice(chatId, s, msg, context);
    const text = (msg.text || '').trim();
    if (!text) return;
    if (context.limited(chatId, text)) return context.send(chatId, t(s, 'rateLimited'));
    if (text.length > 1000) return context.send(chatId, t(s, 'error'));
    const parsed = parseTelegramInput(text);
    const { command, argument } = parsed;

    if (command === '/start') {
        if (!s.lang) s.lang = telegramLanguage(msg.from && msg.from.language_code) || 'en';
        return context.send(chatId, t(s, 'welcome'), { reply_markup: { keyboard: [['/learn', '/language'], ['/jobs', '/support'], ['/voice', '/text']], resize_keyboard: true } });
    }
    if (command === '/help') return context.send(chatId, t(s, 'help'));
    if (command === '/language' || command === '/lang') {
        const selected = parsed.language;
        if (!selected) return context.send(chatId, t(s, 'languagePrompt'));
        s.lang = selected;
        s.languageExplicit = true;
        return context.send(chatId, t(s, 'languageSet') + '\n' + t(s, 'welcome'));
    }
    if (command === '/en' || command === '/am' || command === '/om' || command === '/ti') {
        s.lang = command.slice(1);
        s.languageExplicit = true;
        return context.send(chatId, t(s, 'languageSet') + '\n' + t(s, 'welcome'));
    }
    if (!command) {
        const plainLanguage = applyTelegramLanguage(s, parsed);
        if (plainLanguage) return context.send(chatId, t(s, 'languageSet') + '\n' + t(s, 'welcome'));
    }
    if (command === '/voice') { s.responseMode = 'voice'; return context.send(chatId, t(s, 'voiceMode')); }
    if (command === '/text') { s.responseMode = 'text'; return context.send(chatId, t(s, 'textMode')); }
    if (command === '/learn') return argument ? handleText(chatId, s, argument, context) : context.send(chatId, t(s, 'learnPrompt'));
    if (command === '/support' || command === '/human') return s.handoff ? context.send(chatId, t(s, 'already')) : consentPrompt(chatId, s, context);
    if (command === '/end' || (command === '/cancel' && s.handoff)) {
        if (!s.handoff) return context.send(chatId, t(s, 'noActive'));
        const h = s.handoff;
        s.handoff = null;
        context.api('POST', `/v1/handoff/${h.id}/close`, {}, h.token).catch(() => { /* best effort */ });
        return context.send(chatId, t(s, 'endedYou'));
    }
    if (s.pendingAccommodation && text.startsWith('/') && text !== '/cancel' && text !== '/accommodation') {
        s.pendingAccommodation = false;
    }
    if (command === '/jobs') {
        try {
            await context.api('POST', '/v1/jobs/subscribe', { channel: 'telegram', contact: String(chatId), lang: s.lang || 'en' });
            const jobs = await context.api('POST', '/v1/chat', {
                message: s.lang === 'am' ? 'የሚገኙ የሥራ መረጃዎችን እና የቃለ መጠይቅ ድጋፍን አሳየኝ።' : 'Show available job information and interview accommodation guidance.',
                lang: s.lang || 'en',
                history: s.history.slice(-4)
            });
            const sources = jobs.citations && jobs.citations.length ? `\n\n${t(s, 'sources')} ${jobs.citations.map((c) => c.title).join('; ')}` : '';
            return sendAnswer(chatId, s, `${jobs.answer}${sources}\n\n${t(s, 'jobsSubscribed')}`, undefined, context);
        }
        catch { return context.send(chatId, t(s, 'error')); }
    }
    if (command === '/unsubscribe') {
        try { await context.api('POST', '/v1/jobs/unsubscribe', { channel: 'telegram', contact: String(chatId) }); return context.send(chatId, t(s, 'jobsUnsubscribed')); }
        catch { return context.send(chatId, t(s, 'error')); }
    }
    if (command === '/accommodation') {
        if (s.handoff) return context.send(chatId, t(s, 'already'));
        s.pendingAccommodation = true;
        return context.send(chatId, t(s, 'accommodationPrompt'));
    }
    if (command === '/cancel') {
        if (s.pendingAccommodation) { s.pendingAccommodation = false; return context.send(chatId, t(s, 'accommodationCancelled')); }
        if (s.pendingConsent) { s.pendingConsent = false; return context.send(chatId, t(s, 'cancelled')); }
        return context.send(chatId, t(s, 'noActive'));
    }

    if (command.startsWith('/')) return context.send(chatId, t(s, 'commandUnknown'));

    if (s.pendingAccommodation) {
        s.pendingAccommodation = false;
        try {
            const r = await context.api('POST', '/v1/accommodations', { request: text, lang: s.lang || 'en' });
            const h = { id: r.id, token: r.token, after: 0 };
            s.handoff = h;
            await context.send(chatId, t(s, 'accommodationWaiting'));
            pollHuman(chatId, s, h, context);
        } catch (e) {
            await context.send(chatId, e.code === 'busy' ? t(s, 'busy') : t(s, 'sentFail'));
        }
        return;
    }

    return handleText(chatId, s, text, context);
}

export async function registerWebhook({ token = TELEGRAM_BOT_TOKEN, baseUrl = BOT_ENV.TELEGRAM_WEBHOOK_URL, path = BOT_ENV.TELEGRAM_WEBHOOK_PATH, secret = BOT_ENV.TELEGRAM_WEBHOOK_SECRET, fetchImpl = fetch, telegramApiBase = 'https://api.telegram.org' } = {}) {
    if (!token) return { ok: false, reason: 'missing_token' };
    if (!baseUrl) return { ok: false, reason: 'missing_base_url' };
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret || '')) return { ok: false, reason: 'invalid_secret' };
    let url;
    try {
        url = new URL(path, baseUrl);
        if (url.protocol !== 'https:') return { ok: false, reason: 'https_required' };
    } catch {
        return { ok: false, reason: 'invalid_url' };
    }
    try {
        const res = await fetchImpl(`${telegramApiBase}/bot${token}/setWebhook`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ url: url.toString(), secret_token: secret })
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data || !data.ok) {
            console.error(`Telegram setWebhook failed with HTTP ${res.status}.`);
            return { ok: false, reason: 'telegram_error' };
        }
        return { ok: true, url: url.toString() };
    } catch {
        console.error('Telegram setWebhook request failed.');
        return { ok: false, reason: 'network_error' };
    }
}

export async function processTelegramWebhook(body, { secret = BOT_ENV.TELEGRAM_WEBHOOK_SECRET, receivedSecret = '', speech } = {}) {
    if (!secret) return { ok: false, reason: 'secret_not_configured' };
    if (!receivedSecret || !safeEqual(receivedSecret, secret)) return { ok: false, reason: 'unauthorized' };
    if (!body || !Number.isInteger(body.update_id)) {
        return { ok: false, reason: 'empty_update' };
    }
    try {
        await defaultRuntime.processUpdate(body, speech ? { speech } : {});
        return { ok: true };
    } catch {
        console.error('Telegram update processing failed.');
        return { ok: false, reason: 'processing_error' };
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
                defaultRuntime.processUpdate(u).catch(() => {
                    console.error('Telegram update processing failed.');
                    const chatId = u.message && u.message.chat ? u.message.chat.id :
                        u.callback_query && u.callback_query.message && u.callback_query.message.chat ? u.callback_query.message.chat.id : null;
                    if (chatId) defaultRuntime.send(chatId, t(defaultRuntime.getSession(chatId), 'error')).catch(() => {});
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
}