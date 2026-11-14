import { detectLang } from '../retrieval/tokenize.js';

// Kept short and plain for SMS: no markup, no emoji reliance, works on a
// basic feature phone. Commands are plain words so they work with any
// gateway and any phone, no special characters required.
const STRINGS = {
    en: {
        welcome: 'Hi! Ask a question about your course. Reply HUMAN for a person, JOBS for job alerts, ACCOMMODATION for interview help, EN or AM to change language.',
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
        welcome: 'ሰላም! ስለ ኮርስዎ ይጠይቁ። ሰው ለማግኘት HUMAN፣ ለስራ ማስታወቂያ JOBS፣ ለቃለ መጠይቅ ድጋፍ ACCOMMODATION፣ ቋንቋ ለመቀየር EN ወይም AM ይላኩ።',
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
        jobsSubscribed: 'ለስራ ማስታወቂያዎች በጽሑፍ ተመዝግበዋል። ለማቆም STOP ይላኩ።',
        jobsUnsubscribed: 'ከዚህ በኋላ የስራ ማስታወቂያ አይደርስዎትም።',
        accommodationPrompt: 'ለቃለ መጠይቅ ምን እንደሚያስፈልግዎ ይግለጹ (ለምሳሌ፦ ተጨማሪ ጊዜ፣ የምልክት ቋንቋ አስተርጓሚ፣ ወይም ጸጥ ያለ ክፍል)። የህክምና ሁኔታ መግለጽ አያስፈልግም። ለመሰረዝ CANCEL ይላኩ።',
        accommodationCancelled: 'እሺ፣ ምንም ጥያቄ አልተላከም።',
        accommodationWaiting: 'ጥያቄዎ ለሰው ተልኳል። እዚህ ሊጽፉልዎት ይችላሉ። ለማቆም END ይላኩ።'
    }
};

export function createSmsRuntime({ chat, store, jobStore, sendOutbound }) {
    const sessions = new Map();
    function session(phone) {
        let s = sessions.get(phone);
        if (!s) { s = { lang: null, history: [], handoff: null, pendingConsent: false, pendingAccommodation: false, pendingQuestion: '' }; sessions.set(phone, s); }
        return s;
    }
    const t = (s, key) => STRINGS[s.lang || 'en'][key];

    // Long-held wait on the same store Steps 3-4 built, but called directly
    // in-process: no HTTP round trip, no separate process, no rate limit.
    async function pollHuman(phone, s, h) {
        let fails = 0;
        while (s.handoff === h) {
            let sessionObj;
            try { sessionObj = store.get(h.id); }
            catch (e) { s.handoff = null; await sendOutbound(phone, t(s, 'lost')); return; }
            try {
                await store.wait(sessionObj, h.after, 20000);
            } catch (e) {
                fails += 1;
                if (fails >= 5) { s.handoff = null; await sendOutbound(phone, t(s, 'lost')); return; }
                continue;
            }
            if (s.handoff !== h) return;
            const view = store.viewForLearner(sessionObj, h.after);
            for (const m of view.messages) {
                h.after = Math.max(h.after, m.id);
                if (m.from === 'agent') await sendOutbound(phone, m.text);
                else if (m.code === 'agent_joined') await sendOutbound(phone, t(s, 'joined'));
                else if (m.code === 'closed_by_agent') { s.handoff = null; await sendOutbound(phone, t(s, 'closedAgent')); return; }
            }
            if (view.status === 'closed') { s.handoff = null; return; }
        }
    }

    async function startHuman(phone, s) {
        try {
            const r = store.create({ question: s.pendingQuestion, transcript: s.history.slice(-10), lang: s.lang || 'en' });
            const h = { id: r.id, token: r.token, after: 0 };
            s.handoff = h;
            await sendOutbound(phone, t(s, 'waiting'));
            pollHuman(phone, s, h); // not awaited: runs in the background
        } catch (e) {
            await sendOutbound(phone, e.code === 'busy' ? t(s, 'busy') : t(s, 'sentFail'));
        }
    }

    async function handleInbound({ from, text }) {
        const phone = String(from || '').trim();
        const raw = String(text || '').trim();
        if (!phone || !raw) return;
        const s = session(phone);
        const word = raw.toUpperCase();

        if (word === 'EN') { s.lang = 'en'; return sendOutbound(phone, t(s, 'welcome')); }
        if (word === 'AM') { s.lang = 'am'; return sendOutbound(phone, t(s, 'welcome')); }
        if (word === 'JOBS' && jobStore) { jobStore.subscribe({ channel: 'sms', contact: phone, lang: s.lang || 'en' }); return sendOutbound(phone, t(s, 'jobsSubscribed')); }
        if ((word === 'UNSUBSCRIBE' || (word === 'STOP' && !s.handoff)) && jobStore) { jobStore.unsubscribe({ channel: 'sms', contact: phone }); return sendOutbound(phone, t(s, 'jobsUnsubscribed')); }
        if (s.pendingAccommodation) {
            s.pendingAccommodation = false;
            if (word === 'CANCEL') return sendOutbound(phone, t(s, 'accommodationCancelled'));
            try {
                const r = store.create({ question: raw, transcript: [], lang: s.lang || 'en', kind: 'accommodation' });
                const h = { id: r.id, token: r.token, after: 0 };
                s.handoff = h;
                await sendOutbound(phone, t(s, 'accommodationWaiting'));
                pollHuman(phone, s, h);
            } catch (e) {
                await sendOutbound(phone, t(s, 'sentFail'));
            }
            return;
        }
        if (word === 'ACCOMMODATION') {
            if (s.handoff) return sendOutbound(phone, t(s, 'escalateHint'));
            s.pendingAccommodation = true;
            return sendOutbound(phone, t(s, 'accommodationPrompt'));
        }

        if (s.handoff) {
            if (word === 'END') {
                const h = s.handoff;
                s.handoff = null;
                try { store.close(store.get(h.id), 'learner'); } catch (e) { /* already gone */ }
                return sendOutbound(phone, t(s, 'endedYou'));
            }
            try { store.learnerSay(store.get(s.handoff.id), raw); }
            catch (e) { s.handoff = null; return sendOutbound(phone, t(s, 'lost')); }
            return;
        }

        if (s.pendingConsent) {
            s.pendingConsent = false;
            if (word === 'YES') return startHuman(phone, s);
            return sendOutbound(phone, t(s, 'cancelled'));
        }

        if (word === 'HUMAN') { s.pendingConsent = true; return sendOutbound(phone, t(s, 'consent')); }

        const lang = s.lang || detectLang(raw);
        let data;
        try { data = await chat({ message: raw, lang, history: s.history.slice(-4) }); }
        catch (e) { return sendOutbound(phone, t(s, 'error')); }
        s.history.push({ role: 'user', content: raw });
        s.history.push({ role: 'assistant', content: data.answer });
        s.pendingQuestion = raw;
        return sendOutbound(phone, data.answer + (data.escalate ? t(s, 'escalateHint') : ''));
    }

    return { handleInbound };
}