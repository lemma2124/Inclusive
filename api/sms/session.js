import { detectChannelLanguage, parseChannelLanguage, smsEncoding } from './language.js';

// Kept short and plain for SMS: no markup, no emoji reliance, works on a
// basic feature phone. Commands are plain words so they work with any
// gateway and any phone, no special characters required.
const STRINGS = {
    en: {
        welcome: 'Welcome to INCLUSIVE! Ask a question about your course. Reply HUMAN for a person, JOBS for job alerts, ACCOMMODATION for interview help, EN or AM to change language.',
        help: 'INCLUSIVE: LEARN asks a course question; JOBS lists local job information; SUPPORT requests a person; LANGUAGE changes language; ALERTS subscribes to job alerts; STOP stops optional alerts; HELP shows this menu.',
        languagePrompt: 'Choose a language: ENGLISH, AMHARIC, AFAAN OROMOO, or TIGRINYA.',
        languageSet: 'Language preference updated.',
        learnPrompt: 'Send your question about the course. Current course answers are available in English and Amharic.',
        unsupportedChat: 'Course answers are currently available in English and Amharic only. Reply ENGLISH or AMHARIC to continue.',
        languageUnclear: 'I could not identify the language. Reply LANGUAGE, then choose ENGLISH, AMHARIC, AFAAN OROMOO, or TIGRINYA.',
        alertsSubscribed: 'Job alerts are on. Reply STOP to turn them off.',
        stopped: 'Optional messages stopped. Reply START to use this SMS service again.',
        resumed: 'SMS service resumed. Reply HELP to see commands.',
        rateLimited: 'Too many messages. Please wait a minute and try again.',
        invalidMessage: 'Please send a text message of 1 to 1000 characters.',
        consent: 'A person can help you. They will see your questions and answers from this chat. Do not share passwords or ID numbers. Reply YES to continue, or anything else to cancel.',
        cancelled: 'OK. You can keep asking questions.',
        waiting: 'Request sent. Please wait for a person. What you text now goes to them. Reply END to stop.',
        joined: 'A person has joined the chat.',
        closedAgent: 'The person ended the chat. You can keep asking questions.',
        endedYou: 'You ended the chat with the person. You can keep asking questions.',
        lost: 'Connection to the person was lost. Reply HUMAN to try again.',
        busy: 'Support is very busy right now. Please try again later.',
        sentFail: 'Could not connect you to a person right now. Please try again later.',
        error: 'Sorry, could not get an answer right now. Please try again.',
        escalateHint: ' Reply HUMAN to talk to a person.',
        jobsSubscribed: 'You are now subscribed to job alerts by text. Reply STOP to unsubscribe at any time.',
        jobsUnsubscribed: 'You will no longer receive job alerts.',
        accommodationPrompt: 'Please describe what you need for your interview (for example: more time, a sign language interpreter, or a quiet room). You do not need to state a medical condition. Reply CANCEL to stop.',
        accommodationCancelled: 'OK, no request was sent.',
        accommodationWaiting: 'Your request was sent to a person. They may text you here. Reply END to stop.'
    },
    am: {
        welcome: 'ወደ INCLUSIVE እንኳን በደህና መጡ! ስለ ኮርስዎ ይጠይቁ። ሰው ለማግኘት HUMAN፣ ለስራ ማስታወቂያ JOBS፣ ለቃለ መጠይቅ ድጋፍ ACCOMMODATION፣ ቋንቋ ለመቀየር EN ወይም AM ይላኩ።',
        help: 'INCLUSIVE፦ የኮርስ ጥያቄ LEARN፣ የሥራ መረጃ JOBS፣ ሰው ለማግኘት SUPPORT፣ ቋንቋ LANGUAGE፣ ማስታወቂያ ለመመዝገብ ALERTS፣ ለማቆም STOP፣ ይህን ዝርዝር ለማየት HELP ይላኩ።',
        languagePrompt: 'ቋንቋ ይምረጡ፦ ENGLISH፣ AMHARIC፣ AFAAN OROMOO ወይም TIGRINYA።',
        languageSet: 'ቋንቋ ተቀይሯል።',
        learnPrompt: 'ስለ ኮርሱ ጥያቄዎን ይላኩ። የኮርስ መልሶች በአማርኛ እና በእንግሊዝኛ ይገኛሉ።',
        unsupportedChat: 'የኮርስ መልሶች አሁን በአማርኛ እና በእንግሊዝኛ ብቻ ይገኛሉ። ለመቀጠል AMHARIC ወይም ENGLISH ይላኩ።',
        languageUnclear: 'ቋንቋውን መለየት አልቻልኩም። LANGUAGE ብለው ከዚያ ENGLISH፣ AMHARIC፣ AFAAN OROMOO ወይም TIGRINYA ይምረጡ።',
        alertsSubscribed: 'የሥራ ማስታወቂያዎች ተጀምረዋል። ለማቆም STOP ይላኩ።',
        stopped: 'አማራጭ መልዕክቶች ቆመዋል። ይህን የSMS አገልግሎት እንደገና ለመጠቀም START ይላኩ።',
        resumed: 'የSMS አገልግሎቱ ቀጥሏል። ትዕዛዞችን ለማየት HELP ይላኩ።',
        rateLimited: 'ብዙ መልዕክቶች ተልከዋል። እባክዎ ቆይተው ይሞክሩ።',
        invalidMessage: 'እባክዎ ከ1 እስከ 1000 ቁምፊ ያለው መልዕክት ይላኩ።',
        consent: 'አንድ ሰው ሊረዳዎት ይችላል። የዚህን ውይይት ጥያቄና መልስ ያያል። የይለፍ ቃል ወይም መታወቂያ ቁጥር አይላኩ። ለመቀጠል YES ይላኩ፣ ለመሰረዝ ሌላ ነገር ይላኩ።',
        cancelled: 'እሺ። መጠየቅ መቀጠል ይችላሉ።',
        waiting: 'ጥያቄው ተልኳል። ሰው እስኪመጣ ይጠብቁ። የሚልኩት ለእሱ ይደርሳል። ለማቆም END ይላኩ።',
        joined: 'አንድ ሰው ተቀላቅሏል።',
        closedAgent: 'ሰውየው ዘግቷል። መጠየቅ መቀጠል ይችላሉ።',
        endedYou: 'ውይይቱን አቁመዋል። መጠየቅ መቀጠል ይችላሉ።',
        lost: 'ግንኙነቱ ተቋርጧል። HUMAN ብለው እንደገና ይሞክሩ።',
        busy: 'አሁን አገልግሎቱ ተጨናንቋል። ቆይተው ይሞክሩ።',
        sentFail: 'አሁን ማገናኘት አልተቻለም። ቆይተው ይሞክሩ።',
        error: 'ይቅርታ፣ አሁን መልስ አልተገኘም። እንደገና ይሞክሩ።',
        escalateHint: ' ሰው ለማግኘት HUMAN ይላኩ።',
        jobsSubscribed: 'የስራ ማስታወቂያ ተጀምሯል። ለማቆም STOP ይላኩ።',
        jobsUnsubscribed: 'ከዚህ በኋላ የስራ ማስታወቂያ አይደርስዎትም።',
        accommodationPrompt: 'ለቃለ መጠይቅ ምን እንደሚያስፈልግዎ ይግለጹ (ለምሳሌ፦ ተጨማሪ ጊዜ፣ የምልክት ቋንቋ አስተርጓሚ፣ ወይም ጸጥ ያለ ክፍል)። የህክምና ሁኔታ መግለጽ አያስፈልግም። ለመሰረዝ CANCEL ይላኩ።',
        accommodationCancelled: 'እሺ፣ ምንም ጥያቄ አልተላከም።',
        accommodationWaiting: 'ጥያቄዎ ለሰው ተልኳል። እዚህ ሊጽፉልዎት ይችላሉ። ለማቆም END ይላኩ።'
    },
    om: {
        welcome: 'Baga gara INCLUSIVE dhuftan! Gaaffii barnootaa gaafadhaa. LEARN, JOBS, SUPPORT, LANGUAGE, HELP yookaan STOP ergaa.',
        help: 'INCLUSIVE: LEARN gaaffii barnootaa; JOBS odeeffannoo hojii; SUPPORT nama; LANGUAGE afaan jijjiiri; ALERTS beeksisa hojii; STOP ergaa dabalataa dhaabi; HELP ajaja agarsiisi.',
        languagePrompt: 'Afaan filadhaa: ENGLISH, AMHARIC, AFAAN OROMOO, yookaan TIGRINYA.',
        languageSet: 'Afaan Oromo filatame.',
        learnPrompt: 'Gaaffii barnootaa keessan ergaa. Deebiin barnootaa yeroo ammaa Afaan Oromoo fi Tigrinya hin deeggaru.',
        unsupportedChat: 'Deebiin barnootaa yeroo ammaa Afaan Ingiliffaa fi Afaan Amaaraa qofa irratti jira. Itti fufuuf ENGLISH yookaan AMHARIC ergaa.',
        languageUnclear: 'Afaan ergaa keessanii mirkaneessuu hin dandeenye. LANGUAGE ergaa, achiis afaan filadhaa.',
        alertsSubscribed: 'Beeksisni hojii ni dhufa. Dhaabuuf STOP ergaa.',
        stopped: 'Ergaan filannoo dhaabbateera. Tajaajila kana deebisuuf START ergaa.',
        resumed: 'Tajaajilli SMS deebiʼeera. Ajaja ilaaluuf HELP ergaa.',
        rateLimited: 'Ergaa baayʼee ergitaniittu. Xiqqoo eegaa, irra deebiʼaa.',
        invalidMessage: 'Ergaa qubee 1 hanga 1000 qabu ergaa.',
        consent: 'Namni tokko isin gargaaruu dandaʼa. Itti fufnaan, haasawa keessan ni arga. Iccitii hin erginaa. Itti fufuuf YES, dhiisuuf NO ergaa.',
        cancelled: 'Tole. Gaaffii keessan itti fufuu dandeessu.',
        waiting: 'Gaaffiin keessan nama deeggarsaaf ergameera. Deebii nama sanaaf ergitu. Dhaabuuf END ergaa.',
        joined: 'Namni deeggarsa kennu haasawa seeneera.',
        closedAgent: 'Namni deeggarsa kennu haasawa cufeera.',
        endedYou: 'Haasawa nama waliin taasiftan cufteessaniittu.',
        lost: 'Walqunnamtiin citeera. Deebisanii yaaluuf SUPPORT ergaa.',
        busy: 'Deeggarsi yeroo ammaa baayʼee hojii qaba. Booda irra deebiʼaa.',
        sentFail: 'Nama waliin isin walqunnamsiisuu hin dandeenye. Booda irra deebiʼaa.',
        error: 'Deebii argachuu hin dandeenye. Irra deebiʼaa yookaan SUPPORT ergaa.',
        escalateHint: ' Nama waliin haasaʼuuf SUPPORT ergaa.',
        jobsUnsubscribed: 'Beeksisni hojii ni dhaabbate.',
        accommodationPrompt: 'Deeggarsa afeerraa hojii irratti isin barbaachisu ibsaa. Haala fayyaa ibsuun hin barbaachisu. Dhiisuuf CANCEL ergaa.',
        accommodationCancelled: 'Tole. Gaaffiin hin ergamne.',
        accommodationWaiting: 'Gaaffiin keessan deeggarsaaf ergameera.',
        jobsSubscribed: 'Beeksisni hojii ni dhufa. Dhaabuuf STOP ergaa.'
    },
    ti: {
        welcome: 'ናብ INCLUSIVE ብደሓን መጻእኩም! ሕቶ ትምህርቲ ሕተቱ። LEARN፣ JOBS፣ SUPPORT፣ LANGUAGE፣ HELP ወይ STOP ስደዱ።',
        help: 'INCLUSIVE፦ LEARN ሕቶ ትምህርቲ፣ JOBS ሓበሬታ ስራሕ፣ SUPPORT ሰብ ሓገዝ፣ LANGUAGE ቋንቋ ምቕያር፣ ALERTS ምዝገባ ስራሕ፣ STOP ኣማራጺ መልእኽቲ ምቁራጽ፣ HELP ትእዛዛት።',
        languagePrompt: 'ቋንቋ ምረጹ፦ ENGLISH፣ AMHARIC፣ AFAAN OROMOO ወይ TIGRINYA።',
        languageSet: 'ትግርኛ ተመሪጹ።',
        learnPrompt: 'ሕቶ ትምህርትኹም ስደዱ። ናይ ትምህርቲ መልሲ ኣብዚ እዋን ብትግርኛ ኣይድገፍን።',
        unsupportedChat: 'ናይ ትምህርቲ መልሲ ኣብዚ እዋን ብእንግሊዝኛን ብኣማርኛን ጥራይ እዩ። ንምቕጻል ENGLISH ወይ AMHARIC ስደዱ።',
        languageUnclear: 'ቋንቋ መልእኽትኹም ኣይተፈለጠን። LANGUAGE ስደዱ፣ ድሕሪኡ ቋንቋ ምረጹ።',
        alertsSubscribed: 'ናይ ስራሕ ሓበሬታ ክመጸኩም እዩ። ንምቁራጽ STOP ስደዱ።',
        stopped: 'ኣማራጺ መልእኽቲ ተቋሪጹ። እዚ ኣገልግሎት ንምቕጻል START ስደዱ።',
        resumed: 'ኣገልግሎት SMS ተጀሚሩ። ትእዛዛት ንምርኣይ HELP ስደዱ።',
        rateLimited: 'ብዙሕ መልእኽቲ ሰዲድኩም። ቁሩብ ተጸበዩ።',
        invalidMessage: 'በጃኹም ካብ 1 ክሳብ 1000 ፊደል ዘለዎ መልእኽቲ ስደዱ።',
        consent: 'ሓደ ሰብ ክሕግዘኩም ይኽእል። እንተቐጺልኩም እዚ ዝርርብ ክርኢ እዩ። ምስጢር ኣይትስደዱ። ንምቕጻል YES፣ ንምስራዝ NO ስደዱ።',
        cancelled: 'ጽቡቕ። ሕቶኹም ክትቅጽሉ ትኽእሉ።',
        waiting: 'ሕቶኹም ናብ ሓገዝ ተላኢኹ። END ንምቁራጽ ስደዱ።',
        joined: 'ሓጋዚ ሰብ ኣብ ዝርርብ ተጸንቢሩ።',
        closedAgent: 'ሓጋዚ ሰብ ዝርርብ ዓጽዩ።',
        endedYou: 'እቲ ዝርርብ ዓጺኹሞ።',
        lost: 'ርክብ ተቋሪጹ። SUPPORT ስደዱ።',
        busy: 'ኣገልግሎት ሓገዝ ሕጂ ተጸሚዱ ኣሎ።',
        sentFail: 'ምስ ሰብ ሓገዝ ከነራኽበኩም ኣይከኣልናን።',
        error: 'መልሲ ክንረክብ ኣይከኣልናን። ደጊምኩም ፈትኑ።',
        escalateHint: ' ሰብ ሓገዝ ንምርካብ SUPPORT ስደዱ።',
        jobsUnsubscribed: 'ናይ ስራሕ ሓበሬታ ተቋሪጹ።',
        accommodationPrompt: 'ኣብ ቃለ መሕትት እንታይ ሓገዝ ከም ዘድልየኩም ግለጹ። ኩነታት ጥዕና ምንጋር ኣየድልን።',
        accommodationCancelled: 'ጽቡቕ። ሕቶ ኣይተላእከን።',
        accommodationWaiting: 'ሕቶኹም ናብ ሓገዝ ተላኢኹ።',
        jobsSubscribed: 'ሓበሬታ ስራሕ ክመጸኩም እዩ። STOP ንምቁራጽ ስደዱ።'
    }
};

export function createSmsRuntime({ chat, store, jobStore, sendOutbound, maxPerMinute = 20, now = Date.now }) {
    const sessions = new Map();
    const processed = new Map();
    const limits = new Map();
    const dedupeWindowMs = 10 * 60 * 1000;

    function normalizePhone(value) {
        const raw = String(value || '').trim();
        if (!/^\+?[\d\s().-]+$/.test(raw)) return '';
        const digits = raw.replace(/\D/g, '');
        return digits.length < 7 || digits.length > 15 ? '' : `${raw.startsWith('+') ? '+' : ''}${digits}`;
    }

    function session(phone) {
        let s = sessions.get(phone);
        if (!s) {
            s = { lang: null, languageExplicit: false, history: [], handoff: null, pendingConsent: false, pendingAccommodation: false, pendingQuestion: '', optedOut: false };
            sessions.set(phone, s);
        }
        return s;
    }
    const t = (s, key) => (STRINGS[s.lang] || STRINGS.en)[key];

    const t = (s, key) => STRINGS[s.lang || 'en'][key] || STRINGS.en[key] || '';

    async function deliver(phone, text) {
        try {
            const metadata = smsEncoding(text);
            await sendOutbound(phone, text, metadata);
            return true;
        } catch (error) {
            console.error('SMS delivery failed:', error && error.message ? error.message : 'unknown error');
            return false;
        }
    }

    function isLimited(phone) {
        const time = now();
        let entry = limits.get(phone);
        if (!entry || time - entry.startedAt >= 60000) {
            entry = { startedAt: time, count: 0 };
            limits.set(phone, entry);
        }
        entry.count += 1;
        return entry.count > maxPerMinute;
    }

    function isDuplicate(phone, messageId) {
        if (!messageId) return false;
        const time = now();
        for (const [key, seenAt] of processed) if (time - seenAt > dedupeWindowMs) processed.delete(key);
        const key = `${phone}:${messageId}`;
        return processed.has(key);
    }

    function rememberMessage(phone, messageId) {
        if (!messageId) return;
        processed.set(`${phone}:${messageId}`, now());
        if (processed.size > 5000) processed.delete(processed.keys().next().value);
    }

    async function answerFromKnowledge(phone, s, message, lang) {
        if (lang !== 'en' && lang !== 'am') return deliver(phone, t(s, 'unsupportedChat'));
        try {
            const data = await chat({ message, lang, history: s.history.slice(-4) });
            s.history.push({ role: 'user', content: message });
            s.history.push({ role: 'assistant', content: data.answer });
            s.pendingQuestion = message;
            return deliver(phone, data.answer + (data.escalate ? t(s, 'escalateHint') : ''));
        } catch {
            return deliver(phone, t(s, 'error'));
        }
    }

    async function pollHuman(phone, s, h) {
        let fails = 0;
        while (s.handoff === h) {
            let sessionObj;
            try { sessionObj = store.get(h.id); }
            catch { s.handoff = null; await deliver(phone, t(s, 'lost')); return; }
            try { await store.wait(sessionObj, h.after, 20000); }
            catch {
                fails += 1;
                if (fails >= 5) { s.handoff = null; await deliver(phone, t(s, 'lost')); return; }
                continue;
            }
            if (s.handoff !== h) return;
            const view = store.viewForLearner(sessionObj, h.after);
            for (const m of view.messages) {
                h.after = Math.max(h.after, m.id);
                if (m.from === 'agent') await deliver(phone, m.text);
                else if (m.code === 'agent_joined') await deliver(phone, t(s, 'joined'));
                else if (m.code === 'closed_by_agent') { s.handoff = null; await deliver(phone, t(s, 'closedAgent')); return; }
            }
            if (view.status === 'closed') { s.handoff = null; return; }
        }
    }

    async function startHuman(phone, s) {
        try {
            const r = store.create({ question: s.pendingQuestion, transcript: s.history.slice(-10), lang: s.lang || 'en' });
            const h = { id: r.id, token: r.token, after: 0 };
            s.handoff = h;
            if (!await deliver(phone, t(s, 'waiting'))) {
                s.handoff = null;
                try { store.close(store.get(h.id), 'learner'); } catch { /* already removed */ }
                return { accepted: false, reason: 'sms_delivery_failed' };
            }
            pollHuman(phone, s, h);
            return { accepted: true };
        } catch (error) {
            await deliver(phone, t(s, error.code === 'busy' ? 'busy' : 'sentFail'));
            return { accepted: false, reason: error.code || 'handoff_failed' };
        }
    }

    async function createAccommodation(phone, s, request) {
        try {
            const r = store.create({ question: request, transcript: [], lang: s.lang || 'en', kind: 'accommodation' });
            const h = { id: r.id, token: r.token, after: 0 };
            s.handoff = h;
            if (!await deliver(phone, t(s, 'accommodationWaiting'))) {
                s.handoff = null;
                try { store.close(store.get(h.id), 'learner'); } catch { /* already removed */ }
                return { accepted: false, reason: 'sms_delivery_failed' };
            }
            pollHuman(phone, s, h);
            return { accepted: true };
        } catch (error) {
            await deliver(phone, t(s, error.code === 'busy' ? 'busy' : 'sentFail'));
            return { accepted: false, reason: error.code || 'handoff_failed' };
        }
    }

    async function processInbound({ from, text, messageId }) {
        const phone = normalizePhone(from);
        if (!phone) return { accepted: false, reason: 'invalid_sender' };
        const raw = typeof text === 'string' ? text.trim().normalize('NFC') : '';
        if (!raw) return { accepted: false, reason: 'empty_message' };
        if (raw.length > 1000) {
            await deliver(phone, t(session(phone), 'invalidMessage'));
            return { accepted: false, reason: 'message_too_long' };
        }
        const s = session(phone);
        const word = raw.toUpperCase();
        if (word === 'LANGUAGE' || word === 'LANG') return { accepted: await deliver(phone, t(s, 'languagePrompt')) };
        if (word === 'START') {
            s.optedOut = false;
            return { accepted: await deliver(phone, t(s, 'resumed')) };
        }
        if (word === 'STOP') {
            s.optedOut = true;
            s.pendingConsent = false;
            s.pendingAccommodation = false;
            if (s.handoff) {
                try { store.close(store.get(s.handoff.id), 'learner'); } catch { /* already closed */ }
                s.handoff = null;
            }
            if (jobStore) jobStore.unsubscribe({ channel: 'sms', contact: phone });
            return { accepted: await deliver(phone, t(s, 'stopped')) };
        }
        if (s.optedOut) return { accepted: false, reason: 'opted_out' };
        const lang = parseChannelLanguage(raw);
        if (lang) {
            s.lang = lang;
            s.languageExplicit = true;
            return { accepted: await deliver(phone, t(s, 'languageSet')), language: lang };
        }
        if (isLimited(phone) && word !== 'HELP') {
            await deliver(phone, t(s, 'rateLimited'));
            return { accepted: false, reason: 'rate_limited' };
        }
        if (word === 'HELP') return { accepted: await deliver(phone, t(s, 'help')) };
        if (word === 'LEARN') return { accepted: await deliver(phone, t(s, 'learnPrompt')) };
        if (word === 'ALERTS' || word === 'SUBSCRIBE') {
            if (jobStore) jobStore.subscribe({ channel: 'sms', contact: phone, lang: s.lang === 'am' ? 'am' : 'en' });
            return { accepted: await deliver(phone, t(s, 'alertsSubscribed')) };
        }
        if (word === 'UNSUBSCRIBE') {
            if (jobStore) jobStore.unsubscribe({ channel: 'sms', contact: phone });
            return { accepted: await deliver(phone, t(s, 'jobsUnsubscribed')) };
        }
        if (word === 'JOBS') {
            const detected = detectChannelLanguage(raw);
            const selected = s.languageExplicit ? s.lang : (detected || s.lang);
            if (!selected) return { accepted: await deliver(phone, t(s, 'languageUnclear')) };
            s.lang = selected;
            const query = selected === 'am'
                ? 'የሚገኙ የሥራ መረጃዎችን እና የቃለ መጠይቅ ድጋፍን አሳየኝ።'
                : 'Show available job information and interview support.';
            return { accepted: await answerFromKnowledge(phone, s, query, selected) };
        }

        if (s.pendingAccommodation) {
            s.pendingAccommodation = false;
            if (word === 'CANCEL') return { accepted: await deliver(phone, t(s, 'accommodationCancelled')) };
            return createAccommodation(phone, s, raw);
        }
        if (word === 'ACCOMMODATION') {
            if (s.handoff) return { accepted: await deliver(phone, t(s, 'escalateHint')) };
            s.pendingAccommodation = true;
            return { accepted: await deliver(phone, t(s, 'accommodationPrompt')) };
        }
        if (s.handoff) {
            if (word === 'END') {
                const h = s.handoff;
                s.handoff = null;
                try { store.close(store.get(h.id), 'learner'); } catch { /* already closed */ }
                return { accepted: await deliver(phone, t(s, 'endedYou')) };
            }
            try { store.learnerSay(store.get(s.handoff.id), raw); return { accepted: true }; }
            catch { s.handoff = null; return { accepted: await deliver(phone, t(s, 'lost')) }; }
        }
        if (s.pendingConsent) {
            s.pendingConsent = false;
            if (word === 'YES') return startHuman(phone, s);
            return { accepted: await deliver(phone, t(s, 'cancelled')) };
        }
        if (word === 'SUPPORT' || word === 'HUMAN') {
            s.pendingConsent = true;
            return { accepted: await deliver(phone, t(s, 'consent')) };
        }

        const detected = detectChannelLanguage(raw);
        if (detected && !s.languageExplicit) s.lang = detected;
        const selected = s.lang || detected;
        if (!selected) return { accepted: await deliver(phone, t(s, 'languageUnclear')) };
        if (!s.lang) s.lang = selected;
        return { accepted: await answerFromKnowledge(phone, s, raw, selected) };
    }

    async function handleInbound(input) {
        const phone = normalizePhone(input && input.from);
        const idValue = input && input.messageId;
        const messageId = idValue === undefined || idValue === null ? '' : String(idValue).trim();
        if (messageId.length > 128) return { accepted: false, reason: 'invalid_message_id' };
        if (phone && isDuplicate(phone, messageId)) return { accepted: true, duplicate: true };
        const result = await processInbound({ ...input, messageId });
        if (phone && result && result.accepted) rememberMessage(phone, messageId);
        return result;
    }

    return { handleInbound, getSession: (phone) => sessions.get(normalizePhone(phone)) || null };
}