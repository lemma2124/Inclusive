/*! inclusive-assistant v1.3.0 | MIT | vanilla JS, no dependencies */
(function () {
  'use strict';
  if (typeof window === 'undefined' || !window.customElements) { return; }
  if (window.customElements.get('inclusive-assistant')) { return; }

  var VERSION = '1.3.0';

  var SCRIPT_ORIGIN = '';
  try {
    if (document.currentScript && document.currentScript.src) {
      SCRIPT_ORIGIN = new URL(document.currentScript.src).origin;
    }
  } catch (e) { /* ignore */ }

  var SPEECH_LANG = { en: 'en-US', am: 'am-ET' };
  var ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

  var STRINGS = {
    en: {
      heading: 'Inclusive Assistant',
      welcome: 'Hello! Ask me anything about your course. You can type in English or Amharic.',
      conversation: 'Conversation',
      langGroup: 'Language',
      label: 'Type your question',
      hint: 'Press Enter to send. Press Shift and Enter together for a new line.',
      send: 'Send',
      mic: 'Ask by voice',
      listening: 'Listening…',
      heard: 'Heard you. Check the text, then send.',
      thinking: 'Looking for an answer…',
      sources: 'Sources',
      readAloud: 'Read aloud',
      human: 'Talk to a person',
      humanConsent: 'A person can help you. If you continue, they will see your questions and answers from this chat. Please do not share passwords or ID numbers.',
      humanYes: 'Yes, connect me',
      humanNo: 'No, thanks',
      humanCancelled: 'OK. You can keep asking the assistant.',
      humanAlready: 'You are already connected to a person.',
      connecting: 'Connecting you…',
      humanWaiting: 'Your request was sent. Please wait for a person to join. What you type now goes to that person.',
      humanJoined: 'A person has joined the chat.',
      humanClosedAgent: 'The person ended the chat. You can keep asking the assistant.',
      humanEndedYou: 'You ended the chat with the person. You can keep asking the assistant.',
      humanLost: 'The connection to the person was lost. Please try again.',
      humanMode: 'You are talking with a person',
      humanEnd: 'End chat with the person',
      humanSendFail: 'Your message was not sent. Please try again.',
      humanBusy: 'Support is very busy right now. Please try again later.',
      humanSent: 'I could not connect you to a person right now. Please contact your support team.',
      humanIntro: 'You can reach a person here:',
      humanLink: 'Open the support page',
      agentWho: 'Support person:',
      you: 'You:',
      assistant: 'Assistant:',
      error: 'Sorry, I could not get an answer right now. Please try again.',
      rateLimited: 'Too many questions at once. Please wait a minute and try again.',
      micUnsupported: 'Voice input does not work on this device or browser. Please type your question.',
      micDenied: 'Microphone permission was not given.',
      micNoSpeech: 'I did not hear anything. Please try again.',
      micLangUnsupported: 'This device does not support voice input in this language. Please type your question.',
      micNetwork: 'Voice input needs an internet connection. Please type your question.',
      ttsUnsupported: 'Reading aloud does not work on this device.',
      ttsNoVoice: 'This device has no voice for this language. Please read the text.',
      shareScreen: 'Share my screen',
      stopShare: 'Stop sharing',
      sharing: 'Sharing your screen with the person. Use your browser\u2019s own sharing control to stop at any time.',
      shareUnsupported: 'Screen sharing does not work on this device or browser.',
      shareFailed: 'Screen sharing could not start. This can happen on some networks. Please try again, or describe the problem in words.',
      shareEndedByYou: 'You stopped sharing your screen.',
      shareStoppedDevice: 'Screen sharing stopped.',
      accommodation: 'Request interview accommodations',
      accommodationPrompt: 'Please describe what you need for an interview (for example: more time, a sign language interpreter, or a quiet room). You do not need to state a medical condition. Then press Send.',
      accommodationWaiting: 'Your request was sent to a person. They may message you here.'
    },
    am: {
      heading: 'አካታች ረዳት',
      welcome: 'ሰላም! ስለ ኮርሱ ማንኛውንም ጥያቄ ይጠይቁኝ። በአማርኛ ወይም በእንግሊዝኛ መጻፍ ይችላሉ።',
      conversation: 'ውይይት',
      langGroup: 'ቋንቋ',
      label: 'ጥያቄዎን ይጻፉ',
      hint: 'ለመላክ Enter ይጫኑ። አዲስ መስመር ለመጀመር Shift እና Enter አብረው ይጫኑ።',
      send: 'ላክ',
      mic: 'በድምፅ ይጠይቁ',
      listening: 'እየሰማሁ ነው…',
      heard: 'ሰምቻለሁ። ጽሑፉን ይመልከቱ፣ ከዚያ ይላኩ።',
      thinking: 'መልስ እየፈለግሁ ነው…',
      sources: 'ምንጮች',
      readAloud: 'በድምፅ አንብብ',
      human: 'ሰው ያነጋግሩ',
      humanConsent: 'አንድ ሰው ሊረዳዎት ይችላል። ከቀጠሉ፣ በዚህ ውይይት ውስጥ ያሉትን ጥያቄዎችዎን እና መልሶቹን ያያሉ። እባክዎ የይለፍ ቃል ወይም የመታወቂያ ቁጥር አያጋሩ።',
      humanYes: 'አዎ፣ አገናኙኝ',
      humanNo: 'አይ፣ አመሰግናለሁ',
      humanCancelled: 'እሺ። ረዳቱን መጠየቅ መቀጠል ይችላሉ።',
      humanAlready: 'አስቀድመው ከሰው ጋር ተገናኝተዋል።',
      connecting: 'እያገናኘሁ ነው…',
      humanWaiting: 'ጥያቄዎ ተልኳል። አንድ ሰው እስኪመጣ እባክዎ ይጠብቁ። አሁን የሚጽፉት ለዚያ ሰው ይደርሰዋል።',
      humanJoined: 'አንድ ሰው ውይይቱን ተቀላቅሏል።',
      humanClosedAgent: 'ሰውየው ውይይቱን ዘግቷል። ረዳቱን መጠየቅ መቀጠል ይችላሉ።',
      humanEndedYou: 'ከሰው ጋር የነበረውን ውይይት አብቅተዋል። ረዳቱን መጠየቅ መቀጠል ይችላሉ።',
      humanLost: 'ከሰው ጋር ያለው ግንኙነት ተቋርጧል። እባክዎ እንደገና ይሞክሩ።',
      humanMode: 'ከሰው ጋር እያወሩ ነው',
      humanEnd: 'ከሰው ጋር ማውራት አብቅት',
      humanSendFail: 'መልዕክቱ አልተላከም። እባክዎ እንደገና ይሞክሩ።',
      humanBusy: 'አሁን የድጋፍ አገልግሎቱ በጣም ተጨናንቋል። እባክዎ ቆይተው ይሞክሩ።',
      humanSent: 'አሁን ከሰው ጋር ማገናኘት አልተቻለም። እባክዎ የድጋፍ ቡድንዎን ያነጋግሩ።',
      humanIntro: 'ሰው ለማነጋገር እዚህ ይጠቀሙ፦',
      humanLink: 'የድጋፍ ገጹን ይክፈቱ',
      agentWho: 'የድጋፍ ሰው፦',
      you: 'እርስዎ፦',
      assistant: 'ረዳት፦',
      error: 'ይቅርታ፣ አሁን መልስ ማግኘት አልተቻለም። እባክዎ እንደገና ይሞክሩ።',
      rateLimited: 'በአንድ ጊዜ ብዙ ጥያቄዎች ተጠይቀዋል። እባክዎ ትንሽ ቆይተው እንደገና ይሞክሩ።',
      micUnsupported: 'በዚህ መሣሪያ ወይም አሳሽ የድምፅ ግብዓት አይሠራም። እባክዎ ጥያቄዎን ይጻፉ።',
      micDenied: 'የማይክሮፎን ፈቃድ አልተሰጠም።',
      micNoSpeech: 'ምንም ድምፅ አልሰማሁም። እባክዎ እንደገና ይሞክሩ።',
      micLangUnsupported: 'ይህ መሣሪያ የአማርኛ ድምፅ ግብዓትን አይደግፍም። እባክዎ ጥያቄዎን ይጻፉ።',
      micNetwork: 'የድምፅ ግብዓት የበይነመረብ ግንኙነት ይፈልጋል። እባክዎ ጥያቄዎን ይጻፉ።',
      ttsUnsupported: 'በዚህ መሣሪያ በድምፅ ማንበብ አይሠራም።',
      ttsNoVoice: 'ይህ መሣሪያ የአማርኛ ድምፅ የለውም። እባክዎ ጽሑፉን ያንብቡ።',
      shareScreen: 'ማያ ገጼን አጋራ',
      stopShare: 'ማጋራት አቁም',
      sharing: 'ማያ ገጽዎን ከሰውየው ጋር እያጋሩ ነው። በማንኛውም ጊዜ ለማቆም የአሳሽዎን የራሱን መቆጣጠሪያ ይጠቀሙ።',
      shareUnsupported: 'በዚህ መሣሪያ ወይም አሳሽ ማያ ገጽ ማጋራት አይሠራም።',
      shareFailed: 'ማያ ገጽ ማጋራት መጀመር አልተቻለም። ይህ በአንዳንድ አውታረ መረቦች ላይ ሊከሰት ይችላል። እባክዎ እንደገና ይሞክሩ፣ ወይም ችግሩን በቃላት ይግለጹ።',
      shareEndedByYou: 'ማያ ገጽዎን ማጋራት አቁመዋል።',
      shareStoppedDevice: 'ማያ ገጽ ማጋራት ቆሟል።',
      accommodation: 'የቃለ መጠይቅ ድጋፍ ይጠይቁ',
      accommodationPrompt: 'ለቃለ መጠይቅ ምን እንደሚያስፈልግዎ ይግለጹ (ለምሳሌ፦ ተጨማሪ ጊዜ፣ የምልክት ቋንቋ አስተርጓሚ፣ ወይም ጸጥ ያለ ክፍል)። የህክምና ሁኔታ መግለጽ አያስፈልግም። ከዚያ ላክ ይጫኑ።',
      accommodationWaiting: 'ጥያቄዎ ለሰው ተልኳል። እዚህ ሊጽፉልዎት ይችላሉ።'
    }
  };

  var TEMPLATE = [
    '<style>',
    ':host{display:block;max-width:100%;--sa-bg:#ffffff;--sa-fg:#1a1a1a;--sa-muted:#4a4a4a;--sa-accent:#0b5cad;--sa-on-accent:#ffffff;--sa-bot:#eef1f4;--sa-border:#6b7280;--sa-error:#b3261e;',
    'font-family:system-ui,-apple-system,"Segoe UI","Noto Sans Ethiopic","Nyala","Abyssinica SIL",sans-serif;font-size:1rem;line-height:1.5;color:var(--sa-fg)}',
    ':host([theme="dark"]){--sa-bg:#121212;--sa-fg:#f1f1f1;--sa-muted:#c4c7c5;--sa-accent:#8ab4f8;--sa-on-accent:#0b1b33;--sa-bot:#2a2a2a;--sa-border:#9aa0a6;--sa-error:#ffb4ab}',
    '@media (prefers-color-scheme:dark){:host(:not([theme="light"])){--sa-bg:#121212;--sa-fg:#f1f1f1;--sa-muted:#c4c7c5;--sa-accent:#8ab4f8;--sa-on-accent:#0b1b33;--sa-bot:#2a2a2a;--sa-border:#9aa0a6;--sa-error:#ffb4ab}}',
    '*,*::before,*::after{box-sizing:border-box}',
    '[hidden]{display:none !important}',
    '.box{display:flex;flex-direction:column;gap:.75rem;width:100%;padding:1rem;background:var(--sa-bg);color:var(--sa-fg);border:2px solid var(--sa-border);border-radius:.75rem}',
    '.top{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.5rem}',
    '.title{margin:0;font-size:1.25rem}',
    '.langs{display:flex;gap:.25rem}',
    '.mode{margin:0;padding:.375rem .75rem;font-weight:700;color:var(--sa-on-accent);background:var(--sa-accent);border-radius:.5rem}',
    'button{font:inherit;min-width:2.75rem;min-height:2.75rem;padding:.5rem 1rem;color:var(--sa-accent);background:var(--sa-bg);border:2px solid var(--sa-accent);border-radius:.5rem;cursor:pointer}',
    'button[aria-pressed="true"],button.primary{color:var(--sa-on-accent);background:var(--sa-accent)}',
    'button[aria-pressed="true"]{font-weight:700}',
    'button[aria-disabled="true"]{opacity:.6;cursor:not-allowed}',
    'button:focus-visible,textarea:focus-visible,.log:focus-visible,a:focus-visible{outline:3px solid var(--sa-accent);outline-offset:2px}',
    '.log{display:flex;flex-direction:column;gap:.75rem;min-height:8rem;max-height:min(60vh,28rem);padding:.25rem;overflow-y:auto}',
    '.msg{max-width:92%;padding:.625rem .875rem;border-radius:.75rem;overflow-wrap:anywhere}',
    '.msg p{margin:0}',
    '.user{align-self:flex-end;color:var(--sa-on-accent);background:var(--sa-accent)}',
    '.bot{align-self:flex-start;color:var(--sa-fg);background:var(--sa-bot)}',
    '.bot.err{border:2px solid var(--sa-error)}',
    '.bot.agent{border:2px solid var(--sa-accent)}',
    '.who{display:block;font-size:.9375rem;font-weight:700}',
    '.slabel{margin:.5rem 0 0;font-size:.9375rem;font-weight:600}',
    '.links{margin:0;padding:0;list-style:none;font-size:.9375rem}',
    '.links a{color:var(--sa-accent);text-decoration:underline}',
    '.actions{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.5rem}',
    '.status{min-height:1.5rem;margin:0;color:var(--sa-muted)}',
    '.form{display:flex;flex-direction:column;gap:.5rem}',
    'label{font-weight:600}',
    'textarea{width:100%;min-height:3.5rem;padding:.625rem;font:inherit;color:var(--sa-fg);background:var(--sa-bg);border:2px solid var(--sa-border);border-radius:.5rem;resize:vertical}',
    '.hint{margin:0;font-size:.875rem;color:var(--sa-muted)}',
    '.row{display:flex;flex-wrap:wrap;gap:.5rem}',
    '.sr-only{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}',
    '@media (forced-colors:active){button,textarea,.msg,.mode{border:1px solid CanvasText}}',
    '</style>',
    '<section class="box" id="box" aria-labelledby="h">',
    '<header class="top">',
    '<h2 class="title" id="h" data-k="heading"></h2>',
    '<div class="langs" id="langs" role="group">',
    '<button type="button" data-l="en" lang="en" aria-pressed="false">English</button>',
    '<button type="button" data-l="am" lang="am" aria-pressed="false">አማርኛ</button>',
    '</div>',
    '</header>',
    '<p class="mode" id="mode" data-k="humanMode" hidden></p>',
    '<div class="log" id="log" role="log" aria-live="polite" aria-relevant="additions" tabindex="0"></div>',
    '<p class="status" id="status" role="status" aria-live="polite"></p>',
    '<form class="form" id="form" novalidate>',
    '<label for="q" data-k="label"></label>',
    '<textarea id="q" rows="2" maxlength="1000" dir="auto" enterkeyhint="send" aria-describedby="hint"></textarea>',
    '<p class="hint" id="hint" data-k="hint"></p>',
    '<div class="row">',
    '<button type="button" id="mic" data-k="mic" aria-pressed="false"></button>',
    '<button type="submit" id="send" class="primary" data-k="send"></button>',
    '<button type="button" id="endHuman" data-k="humanEnd" hidden></button>',
    '<button type="button" id="shareBtn" data-k="shareScreen" hidden></button>',
    '<button type="button" id="accBtn" data-k="accommodation"></button>',
    '</div>',
    '</form>',
    '</section>'
  ].join('');

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) { n.className = cls; }
    if (text) { n.textContent = text; }
    return n;
  }
  function guessLang(t) { return /[\u1200-\u139F]/.test(t) ? 'am' : 'en'; }
  function isHttp(u) { return /^https?:\/\//i.test(u || ''); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  class InclusiveAssistant extends HTMLElement {
    static get observedAttributes() { return ['lang', 'heading']; }

    constructor() {
      super();
      this._history = [];
      this._busy = false;
      this._built = false;
      this._rec = null;
      this._speakBtn = null;
      this._statusTimer = 0;
      this._uid = 0;
      this._heard = false;
      this._micError = false;
      this._human = null;
      this._pendingAccommodation = false;
      this._stream = null;
      this._pc = null;
      this.attachShadow({ mode: 'open' });
    }

    get version() { return VERSION; }

    connectedCallback() {
      if (!this._built) { this._build(); this._built = true; }
      this._applyStrings();
      this._emit('ready', { version: VERSION });
    }

    disconnectedCallback() {
      this._stopMic();
      this._stopSpeak();
      this._stopShare();
      this._human = null; // stops the polling loop
      this._pendingAccommodation = false;
    }

    attributeChangedCallback() {
      if (this._built) { this._applyStrings(); }
    }

    /* Public: ask a question from code, e.g. el.ask('How do I check my score?') */
    ask(text) {
      this._q.value = String(text || '');
      return this._send();
    }

    _lang() {
      var l = String(this.getAttribute('lang') || 'en').toLowerCase().slice(0, 2);
      return STRINGS[l] ? l : 'en';
    }
    _t(k) { return STRINGS[this._lang()][k]; }

    _emit(name, detail, cancelable) {
      var ev = new CustomEvent('inclusive-assistant:' + name, {
        detail: detail, bubbles: true, composed: true, cancelable: !!cancelable
      });
      this.dispatchEvent(ev);
      return ev;
    }

    _base() {
      return (this.getAttribute('api-url') || SCRIPT_ORIGIN || window.location.origin).replace(/\/+$/, '');
    }

    // text/plain keeps POSTs without a token "simple" cross-site requests (no CORS
    // preflight), which saves a round trip on 3G. The API parses JSON regardless.
    async _call(method, path, body, token, timeoutMs) {
      var ctrl = new AbortController();
      var timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || 25000);
      try {
        var headers = { 'content-type': 'text/plain;charset=UTF-8' };
        if (token) { headers.authorization = 'Bearer ' + token; }
        var init = { method: method, headers: headers, signal: ctrl.signal };
        if (method !== 'GET') { init.body = JSON.stringify(body || {}); }
        var res = await fetch(this._base() + path, init);
        var data = null;
        try { data = await res.json(); } catch (e) { data = null; }
        if (!res.ok || !data) {
          var code = data && data.error && data.error.code;
          var err = new Error(code || 'bad_response');
          err.code = code;
          err.status = res.status;
          throw err;
        }
        return data;
      } finally {
        clearTimeout(timer);
      }
    }

    _build() {
      var self = this;
      var r = this.shadowRoot;
      r.innerHTML = TEMPLATE;
      this._box = r.getElementById('box');
      this._log = r.getElementById('log');
      this._status = r.getElementById('status');
      this._q = r.getElementById('q');
      this._mic = r.getElementById('mic');
      this._sendBtn = r.getElementById('send');
      this._endBtn = r.getElementById('endHuman');
      this._shareBtn = r.getElementById('shareBtn');
      this._accBtn = r.getElementById('accBtn');
      this._modeEl = r.getElementById('mode');

      r.getElementById('form').addEventListener('submit', function (e) {
        e.preventDefault();
        self._send();
      });
      this._q.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          self._send();
        }
      });
      this._mic.addEventListener('click', function () { self._toggleMic(); });
      this._endBtn.addEventListener('click', function () {
        self._endHuman(true, 'humanEndedYou');
        self._q.focus();
      });
      this._shareBtn.addEventListener('click', function () { self._toggleShare(); });
      this._accBtn.addEventListener('click', function () { self._promptAccommodation(); });
      r.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { self._stopMic(); self._stopSpeak(); }
      });
      Array.prototype.forEach.call(r.querySelectorAll('[data-l]'), function (b) {
        b.addEventListener('click', function () {
          self._stopMic();
          self._stopSpeak();
          self.setAttribute('lang', b.getAttribute('data-l'));
        });
      });

      this._addMessage('bot', '', { welcome: true, key: 'welcome' });
      if ('speechSynthesis' in window) {
        try { window.speechSynthesis.getVoices(); } catch (e) { /* warm up voice list */ }
      }
    }

    _fill(root) {
      var ui = STRINGS[this._lang()];
      Array.prototype.forEach.call(root.querySelectorAll('[data-k]'), function (n) {
        var v = ui[n.getAttribute('data-k')];
        if (v !== undefined) { n.textContent = v; }
      });
    }

    _applyStrings() {
      var lang = this._lang();
      var r = this.shadowRoot;
      this._box.setAttribute('lang', lang);
      this._fill(r);
      var h = this.getAttribute('heading');
      if (h) { r.getElementById('h').textContent = h; }
      this._log.setAttribute('aria-label', STRINGS[lang].conversation);
      r.getElementById('langs').setAttribute('aria-label', STRINGS[lang].langGroup);
      Array.prototype.forEach.call(r.querySelectorAll('[data-l]'), function (b) {
        b.setAttribute('aria-pressed', b.getAttribute('data-l') === lang ? 'true' : 'false');
      });
    }

    _setStatus(text) {
      var s = this._status;
      clearTimeout(this._statusTimer);
      s.textContent = '';
      if (!text) { return; }
      // Clear, then set: makes screen readers announce repeated messages again.
      this._statusTimer = setTimeout(function () { s.textContent = text; }, 60);
    }

    _setBusy(b) {
      this._busy = b;
      this._sendBtn.setAttribute('aria-disabled', b ? 'true' : 'false');
      this._log.setAttribute('aria-busy', b ? 'true' : 'false');
    }

    _href(u) {
      if (!u) { return ''; }
      if (isHttp(u)) { return u; }
      var b = this.getAttribute('source-base') || '';
      if (!isHttp(b)) { return ''; }
      return b.replace(/\/+$/, '') + (u.charAt(0) === '/' ? u : '/' + u);
    }

    /* opts: lang, key, welcome, error, read(false hides), escalate, question, links[], linksLabel,
             who (string key), showWho, actions[{key, primary, onClick}] */
    _addMessage(role, text, opts) {
      opts = opts || {};
      var self = this;
      var cls = 'msg ' + (role === 'user' ? 'user' : 'bot') + (opts.error ? ' err' : '') + (opts.showWho ? ' agent' : '');
      var a = el('article', cls);
      a.setAttribute('lang', opts.lang || this._lang());

      var who = el('span', opts.showWho ? 'who' : 'sr-only');
      who.setAttribute('data-k', role === 'user' ? 'you' : (opts.who || 'assistant'));
      a.appendChild(who);

      var p = el('p', '', text);
      p.setAttribute('dir', 'auto');
      p.id = 'm' + (++this._uid);
      if (opts.key) { p.setAttribute('data-k', opts.key); }
      a.appendChild(p);

      if (opts.links && opts.links.length) {
        if (opts.linksLabel) {
          var lab = el('p', 'slabel');
          lab.setAttribute('data-k', opts.linksLabel);
          a.appendChild(lab);
        }
        var ul = el('ul', 'links');
        opts.links.forEach(function (l) {
          var li = el('li');
          if (l.href) {
            var link = el('a', '', l.text);
            link.href = l.href;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            if (l.lang) { link.setAttribute('lang', l.lang); }
            li.appendChild(link);
          } else {
            var span = el('span', '', l.text);
            if (l.lang) { span.setAttribute('lang', l.lang); }
            li.appendChild(span);
          }
          ul.appendChild(li);
        });
        a.appendChild(ul);
      }

      var wantRead = role === 'bot' && !opts.welcome && opts.read !== false;
      if (wantRead || opts.escalate) {
        var row = el('div', 'actions');
        if (wantRead) {
          var read = el('button');
          read.type = 'button';
          read.setAttribute('data-k', 'readAloud');
          read.setAttribute('aria-pressed', 'false');
          read.setAttribute('aria-describedby', p.id);
          var mlang = opts.lang || this._lang();
          read.addEventListener('click', function () { self._toggleSpeak(read, p.textContent, mlang); });
          row.appendChild(read);
        }
        if (opts.escalate) {
          var human = el('button');
          human.type = 'button';
          human.setAttribute('data-k', 'human');
          human.addEventListener('click', function () { self._escalate(opts.question || ''); });
          row.appendChild(human);
        }
        a.appendChild(row);
      }

      if (opts.actions && opts.actions.length) {
        var arow = el('div', 'actions');
        opts.actions.forEach(function (act) {
          var b = el('button', act.primary ? 'primary' : '');
          b.type = 'button';
          b.setAttribute('data-k', act.key);
          b.addEventListener('click', function () { arow.remove(); act.onClick(); });
          arow.appendChild(b);
        });
        a.appendChild(arow);
      }

      this._log.appendChild(a);
      this._fill(a);
      this._log.scrollTop = this._log.scrollHeight;
      return a;
    }

    async _send() {
      if (this._busy) { return; }
      var text = this._q.value.trim();
      if (!text) { this._q.focus(); return; }
      this._stopMic();
      this._stopSpeak();
      if (this._pendingAccommodation) { return this._startAccommodation(text); }
      if (this._human) { return this._sendHuman(text); }

      var self = this;
      var lang = this._lang();
      this._addMessage('user', text, { lang: guessLang(text) });
      this._q.value = '';
      this._setBusy(true);
      this._setStatus(this._t('thinking'));

      try {
        var data = await this._call('POST', '/v1/chat', { message: text, lang: lang, history: this._history.slice(-4) }, '', 25000);
        if (typeof data.answer !== 'string') { throw new Error('bad_response'); }
        var links = (data.citations || []).map(function (c) {
          return { text: c.title, href: self._href(c.url), lang: c.lang };
        });
        this._addMessage('bot', data.answer, {
          lang: data.lang || lang,
          links: links,
          linksLabel: links.length ? 'sources' : '',
          escalate: !!data.escalate,
          question: text
        });
        this._history.push({ role: 'user', content: text });
        this._history.push({ role: 'assistant', content: data.answer });
        this._emit('answer', {
          question: text,
          answer: data.answer,
          citations: data.citations || [],
          grounded: !!data.grounded,
          provider: data.provider
        });
      } catch (e) {
        var msg = e && e.code === 'rate_limited' ? this._t('rateLimited') : this._t('error');
        this._addMessage('bot', msg, { error: true, read: false, escalate: true, question: text });
        this._emit('error', { message: String((e && e.message) || e), code: e && e.code });
      } finally {
        this._setBusy(false);
        this._setStatus('');
      }
    }

    /* ---------- human help ---------- */
    _escalate(question) {
      var self = this;
      var ev = this._emit('escalate', { question: question, transcript: this._history.slice() }, true);
      // A host page can call event.preventDefault() to handle human help itself.
      if (ev.defaultPrevented) { return; }
      if (this._human) { this._setStatus(this._t('humanAlready')); this._q.focus(); return; }
      var a = this._addMessage('bot', '', {
        key: 'humanConsent',
        read: false,
        actions: [
          { key: 'humanYes', primary: true, onClick: function () { self._startHuman(question); } },
          {
            key: 'humanNo', onClick: function () {
              self._addMessage('bot', '', { key: 'humanCancelled', read: false });
              self._q.focus();
            }
          }
        ]
      });
      var first = a.querySelector('button');
      if (first) { first.focus(); }
    }

    async _startHuman(question) {
      this._setStatus(this._t('connecting'));
      try {
        var r = await this._call('POST', '/v1/handoff', { question: question, transcript: this._history.slice(-10), lang: this._lang() }, '', 15000);
        var h = { id: r.id, token: r.token, after: 0 };
        this._human = h;
        this._setHumanUi(true);
        this._addMessage('bot', '', { key: 'humanWaiting', read: false });
        this._emit('handoff', { id: r.id });
        this._q.focus();
        this._pollHuman(h);
      } catch (e) {
        var url = this.getAttribute('support-url') || '';
        if (isHttp(url)) {
          this._addMessage('bot', '', { key: 'humanIntro', read: false, links: [{ text: this._t('humanLink'), href: url }] });
        } else {
          this._addMessage('bot', '', { key: e && e.code === 'busy' ? 'humanBusy' : 'humanSent', read: false });
        }
        this._emit('error', { message: String((e && e.message) || e), code: e && e.code });
        this._q.focus();
      } finally {
        this._setStatus('');
      }
    }

    /* ---------- interview accommodations (reuses the human-help channel) ---------- */
    _promptAccommodation() {
      if (this._human) { this._setStatus(this._t('humanAlready')); this._q.focus(); return; }
      this._pendingAccommodation = true;
      this._addMessage('bot', '', { key: 'accommodationPrompt', read: false });
      this._q.focus();
    }

    async _startAccommodation(text) {
      this._pendingAccommodation = false;
      this._addMessage('user', text, { lang: guessLang(text) });
      this._q.value = '';
      this._setStatus(this._t('connecting'));
      try {
        var r = await this._call('POST', '/v1/accommodations', { request: text, lang: this._lang() }, '', 15000);
        var h = { id: r.id, token: r.token, after: 0 };
        this._human = h;
        this._setHumanUi(true);
        this._addMessage('bot', '', { key: 'accommodationWaiting', read: false });
        this._emit('accommodation', { id: r.id });
        this._q.focus();
        this._pollHuman(h);
      } catch (e) {
        this._addMessage('bot', '', { key: e && e.code === 'busy' ? 'humanBusy' : 'humanSent', read: false });
        this._emit('error', { message: String((e && e.message) || e), code: e && e.code });
        this._q.focus();
      } finally {
        this._setStatus('');
      }
    }

    _setHumanUi(on) {
      this._endBtn.hidden = !on;
      this._modeEl.hidden = !on;
      this._accBtn.hidden = on;
      if (!on) { this._shareBtn.hidden = true; }
    }

    _endHuman(notify, key) {
      var h = this._human;
      if (!h) { return; }
      this._stopShare();
      this._human = null;
      this._setHumanUi(false);
      if (notify) { this._call('POST', '/v1/handoff/' + h.id + '/close', {}, h.token, 10000).catch(function () { /* best effort */ }); }
      if (key) { this._addMessage('bot', '', { key: key, read: false }); }
    }

    async _sendHuman(text) {
      var h = this._human;
      this._addMessage('user', text, { lang: guessLang(text) });
      this._q.value = '';
      try {
        await this._call('POST', '/v1/handoff/' + h.id + '/messages', { text: text }, h.token, 15000);
      } catch (e) {
        if (this._human !== h) { return; }
        if (e.status === 409 || e.status === 404) { this._endHuman(false, 'humanLost'); }
        else { this._addMessage('bot', '', { key: 'humanSendFail', error: true, read: false }); }
      }
    }

    _renderHumanMsg(m) {
      if (m.from === 'agent') {
        this._addMessage('bot', m.text, { lang: guessLang(m.text), who: 'agentWho', showWho: true });
      } else if (m.from === 'system') {
        var map = { agent_joined: 'humanJoined', closed_by_agent: 'humanClosedAgent' };
        if (map[m.code]) { this._addMessage('bot', '', { key: map[m.code], read: false }); }
      }
    }

    // Long polling: the server holds each request up to 20 s until something
    // new arrives, so a 3G phone makes about 3 requests a minute, not 30.
    // Works the same way whether this._human came from /v1/handoff (a normal
    // escalation) or /v1/accommodations (an accommodation request), since
    // both create a session in the same store.
    async _pollHuman(h) {
      var fails = 0;
      while (this._human === h && this.isConnected) {
        try {
          var d = await this._call('GET', '/v1/handoff/' + h.id + '?after=' + h.after + '&wait=20', null, h.token, 35000);
          fails = 0;
          if (this._human !== h) { return; }
          var self = this;
          // The "Share my screen" button only appears once a person has
          // actually joined; it must never be offered before that.
          this._shareBtn.hidden = d.status !== 'active';
          (d.messages || []).forEach(function (m) {
            h.after = Math.max(h.after, m.id);
            if (m.code === 'webrtc') { self._onRemoteSignal(m); return; }
            if (m.from !== 'learner') { self._renderHumanMsg(m); }
          });
          if (d.status === 'closed') { this._endHuman(false); this._q.focus(); return; }
        } catch (e) {
          if (this._human !== h) { return; }
          if (e.status === 404) { this._endHuman(false, 'humanLost'); return; }
          fails += 1;
          if (fails >= 5) { this._endHuman(false, 'humanLost'); return; }
          await sleep(Math.min(2000 * fails, 10000));
        }
      }
    }

    /* ---------- screen sharing (learner-initiated, native browser controls) ---------- */
    async _onRemoteSignal(m) {
      // Only the person's own signals matter; the learner's own echo is ignored.
      if (m.from !== 'agent' || !this._pc) { return; }
      var sig = m.data || {};
      try {
        if (sig.type === 'answer') {
          await this._pc.setRemoteDescription({ type: 'answer', sdp: sig.sdp });
        } else if (sig.type === 'ice' && sig.candidate) {
          await this._pc.addIceCandidate(sig.candidate);
        }
      } catch (e) { /* a late or malformed signal is safe to ignore */ }
    }

    async _toggleShare() {
      if (this._stream) { this._stopShare('shareEndedByYou'); return; }
      var h = this._human;
      if (!h) { return; }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        this._setStatus(this._t('shareUnsupported'));
        return;
      }
      var self = this;
      try {
        var stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        this._stream = stream;
        // The browser's own "Stop sharing" control (in its sharing indicator)
        // ends the track; this cleans up our side the same way our own button does.
        stream.getVideoTracks()[0].addEventListener('ended', function () {
          if (self._stream === stream) { self._stopShare('shareStoppedDevice'); }
        });

        var pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        this._pc = pc;
        stream.getTracks().forEach(function (t) { pc.addTrack(t, stream); });
        pc.onicecandidate = function (e) {
          if (e.candidate && self._human === h) {
            self._call('POST', '/v1/handoff/' + h.id + '/signal', { signal: { type: 'ice', candidate: e.candidate.toJSON() } }, h.token, 10000).catch(function () { /* best effort */ });
          }
        };
        pc.onconnectionstatechange = function () {
          if (pc.connectionState === 'failed' && self._pc === pc) { self._stopShare('shareFailed'); }
        };

        var offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await this._call('POST', '/v1/handoff/' + h.id + '/signal', { signal: { type: 'offer', sdp: offer.sdp } }, h.token, 10000);

        this._shareBtn.setAttribute('data-k', 'stopShare');
        this._fill(this.shadowRoot);
        this._setStatus(this._t('sharing'));
      } catch (e) {
        this._stopShare();
        this._setStatus(this._t('shareFailed'));
      }
    }

    _stopShare(key) {
      if (this._stream) {
        this._stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { /* already stopped */ } });
        this._stream = null;
      }
      if (this._pc) {
        try { this._pc.close(); } catch (e) { /* already closed */ }
        this._pc = null;
      }
      this._shareBtn.setAttribute('data-k', 'shareScreen');
      this._fill(this.shadowRoot);

      if (key) { this._setStatus(this._t(key)); }
    }

    /* ---------- voice input ---------- */
    _stopMic() {
      if (this._rec) { try { this._rec.stop(); } catch (e) { /* already stopped */ } }
    }

    _toggleMic() {
      var self = this;
      var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { this._setStatus(this._t('micUnsupported')); return; }
      if (this._rec) { this._stopMic(); return; }
      this._stopSpeak();

      var rec = new SR();
      rec.lang = SPEECH_LANG[this._lang()];
      rec.interimResults = false;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      this._rec = rec;
      this._heard = false;
      this._micError = false;

      rec.onstart = function () {
        self._mic.setAttribute('aria-pressed', 'true');
        self._setStatus(self._t('listening'));
      };
      rec.onresult = function (e) {
        var t = '';
        for (var i = 0; i < e.results.length; i++) { t += e.results[i][0].transcript; }
        t = t.trim();
        if (t) {
          // The learner reviews and edits the text before sending.
          self._q.value = self._q.value ? self._q.value + ' ' + t : t;
          self._heard = true;
        }
      };
      rec.onerror = function (e) {
        self._micError = true;
        var map = {
          'not-allowed': 'micDenied',
          'service-not-allowed': 'micDenied',
          'no-speech': 'micNoSpeech',
          'language-not-supported': 'micLangUnsupported',
          'network': 'micNetwork'
        };
        self._setStatus(self._t(map[e.error] || 'micUnsupported'));
      };
      rec.onend = function () {
        self._rec = null;
        self._mic.setAttribute('aria-pressed', 'false');
        if (self._heard) {
          self._setStatus(self._t('heard'));
          self._q.focus();
        } else if (!self._micError) {
          self._setStatus('');
        }
      };
      try { rec.start(); } catch (e) {
        this._rec = null;
        this._setStatus(this._t('micUnsupported'));
      }
    }

    /* ---------- read aloud ---------- */
    _pickVoice(lang) {
      var voices = [];
      try { voices = window.speechSynthesis.getVoices() || []; } catch (e) { voices = []; }
      for (var i = 0; i < voices.length; i++) {
        if (String(voices[i].lang).toLowerCase().replace('_', '-').indexOf(lang) === 0) { return voices[i]; }
      }
      return null;
    }

    _stopSpeak() {
      if ('speechSynthesis' in window) { try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
      if (this._speakBtn) {
        this._speakBtn.setAttribute('aria-pressed', 'false');
        this._speakBtn = null;
      }
    }

    _toggleSpeak(btn, text, lang) {
      var self = this;
      if (!('speechSynthesis' in window) || typeof window.SpeechSynthesisUtterance === 'undefined') {
        this._setStatus(this._t('ttsUnsupported'));
        return;
      }
      if (this._speakBtn === btn) { this._stopSpeak(); return; }
      this._stopSpeak();
      this._stopMic();

      var voice = this._pickVoice(lang);
      // Never read Amharic text with an English voice: it would be gibberish.
      if (!voice && lang === 'am') { this._setStatus(this._t('ttsNoVoice')); return; }

      var u = new window.SpeechSynthesisUtterance(text.replace(/\s*\[\d+\]/g, ''));
      u.lang = SPEECH_LANG[lang] || 'en-US';
      if (voice) { u.voice = voice; }
      var done = function () {
        if (self._speakBtn === btn) {
          btn.setAttribute('aria-pressed', 'false');
          self._speakBtn = null;
        }
      };
      u.onend = done;
      u.onerror = done;
      this._speakBtn = btn;
      btn.setAttribute('aria-pressed', 'true');
      window.speechSynthesis.speak(u);
    }
  }

  window.customElements.define('inclusive-assistant', InclusiveAssistant);
})();