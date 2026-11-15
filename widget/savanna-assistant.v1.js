/*! INCLUSIVE web assistant v1.3.5 | MIT | vanilla JS, no dependencies */
(function () {
  'use strict';
  if (typeof window === 'undefined' || !window.customElements) { return; }
  if (window.customElements.get('inclusive-assistant') && window.customElements.get('savanna-assistant')) { return; }

  var VERSION = '1.3.5';
  var LANG_CYCLE = ['en', 'am', 'ti', 'om', 'so', 'ar'];
  var LANG_SHORT = { en: 'EN', am: 'አማ', ti: 'ትግ', om: 'OM', so: 'SO', ar: 'AR' };

  var SCRIPT_ORIGIN = '';
  try {
    if (document.currentScript && document.currentScript.src) {
      SCRIPT_ORIGIN = new URL(document.currentScript.src).origin;
    }
  } catch (e) { /* ignore */ }

  var SPEECH_LANG = { en: 'en-US', am: 'am-ET', ti: 'ti-ER', om: 'om-ET', so: 'so-SO', ar: 'ar' };
  var ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

  var STRINGS = {
    en: {
      heading: 'INCLUSIVE course assistant', openChat: 'Open chat', closeChat: 'Close chat',
      welcome: 'Welcome to INCLUSIVE! Ask me anything about your course. Chat replies are available in English, Amharic, Tigrinya, Afaan Oromo, Somali, and Arabic.',
      conversation: 'Conversation', langGroup: 'Language', label: 'Type your question',
      hint: 'Press Enter to send. Press Shift and Enter together for a new line.', send: 'Send', mic: 'Ask by voice',
      cancelRecording: 'Cancel recording', listening: 'Listening…', heard: 'Heard you. Check the text, then send.',
      transcribing: 'Transcribing your recording…', speechReady: 'Transcription ready. Review or edit it before sending.',
      recordingTooLong: 'Recording stopped at the 30-second limit. Transcribing now.', micTooLarge: 'This recording is too large. Please try again with a shorter recording.',
      speechTimeout: 'Speech recognition took too long. Please try a shorter recording.', speechNotConfigured: 'Speech recognition is not configured. You can still type your question.',
      speechFailed: 'Speech recognition failed. Please try again or type your question.', speechGenerating: 'Preparing audio…',
      addisListen: 'Listen (Addis voice)', speechPlay: 'Play answer audio', speechPause: 'Pause answer audio',
      speechResume: 'Resume answer audio', speechStop: 'Stop answer audio', speechUnavailable: 'Audio playback is not available. The answer is shown as text.',
      speechGenerateFailed: 'Could not generate audio. The answer is still available as text.', thinking: 'Looking for an answer…',
      sources: 'Sources', readAloud: 'Read aloud', human: 'Talk to a person',
      humanConsent: 'A person can help you. If you continue, they will see your questions and answers from this chat. Please do not share passwords or ID numbers.',
      humanYes: 'Yes, connect me', humanNo: 'No, thanks', humanCancelled: 'OK. You can keep asking the assistant.',
      humanAlready: 'You are already connected to a person.', connecting: 'Connecting you…',
      humanWaiting: 'Your request was sent. Please wait for a person to join. What you type now goes to that person.',
      humanJoined: 'A person has joined the chat.', humanClosedAgent: 'The person ended the chat. You can keep asking the assistant.',
      humanEndedYou: 'You ended the chat with the person. You can keep asking the assistant.', humanLost: 'The connection to the person was lost. Please try again.',
      humanMode: 'You are talking with a person', humanEnd: 'End chat with the person', humanSendFail: 'Your message was not sent. Please try again.',
      humanBusy: 'Support is very busy right now. Please try again later.', humanSent: 'I could not connect you to a person right now. Please contact your support team.',
      humanIntro: 'You can reach a person here:', humanLink: 'Open the support page', agentWho: 'Support person:', you: 'You:', assistant: 'Assistant:',
      error: 'Sorry, I could not get an answer right now. Please try again.', rateLimited: 'Too many questions at once. Please wait a minute and try again.',
      micUnsupported: 'Voice input does not work on this device or browser. Please type your question.', micDenied: 'Microphone permission was not given.',
      micNoSpeech: 'I did not hear anything. Please try again.', micLangUnsupported: 'This device does not support voice input in this language. Please type your question.',
      micNetwork: 'Voice input needs an internet connection. Please type your question.', ttsUnsupported: 'Reading aloud does not work on this device.',
      ttsNoVoice: 'This device has no voice for this language. Please read the text.', shareScreen: 'Share my screen', stopShare: 'Stop sharing',
      sharing: 'Sharing your screen with the person. Use your browser\u2019s own sharing control to stop at any time.', shareUnsupported: 'Screen sharing does not work on this device or browser.',
      shareFailed: 'Screen sharing could not start. This can happen on some networks. Please try again, or describe the problem in words.',
      shareEndedByYou: 'You stopped sharing your screen.', shareStoppedDevice: 'Screen sharing stopped.',
      accommodation: 'Request interview accommodations', accommodationPrompt: 'Please describe what you need for an interview (for example: more time, a sign language interpreter, or a quiet room). You do not need to state a medical condition. Then press Send.',
      accommodationWaiting: 'Your request was sent to a person. They may message you here.'
    },
    am: {
      heading: 'INCLUSIVE የኮርስ ረዳት', openChat: 'ውይይቱን ክፈት', closeChat: 'ውይይቱን ዝጋ',
      welcome: 'ወደ INCLUSIVE እንኳን በደህና በመጡ። ስለ ኮርሱ ይጠይቁ። በእንግሊዝኛ፣ በአማርኛ፣ በትግርኛ፣ በAfaan Oromo፣ በSoomaali ወይም በالعربية መልስ ማግኘት ይችላሉ።',
      conversation: 'ውይይት', langGroup: 'ቋንቋ', label: 'ጥያቄዎን ይጻፉ', hint: 'ለመላክ Enter ይጫኑ። አዲስ መስመር ለመጀመር Shift እና Enter አብረው ይጫኑ።',
      send: 'ላክ', mic: 'በድምፅ ይጠይቁ', cancelRecording: 'ቀረጻውን ሰርዝ', listening: 'እየሰማሁ ነው…',
      heard: 'ሰምቻለሁ። ጽሑፉን ይመልከቱ፣ ከዚያ ይላኩ።', transcribing: 'ቀረጻዎን ወደ ጽሑፍ እየቀየርኩ ነው…',
      speechReady: 'ጽሑፉ ዝግጁ ነው። ከመላክዎ በፊት ይመልከቱት ወይም ያስተካክሉት።', recordingTooLong: 'ቀረጻው የ30 ሰከንድ ገደቡ ላይ ቆሟል። አሁን ወደ ጽሑፍ እየተቀየረ ነው።',
      micTooLarge: 'ቀረጻው በጣም ትልቅ ነው። እባክዎ አጭር ቀረጻ ይሞክሩ።', speechTimeout: 'የድምፅ መተርጎሙ ብዙ ጊዜ ወስዷል። እባክዎ አጭር ቀረጻ ይሞክሩ።',
      speechNotConfigured: 'የድምፅ መተርጎሚያው አልተዋቀረም። ጥያቄዎን በጽሑፍ መጻፍ ይችላሉ።', speechFailed: 'የድምፅ መተርጎሙ አልተሳካም። እንደገና ይሞክሩ ወይም ጥያቄዎን ይጻፉ።',
      speechGenerating: 'ድምፁን እያዘጋጀሁ ነው…', addisListen: 'በአዲስ ድምፅ ያዳምጡ', speechPlay: 'መልሱን በድምፅ አጫውት',
      speechPause: 'የመልሱን ድምፅ አቁም', speechResume: 'የመልሱን ድምፅ ቀጥል', speechStop: 'የመልሱን ድምፅ ፈጽሞ አቁም',
      speechUnavailable: 'የድምፅ ማጫወቻው አይገኝም። መልሱ በጽሑፍ ይታያል።', speechGenerateFailed: 'ድምፁን ማዘጋጀት አልተቻለም። መልሱ በጽሑፍ አለ።',
      thinking: 'መልስ እየፈለግሁ ነው…', sources: 'ምንጮች', readAloud: 'በድምፅ አንብብ', human: 'ሰው ያነጋግሩ',
      humanConsent: 'አንድ ሰው ሊረዳዎት ይችላል። ከቀጠሉ፣ በዚህ ውይይት ውስጥ ያሉትን ጥያቄዎችዎን እና መልሶቹን ያያሉ። እባክዎ የይለፍ ቃል ወይም የመታወቂያ ቁጥር አያጋሩ።',
      humanYes: 'አዎ፣ አገናኙኝ', humanNo: 'አይ፣ አመሰግናለሁ', humanCancelled: 'እሺ። ረዳቱን መጠየቅ መቀጠል ይችላሉ።',
      humanAlready: 'አስቀድመው ከሰው ጋር ተገናኝተዋል።', connecting: 'እያገናኘሁ ነው…', humanWaiting: 'ጥያቄዎ ተልኳል። አንድ ሰው እስኪመጣ እባክዎ ይጠብቁ። አሁን የሚጽፉት ለዚያ ሰው ይደርሰዋል።',
      humanJoined: 'አንድ ሰው ውይይቱን ተቀላቅሏል።', humanClosedAgent: 'ሰውየው ውይይቱን ዘግቷል። ረዳቱን መጠየቅ መቀጠል ይችላሉ።',
      humanEndedYou: 'ከሰው ጋር የነበረውን ውይይት አብቅተዋል። ረዳቱን መጠየቅ መቀጠል ይችላሉ።', humanLost: 'ከሰው ጋር ያለው ግንኙነት ተቋርጧል። እባክዎ እንደገና ይሞክሩ።',
      humanMode: 'ከሰው ጋር እያወሩ ነው', humanEnd: 'ከሰው ጋር ማውራት አብቅት', humanSendFail: 'መልዕክቱ አልተላከም። እባክዎ እንደገና ይሞክሩ።',
      humanBusy: 'አሁን የድጋፍ አገልግሎቱ በጣም ተጨናንቋል። እባክዎ ቆይተው ይሞክሩ።', humanSent: 'አሁን ከሰው ጋር ማገናኘት አልተቻለም። እባክዎ የድጋፍ ቡድንዎን ያነጋግሩ።',
      humanIntro: 'ሰው ለማነጋገር እዚህ ይጠቀሙ፦', humanLink: 'የድጋፍ ገጹን ይክፈቱ', agentWho: 'የድጋፍ ሰው፦', you: 'እርስዎ፦', assistant: 'ረዳት፦',
      error: 'ይቅርታ፣ አሁን መልስ ማግኘት አልተቻለም። እባክዎ እንደገና ይሞክሩ።', rateLimited: 'በአንድ ጊዜ ብዙ ጥያቄዎች ተጠይቀዋል። እባክዎ ትንሽ ቆይተው እንደገና ይሞክሩ።',
      micUnsupported: 'በዚህ መሣሪያ ወይም አሳሽ የድምፅ ግብዓት አይሠራም። እባክዎ ጥያቄዎን ይጻፉ።', micDenied: 'የማይክሮፎን ፈቃድ አልተሰጠም።',
      micNoSpeech: 'ምንም ድምፅ አልሰማሁም። እባክዎ እንደገና ይሞክሩ።', micLangUnsupported: 'ይህ መሣሪያ የአማርኛ ድምፅ ግብዓትን አይደግፍም። እባክዎ ጥያቄዎን ይጻፉ።',
      micNetwork: 'የድምፅ ግብዓት የበይነመረብ ግንኙነት ይፈልጋል። እባክዎ ጥያቄዎን ይጻፉ።', ttsUnsupported: 'በዚህ መሣሪያ በድምፅ ማንበብ አይሠራም።',
      ttsNoVoice: 'ይህ መሣሪያ የአማርኛ ድምፅ የለውም። እባክዎ ጽሑፉን ያንብቡ።', shareScreen: 'ማያ ገጼን አጋራ', stopShare: 'ማጋራት አቁም',
      sharing: 'ማያ ገጽዎን ከሰውየው ጋር እያጋሩ ነው። በማንኛውም ጊዜ ለማቆም የአሳሽዎን የራሱን መቆጣጠሪያ ይጠቀሙ።', shareUnsupported: 'በዚህ መሣሪያ ወይም አሳሽ ማያ ገጽ ማጋራት አይሠራም።',
      shareFailed: 'ማያ ገጽ ማጋራት መጀመር አልተቻለም። ይህ በአንዳንድ አውታረ መረቦች ላይ ሊከሰት ይችላል። እባክዎ እንደገና ይሞክሩ፣ ወይም ችግሩን በቃላት ይግለጹ።',
      shareEndedByYou: 'ማያ ገጽዎን ማጋራት አቁመዋል።', shareStoppedDevice: 'ማያ ገጽ ማጋራት ቆሟል።', accommodation: 'የቃለ መጠይቅ ድጋፍ ይጠይቁ',
      accommodationPrompt: 'ለቃለ መጠይቅ ምን እንደሚያስፈልግዎ ይግለጹ (ለምሳሌ፦ ተጨማሪ ጊዜ፣ የምልክት ቋንቋ አስተርጓሚ፣ ወይም ጸጥ ያለ ክፍል)። የህክምና ሁኔታ መግለጽ አያስፈልግም። ከዚያ ላክ ይጫኑ።',
      accommodationWaiting: 'ጥያቄዎ ለሰው ተልኳል። እዚህ ሊጽፉልዎት ይችላሉ።'
    },
    ti: { heading: 'INCLUSIVE ሓጋዚ ትምህርቲ', openChat: 'ዕላል ክፈት', closeChat: 'ዕላል ዕጸው', welcome: 'እንቋዕ ናብ INCLUSIVE ብደሓን መጻእኩም።', conversation: 'ዕላል', langGroup: 'ቋንቋ', label: 'ሕቶኻ ጸሓፍ', hint: 'ንምልኣኽ Enter ጽቐጥ።', send: 'ልኣኽ', mic: 'ብድምጺ ሕተት', cancelRecording: 'ቀረጻ ሰርዝ', speechReady: 'ጽሑፍ ድምጺ ድሉው እዩ።', thinking: 'መልሲ እደሊ ኣለኹ…', sources: 'ምንጭታት', readAloud: 'ብድምጺ ኣንብብ', human: 'ምስ ሰብ ተዘራረብ', humanConsent: 'ሰብ ክሕግዘካ ይኽእል።', humanYes: 'እወ፣ ኣራኽበኒ', humanNo: 'ኣይፋል፣ የቐንየለይ', connecting: 'እየ የራኽበካ ዘለኹ…', humanMode: 'ምስ ሰብ ትዛረብ ኣለኻ', humanEnd: 'ምስ ሰብ ዘለኻ ዕላል ዛዝም', error: 'ይቕሬታ፣ ሕጂ መልሲ ክረክብ ኣይከኣልኩን።', rateLimited: 'ብዙሕ ሕቶታት ተላኢኾም።', accommodation: 'ናይ ቃለ መጠይቕ ሓገዝ ሕተት' },
    om: { heading: 'Gargaaraa Koorsii INCLUSIVE', openChat: 'Marii bani', closeChat: 'Marii cufi', welcome: 'Baga gara INCLUSIVE dhuftan!', conversation: 'Haasa’a', langGroup: 'Afaan', label: 'Gaaffii kee barreessi', hint: 'Erguuf Enter tuqi.', send: 'Ergi', mic: 'Sagaleedhaan gaafadhu', cancelRecording: 'Waraabbiicha haqi', speechReady: 'Waraabbiin barreeffameera.', thinking: 'Deebii barbaadaa jira…', sources: 'Maddoota', readAloud: 'Sagaleedhaan dubbisi', human: 'Nama waliin haasa’i', humanConsent: 'Namni tokko si gargaaruu danda’a.', humanYes: 'Eeyyee, na qunnamsiisi', humanNo: 'Lakki, galatoomi', connecting: 'Si qunnamsiisaa jira…', humanMode: 'Nama waliin haasa’aa jirta', humanEnd: 'Haasa’a nama waliin jiru xumuri', error: 'Dhiifama, amma deebii argachuu hin dandeenye.', rateLimited: 'Gaaffiin baay’een yeroo tokkotti dhufe.', accommodation: 'Deeggarsa af-gaaffii hojii gaafadhu' },
    so: { heading: 'Kaaliyaha koorsada INCLUSIVE', openChat: 'Fur wada sheekaysiga', closeChat: 'Xir wada sheekaysiga', welcome: 'Ku soo dhowow INCLUSIVE!', conversation: 'Wadahadal', langGroup: 'Luqad', label: 'Qor su’aashaada', hint: 'Riix Enter si aad u dirto.', send: 'Dir', mic: 'Cod ku weydii', cancelRecording: 'Jooji duubista', speechReady: 'Qoraalka codku waa diyaar.', thinking: 'Jawaab ayaa la raadinayaa…', sources: 'Ilaha', readAloud: 'Cod dheer ku akhri', human: 'Qof la hadal', humanConsent: 'Qof ayaa ku caawin kara.', humanYes: 'Haa, i xidh', humanNo: 'Maya, mahadsanid', connecting: 'Waa lagu xidhayaa…', humanMode: 'Waxaad la hadlaysaa qof', humanEnd: 'Jooji wada hadalka qofka', error: 'Waan ka xunnahay, hadda jawaab lama helin.', rateLimited: 'Su’aalo badan ayaa hal mar yimid.', accommodation: 'Codso taageero wareysi shaqo' },
    ar: { heading: 'مساعد التعلّم من INCLUSIVE', openChat: 'افتح المحادثة', closeChat: 'أغلق المحادثة', welcome: 'مرحبًا بك في INCLUSIVE!', conversation: 'المحادثة', langGroup: 'اللغة', label: 'اكتب سؤالك', hint: 'اضغط Enter للإرسال.', send: 'إرسال', mic: 'اسأل بالصوت', cancelRecording: 'إلغاء التسجيل', speechReady: 'أصبح النص جاهزًا.', thinking: 'جارٍ البحث عن إجابة…', sources: 'المصادر', readAloud: 'اقرأ بصوت مرتفع', human: 'تحدث إلى شخص', humanConsent: 'يمكن لشخص مساعدتك.', humanYes: 'نعم، أوصلني بشخص', humanNo: 'لا، شكرًا', connecting: 'جارٍ توصيلك…', humanMode: 'أنت تتحدث مع شخص', humanEnd: 'إنهاء المحادثة مع الشخص', error: 'عذرًا، تعذّر الحصول على إجابة الآن.', rateLimited: 'وصلت أسئلة كثيرة في وقت واحد.', accommodation: 'اطلب ترتيبات لمقابلة العمل' }
  };

  var TEMPLATE = [
    '<style>',
    ':host{all:initial;position:fixed;right:1rem;bottom:1rem;z-index:2147483000;display:block;width:min(30rem,calc(100vw - 2rem));max-width:100%;font-family:system-ui,-apple-system,"Segoe UI","Noto Sans Ethiopic","Nyala","Abyssinica SIL",sans-serif;font-size:16px;line-height:1.55;--sa-bg:#ffffff;--sa-fg:#0f172a;--sa-muted:#475569;--sa-accent:#0b5cad;--sa-accent-strong:#084a8a;--sa-on-accent:#ffffff;--sa-bot:#eef2f7;--sa-user:#0b5cad;--sa-on-user:#ffffff;--sa-border:#64748b;--sa-line:#cbd5e1;--sa-error:#b3261e;--sa-focus:#0b5cad;--sa-btn-bg:#ffffff;--sa-btn-fg:#0b5cad;--sa-btn-border:#0b5cad;--sa-radius:14px;--sa-shadow:0 10px 30px rgba(0,0,0,.22)}',
    ':host([theme="dark"]){--sa-bg:#0f151b;--sa-fg:#f1f5f9;--sa-muted:#cbd5e1;--sa-accent:#7cb7ff;--sa-accent-strong:#a7cdfd;--sa-on-accent:#0a1a2f;--sa-bot:#1b242d;--sa-user:#7cb7ff;--sa-on-user:#0a1a2f;--sa-border:#7b8794;--sa-line:#33404c;--sa-error:#ffb4ab;--sa-focus:#7cb7ff;--sa-btn-bg:#0f151b;--sa-btn-fg:#7cb7ff;--sa-btn-border:#7cb7ff;--sa-shadow:0 10px 30px rgba(0,0,0,.55)}',
    '@media (prefers-color-scheme:dark){:host(:not([theme="light"])){--sa-bg:#0f151b;--sa-fg:#f1f5f9;--sa-muted:#cbd5e1;--sa-accent:#7cb7ff;--sa-accent-strong:#a7cdfd;--sa-on-accent:#0a1a2f;--sa-bot:#1b242d;--sa-user:#7cb7ff;--sa-on-user:#0a1a2f;--sa-border:#7b8794;--sa-line:#33404c;--sa-error:#ffb4ab;--sa-focus:#7cb7ff;--sa-btn-bg:#0f151b;--sa-btn-fg:#7cb7ff;--sa-btn-border:#7cb7ff;--sa-shadow:0 10px 30px rgba(0,0,0,.55)}}',
    ':host([mode="inline"]){position:static;width:100%;max-width:100%;z-index:auto}',
    '*,*::before,*::after{box-sizing:border-box}', '[hidden]{display:none !important}',
    '.shell{display:flex;flex-direction:column;align-items:flex-end;gap:.6rem;width:100%;position:relative}',
    ':host:not([mode="inline"]) .box{position:absolute;right:0;bottom:4.4rem}',
    '.launcher{display:flex;align-items:center;justify-content:center;width:3.5rem;height:3.5rem;min-width:3.5rem;min-height:3.5rem;padding:0;border:0;border-radius:50%;background:var(--sa-accent);color:var(--sa-on-accent);box-shadow:var(--sa-shadow);cursor:pointer;transition:transform .15s ease,background .15s ease}',
    '.launcher:hover{background:var(--sa-accent-strong)}', '.launcher:active{transform:scale(.96)}',
    '.launcher svg{width:1.6rem;height:1.6rem;display:block}', '.launcher-label{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
    '.box{display:flex;flex-direction:column;gap:.6rem;width:100%;height:min(46rem,calc(100vh - 5rem));max-height:calc(100vh - 5rem);padding:1rem;background:var(--sa-bg);color:var(--sa-fg);border:1.5px solid var(--sa-border);border-radius:var(--sa-radius);box-shadow:var(--sa-shadow);overflow:hidden}',
    ':host([mode="inline"]) .box{position:static;height:auto;max-height:none;box-shadow:none}',
    '.top{display:flex;align-items:center;gap:.5rem;padding-bottom:.55rem;border-bottom:1px solid var(--sa-line)}',
    '.title{margin:0;font-size:1.05rem;font-weight:800;letter-spacing:-.01em;flex:1 1 auto;min-width:0;overflow-wrap:anywhere}',
    '.lang-toggle{display:inline-flex;align-items:center;gap:.35rem;min-height:2.75rem;padding:.35rem .7rem;font:inherit;font-size:.95rem;font-weight:700;color:var(--sa-btn-fg);background:var(--sa-btn-bg);border:1.5px solid var(--sa-btn-border);border-radius:999px;cursor:pointer;white-space:nowrap}',
    '.lang-toggle:hover{background:var(--sa-bot);color:var(--sa-accent-strong)}', '.lang-toggle svg{width:1.05rem;height:1.05rem;display:block;flex:0 0 auto}', '.lang-toggle .lang-code{letter-spacing:.02em}',
    '.icon-btn{display:inline-flex;align-items:center;justify-content:center;width:2.75rem;height:2.75rem;padding:0;border:1.5px solid transparent;border-radius:.6rem;background:transparent;color:var(--sa-btn-fg);cursor:pointer}',
    '.icon-btn:hover{background:var(--sa-bot);border-color:var(--sa-btn-border)}', '.icon-btn svg{width:1.2rem;height:1.2rem;display:block}',
    'button{font:inherit;color:var(--sa-btn-fg);background:var(--sa-btn-bg)}',
    '.actions button, .form button{min-height:2.75rem;padding:.5rem .9rem;font-size:.95rem;font-weight:600;color:var(--sa-btn-fg);background:var(--sa-btn-bg);border:1.5px solid var(--sa-btn-border);border-radius:.6rem;cursor:pointer}',
    '.actions button:hover, .form button:hover{background:var(--sa-bot);color:var(--sa-accent-strong)}',
    '.actions button.primary, .form button.primary{color:var(--sa-on-accent);background:var(--sa-accent);border-color:var(--sa-accent)}',
    '.actions button.primary:hover, .form button.primary:hover{background:var(--sa-accent-strong);border-color:var(--sa-accent-strong);color:var(--sa-on-accent)}',
    '.actions button[aria-pressed="true"], .form button[aria-pressed="true"]{color:var(--sa-on-accent);background:var(--sa-accent);border-color:var(--sa-accent)}',
    '.actions button[aria-disabled="true"], .form button[aria-disabled="true"]{opacity:.55;cursor:not-allowed}',
    'button:focus-visible,select:focus-visible,textarea:focus-visible,a:focus-visible,.log:focus-visible{outline:3px solid var(--sa-focus);outline-offset:2px}',
    'button:focus:not(:focus-visible),select:focus:not(:focus-visible),textarea:focus:not(:focus-visible),a:focus:not(:focus-visible){outline:none}',
    '.mode{margin:0;padding:.45rem .7rem;font-size:.9rem;font-weight:700;color:var(--sa-on-accent);background:var(--sa-accent);border-radius:.5rem;text-align:center}',
    '.log{display:flex;flex:1 1 auto;flex-direction:column;gap:.7rem;min-height:5rem;padding:.2rem;overflow-y:auto;scrollbar-width:thin;overscroll-behavior:contain}',
    ':host([mode="inline"]) .log{flex:0 1 auto;min-height:9rem;max-height:min(60vh,28rem)}',
    '.msg{max-width:88%;padding:.7rem .9rem;border-radius:1rem;overflow-wrap:anywhere;word-break:break-word}', '.msg p{margin:0}',
    '.user{align-self:flex-end;color:var(--sa-on-user);background:var(--sa-user);border-bottom-right-radius:.25rem}',
    '.bot{align-self:flex-start;color:var(--sa-fg);background:var(--sa-bot);border-bottom-left-radius:.25rem}',
    '.bot.err{border:2px solid var(--sa-error)}', '.bot.agent{border:2px solid var(--sa-accent)}',
    '.who{display:block;font-size:.85rem;font-weight:700;opacity:.85;margin-bottom:.15rem}', '.slabel{margin:.5rem 0 .15rem;font-size:.85rem;font-weight:700}',
    '.links{margin:0;padding:0;list-style:none;font-size:.9rem}', '.links li{margin:.15rem 0}', '.links a{color:var(--sa-accent);text-decoration:underline;text-underline-offset:.15em;font-weight:650}',
    '.actions{display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.5rem}', '.status{min-height:1.4rem;margin:0;color:var(--sa-muted);font-size:.9rem}',
    '.form{display:flex;flex:0 0 auto;flex-direction:column;gap:.4rem;padding-top:.4rem;border-top:1px solid var(--sa-line)}', 'label{font-size:.95rem;font-weight:700}',
    'textarea{width:100%;min-height:3.25rem;max-height:10rem;padding:.6rem .7rem;font:inherit;color:var(--sa-fg);background:var(--sa-bg);border:1.5px solid var(--sa-border);border-radius:.6rem;resize:vertical}',
    '.hint{margin:0;font-size:.82rem;color:var(--sa-muted);line-height:1.4}', '.row{display:flex;flex-wrap:wrap;gap:.4rem}', '.sr-only{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}',
    '@media (forced-colors:active){button,textarea,.msg,.mode,.lang-toggle{border:1px solid CanvasText}}',
    '@media(max-width:480px){:host:not([mode="inline"]){right:.5rem;bottom:.5rem;width:calc(100vw - 1rem)}:host:not([mode="inline"]) .box{height:calc(100vh - 5rem);max-height:calc(100vh - 5rem);padding:.75rem}}',
    '@media (prefers-reduced-motion:reduce){*{transition:none !important;animation:none !important}}',
    '</style>',
    '<div class="shell" id="shell">',
    '<section class="box" id="box" aria-labelledby="h" hidden>',
    '<header class="top">',
    '<h2 class="title" id="h" data-k="heading"></h2>',
    '<button type="button" class="lang-toggle" id="langToggle" aria-haspopup="true">',
    '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 3 2.5 15 0 18M12 3c-2.5 3-2.5 15 0 18"/></svg>',
    '<span class="lang-code" id="langCode">EN</span>',
    '</button>',
    '<button type="button" class="icon-btn" id="close" data-k="closeChat" aria-label="Close chat">',
    '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    '</button>',
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
    '<button type="button" id="cancelMic" data-k="cancelRecording" hidden></button>',
    '<button type="submit" id="send" class="primary" data-k="send"></button>',
    '<button type="button" id="endHuman" data-k="humanEnd" hidden></button>',
    '<button type="button" id="shareBtn" data-k="shareScreen" hidden></button>',
    '</div>',
    '</form>',
    '</section>',
    '<button type="button" class="launcher" id="launcher" aria-controls="box" aria-expanded="false">',
    '<span class="launcher-label" data-k="openChat"></span>',
    '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5h16v11H9l-5 3v-14z"/></svg>',
    '</button>',
    '</div>'
  ].join('');

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) { n.className = cls; }
    if (text) { n.textContent = text; }
    return n;
  }
  function guessLang(t, fallback) {
    if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(t)) { return 'ar'; }
    if (/[\u1200-\u139F]/.test(t)) { return fallback || 'am'; }
    return fallback || 'en';
  }
  function isHttp(u) { return /^https?:\/\//i.test(u || ''); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  class InclusiveAssistant extends HTMLElement {
    static get observedAttributes() { return ['lang', 'heading', 'mode', 'theme']; }

    constructor() {
      super();
      this._history = [];
      this._courseContext = null;
      this._open = false;
      this._busy = false;
      this._built = false;
      this._rec = null;
      this._speakBtn = null;
      this._statusTimer = 0;
      this._uid = 0;
      this._heard = false;
      this._micError = false;
      this._mediaRecorder = null;
      this._mediaStream = null;
      this._audioChunks = [];
      this._recordingTimer = 0;
      this._speechReview = null;
      this._speechAudio = null;
      this._human = null;
      this._stream = null;
      this._pc = null;
      this.attachShadow({ mode: 'open' });
    }

    get version() { return VERSION; }

    connectedCallback() {
      if (!this._built) { this._build(); this._built = true; }
      this._applyStrings();
      this._applyMode();
      this._emit('ready', { version: VERSION });
    }

    disconnectedCallback() {
      this._cancelRecording();
      this._discardRecording();
      this._stopSpeak();
      this._stopGeneratedAudio();
      this._stopShare();
      this._human = null;
    }

    attributeChangedCallback(name) {
      if (!this._built) { return; }
      this._applyStrings();
      if (name === 'mode') { this._applyMode(); }
    }

    ask(text) {
      this._q.value = String(text || '');
      return this._send();
    }

    setCourseContext(context) {
      if (context === null || context === undefined) { this._courseContext = null; return; }
      if (!context || typeof context !== 'object' || typeof context.text !== 'string' || !context.text.trim()) {
        throw new TypeError('Course context must include non-empty text.');
      }
      if (Array.from(context.text).length > 50000) {
        throw new RangeError('Course context must be limited to a relevant excerpt of 1000 characters.');
      }
      this._courseContext = {
        title: typeof context.title === 'string' ? context.title.trim().slice(0, 160) : '',
        text: context.text.trim(),
        url: typeof context.url === 'string' ? context.url : '',
        lang: typeof context.lang === 'string' ? context.lang : 'en'
      };
    }

    _lang() {
      var l = String(this.getAttribute('lang') || 'en').toLowerCase().slice(0, 2);
      return STRINGS[l] ? l : 'en';
    }
    _t(k) {
      var value = STRINGS[this._lang()][k];
      return value === undefined ? STRINGS.en[k] : value;
    }

    _emit(name, detail, cancelable) {
      var ev = new CustomEvent('inclusive-assistant:' + name, { detail: detail, bubbles: true, composed: true, cancelable: !!cancelable });
      this.dispatchEvent(ev);
      var legacy = new CustomEvent('savanna-assistant:' + name, { detail: detail, bubbles: true, composed: true, cancelable: !!cancelable });
      this.dispatchEvent(legacy);
      if (legacy.defaultPrevented) { ev.preventDefault(); }
      return ev;
    }

    _base() {
      return (this.getAttribute('api-url') || SCRIPT_ORIGIN || window.location.origin).replace(/\/+$/, '');
    }

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

    _cycleLanguage(direction) {
      var current = this._lang();
      var i = LANG_CYCLE.indexOf(current);
      if (i < 0) { i = 0; }
      var next = LANG_CYCLE[(i + (direction || 1) + LANG_CYCLE.length) % LANG_CYCLE.length];
      this._stopMic();
      this._stopSpeak();
      this.setAttribute('lang', next);
    }

    _build() {
      var self = this;
      var r = this.shadowRoot;
      r.innerHTML = TEMPLATE;
      this._shell = r.getElementById('shell');
      this._launcher = r.getElementById('launcher');
      this._closeBtn = r.getElementById('close');
      this._langToggle = r.getElementById('langToggle');
      this._langCode = r.getElementById('langCode');
      this._box = r.getElementById('box');
      this._log = r.getElementById('log');
      this._status = r.getElementById('status');
      this._q = r.getElementById('q');
      this._mic = r.getElementById('mic');
      this._cancelMic = r.getElementById('cancelMic');
      this._sendBtn = r.getElementById('send');
      this._endBtn = r.getElementById('endHuman');
      this._shareBtn = r.getElementById('shareBtn');
      this._modeEl = r.getElementById('mode');

      this._launcher.addEventListener('click', function () { self._setOpen(true, true); });
      this._closeBtn.addEventListener('click', function () { self._setOpen(false, true); });

      this._langToggle.addEventListener('click', function (e) { self._cycleLanguage(e.shiftKey ? -1 : 1); });
      this._langToggle.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); self._cycleLanguage(-1); }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); self._cycleLanguage(1); }
      });

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
      this._cancelMic.addEventListener('click', function () { self._cancelRecording(); });
      this._endBtn.addEventListener('click', function () {
        self._endHuman(true, 'humanEndedYou');
        this._q.focus();
      }.bind(this));
      this._shareBtn.addEventListener('click', function () { self._toggleShare(); });
      r.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          if (self._open && self.getAttribute('mode') !== 'inline') {
            e.preventDefault();
            self._setOpen(false, true);
          }
          self._stopMic();
          self._stopSpeak();
        }
      });
      r.addEventListener('click', function (event) {
        var target = event.target;
        if (target && target.getAttribute && target.getAttribute('data-speech-action')) {
          self._handleSpeechAction(target);
        }
      });

      this._addMessage('bot', '', { welcome: true, key: 'welcome' });
      if ('speechSynthesis' in window) {
        try { window.speechSynthesis.getVoices(); } catch (e) { /* warm up voice list */ }
      }
    }

    _fill(root) {
      var ui = STRINGS[this._lang()];
      Array.prototype.forEach.call(root.querySelectorAll('[data-k]'), function (n) {
        var key = n.getAttribute('data-k');
        var v = ui[key] === undefined ? STRINGS.en[key] : ui[key];
        if (v !== undefined) { n.textContent = v; }
      });
    }

    _applyStrings() {
      var lang = this._lang();
      var r = this.shadowRoot;
      this._box.setAttribute('lang', lang);
      this._box.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
      this._fill(r);
      this._langCode.textContent = LANG_SHORT[lang] || lang.toUpperCase();
      this._langToggle.setAttribute('lang', lang);
      this._langToggle.setAttribute('aria-label', 'Change language. Current: ' + (STRINGS[lang].langGroup || lang) + '. Press Enter for next, Shift and Enter for previous.');
      this._launcher.setAttribute('aria-label', this._t('openChat'));
      this._closeBtn.setAttribute('aria-label', this._t('closeChat'));
      var h = this.getAttribute('heading');
      if (h) { r.getElementById('h').textContent = h; }
      this._log.setAttribute('aria-label', STRINGS[lang].conversation);
    }

    _applyMode() {
      var inline = this.getAttribute('mode') === 'inline';
      if (inline) { this._open = false; }
      this._shell.className = inline ? 'shell inline' : this._open ? 'shell open' : 'shell';
      this._box.hidden = !inline && !this._open;
      this._launcher.hidden = inline || this._open;
      this._closeBtn.hidden = inline;
      this._launcher.setAttribute('aria-expanded', this._open ? 'true' : 'false');
    }

    _setOpen(open, returnFocus) {
      if (this.getAttribute('mode') === 'inline') { return; }
      this._open = !!open;
      this._shell.className = this._open ? 'shell open' : 'shell';
      this._box.hidden = !this._open;
      this._launcher.hidden = this._open;
      this._launcher.setAttribute('aria-expanded', this._open ? 'true' : 'false');
      if (this._open) { this._q.focus(); }
      else if (returnFocus) { this._launcher.focus(); }
    }

    _setStatus(text) {
      var s = this._status;
      clearTimeout(this._statusTimer);
      s.textContent = '';
      if (!text) { return; }
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
          var speechLanguage = opts.lang || this._lang();
          var read = el('button');
          read.type = 'button';
          read.setAttribute('data-k', 'readAloud');
          read.setAttribute('aria-describedby', p.id);
          read.addEventListener('click', function () { self._toggleSpeak(read, p.textContent, speechLanguage); });
          row.appendChild(read);
          if (['am', 'om', 'ti'].indexOf(speechLanguage) >= 0) {
            var addisRead = el('button');
            addisRead.type = 'button';
            addisRead.setAttribute('data-k', 'addisListen');
            addisRead.setAttribute('aria-describedby', p.id);
            addisRead.addEventListener('click', function () { self._toggleAddisSpeak(addisRead, p.textContent, speechLanguage); });
            row.appendChild(addisRead);
            var generated = el('div', 'actions');
            generated.hidden = true;
            var audio = document.createElement('audio');
            audio.controls = true;
            audio.preload = 'none';
            audio.setAttribute('aria-label', speechLanguage === 'am' ? 'የመልስ ድምፅ' : 'Generated answer audio');
            audio.setAttribute('lang', speechLanguage);
            audio.addEventListener('play', function () { self._syncAudioButtons(a); });
            audio.addEventListener('pause', function () { self._syncAudioButtons(a); });
            audio.addEventListener('ended', function () { self._syncAudioButtons(a); });
            audio.addEventListener('error', function () {
              if (audio._suppressAudioError) { audio._suppressAudioError = false; return; }
              audio.removeAttribute('src');
              audio.load();
              self._setStatus(self._t('speechUnavailable'));
            });
            a._speechAudio = audio;
            a._speechText = p.textContent;
            a._speechLang = speechLanguage;
            a._speechControls = generated;
            generated.appendChild(audio);
            var pauseAudio = el('button');
            pauseAudio.type = 'button';
            pauseAudio.setAttribute('data-speech-action', 'pause');
            pauseAudio.setAttribute('data-k', 'speechPause');
            pauseAudio.setAttribute('aria-describedby', p.id);
            pauseAudio.disabled = true;
            generated.appendChild(pauseAudio);
            var stopAudio = el('button');
            stopAudio.type = 'button';
            stopAudio.setAttribute('data-speech-action', 'stop');
            stopAudio.setAttribute('data-k', 'speechStop');
            stopAudio.setAttribute('aria-describedby', p.id);
            stopAudio.disabled = true;
            generated.appendChild(stopAudio);
            row.appendChild(generated);
          }
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
      var lang = this._speechReview && this._q.value.trim() === this._speechReview.original
        ? this._speechReview.language
        : this._lang();
      this._cancelRecording();
      this._speechReview = null;
      this._stopSpeak();

      if (this._human) { return this._sendHuman(text); }

      var self = this;
      this._addMessage('user', text, { lang: guessLang(text, lang) });
      this._q.value = '';
      this._setBusy(true);
      this._setStatus(this._t('thinking'));

      try {
        var request = {
          message: text,
          lang: lang
          // We are intentionally not sending history to keep answers isolated.
        };
        if (this._courseContext) { request.context = this._courseContext; }
        var data = await this._call('POST', '/v1/chat', request, '', 25000);
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

    _escalate(question) {
      var self = this;
      var ev = this._emit('escalate', { question: question, transcript: this._history.slice() }, true);
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

    _promptAccommodation() {
      if (this._human) { this._setStatus(this._t('humanAlready')); this._q.focus(); return; }
      this._pendingAccommodation = true;
      this._addMessage('bot', '', { key: 'accommodationPrompt', read: false });
      this._q.focus();
    }

    async _startAccommodation(text) {
      this._pendingAccommodation = false;
      this._addMessage('user', text, { lang: guessLang(text, this._lang()) });
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
      this._addMessage('user', text, { lang: guessLang(text, this._lang()) });
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

    async _pollHuman(h) {
      var fails = 0;
      while (this._human === h && this.isConnected) {
        try {
          var d = await this._call('GET', '/v1/handoff/' + h.id + '?after=' + h.after + '&wait=20', null, h.token, 35000);
          fails = 0;
          if (this._human !== h) { return; }
          var self = this;
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

    async _onRemoteSignal(m) {
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

    _stopMic() {
      if (this._rec) {
        try { this._rec.stop(); } catch (e) { }
        this._rec = null;
      }
      if (this._mediaRecorder && this._mediaRecorder.state !== 'inactive') {
        this._cancelRecordingFlag = true;
        try { this._mediaRecorder.stop(); } catch (e) { }
      }
    }

    _toggleMic() {
      var self = this;
      var lang = this._lang();

      // 1. If the language is English, use the browser's free native recognition
      if (lang === 'en') {
        var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) { this._setStatus(this._t('micUnsupported')); return; }

        if (this._rec) { this._stopMic(); return; }
        this._stopSpeak();

        var rec = new SR();
        rec.lang = 'en-US';
        rec.interimResults = false;
        rec.continuous = false;
        this._rec = rec;

        rec.onstart = function () {
          self._mic.setAttribute('aria-pressed', 'true');
          self._setStatus(self._t('listening'));
        };

        rec.onresult = function (e) {
          var t = '';
          for (var i = 0; i < e.results.length; i++) { t += e.results[i][0].transcript; }
          if (t.trim()) {
            self._q.value = self._q.value ? self._q.value + ' ' + t.trim() : t.trim();
            self._heard = true;
          }
        };

        rec.onerror = function (e) {
          self._setStatus(self._t(e.error === 'not-allowed' ? 'micDenied' : 'micUnsupported'));
        };

        rec.onend = function () {
          self._rec = null;
          self._mic.setAttribute('aria-pressed', 'false');
          if (self._heard) {
            self._setStatus(self._t('speechReady'));
            self._q.focus();
          }
        };

        try { rec.start(); } catch (e) { self._setStatus(self._t('micUnsupported')); }
        return;
      }

      // 2. For Amharic/Oromo/Tigrinya, record audio and send to Addis AI
      if (this._mediaRecorder && this._mediaRecorder.state === 'recording') {
        this._setStatus(this._t('transcribing'));
        this._mediaRecorder.stop();
        return;
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof window.MediaRecorder !== 'function') {
        this._setStatus(this._t('micUnsupported'));
        return;
      }

      this._stopSpeak();
      this._discardRecording();
      this._setStatus(this._t('connecting'));

      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
        if (!self.isConnected) { stream.getTracks().forEach(function (track) { track.stop(); }); return; }
        var preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
        var mimeType = '';
        for (var i = 0; i < preferred.length; i++) {
          if (window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported(preferred[i])) { mimeType = preferred[i]; break; }
        }
        var recorder;
        try { recorder = new window.MediaRecorder(stream, mimeType ? { mimeType: mimeType } : undefined); }
        catch (e) { stream.getTracks().forEach(function (track) { track.stop(); }); self._setStatus(self._t('micUnsupported')); return; }

        self._mediaStream = stream;
        self._mediaRecorder = recorder;
        self._audioChunks = [];
        self._cancelRecordingFlag = false;
        recorder.ondataavailable = function (event) { if (event.data && event.data.size) { self._audioChunks.push(event.data); } };

        recorder.onstart = function () {
          self._mic.setAttribute('aria-pressed', 'true');
          self._mic.setAttribute('data-k', 'stopRecording');
          self._fill(self.shadowRoot);
          self._cancelMic.hidden = false;
          self._setStatus(self._t('listening'));
          self._recordingTimer = setTimeout(function () {
            if (self._mediaRecorder === recorder && recorder.state === 'recording') {
              self._setStatus(self._t('recordingTooLong'));
              recorder.stop();
            }
          }, 30000);
        };

        recorder.onstop = function () {
          clearTimeout(self._recordingTimer);
          self._recordingTimer = 0;
          stream.getTracks().forEach(function (track) { track.stop(); });
          self._mediaStream = null;
          self._mediaRecorder = null;
          self._mic.setAttribute('aria-pressed', 'false');
          self._mic.setAttribute('data-k', 'mic');
          self._fill(self.shadowRoot);
          self._cancelMic.hidden = true;

          if (self._cancelRecordingFlag) {
            self._audioChunks = [];
            self._cancelRecordingFlag = false;
            self._setStatus('');
            return;
          }
          var blob = new Blob(self._audioChunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
          self._audioChunks = [];
          if (!blob.size) { self._setStatus(self._t('micNoSpeech')); return; }
          self._transcribe(blob);
        };
        try { recorder.start(250); }
        catch (e) { stream.getTracks().forEach(function (track) { track.stop(); }); self._mediaRecorder = null; self._setStatus(self._t('micUnsupported')); }
      }).catch(function (error) {
        self._setStatus(error && error.name === 'NotAllowedError' ? self._t('micDenied') : self._t('micUnsupported'));
      });
    }

    _cancelRecording() {
      if (!this._mediaRecorder || this._mediaRecorder.state === 'inactive') { return; }
      this._cancelRecordingFlag = true;
      this._setStatus('');
      try { this._mediaRecorder.stop(); } catch (e) { this._discardRecording(); }
    }

    _discardRecording() {
      clearTimeout(this._recordingTimer);
      this._recordingTimer = 0;
      if (this._mediaStream) {
        this._mediaStream.getTracks().forEach(function (track) { try { track.stop(); } catch (e) { /* already stopped */ } });
        this._mediaStream = null;
      }
      this._mediaRecorder = null;
      this._audioChunks = [];
      if (this._cancelMic) { this._cancelMic.hidden = true; }
      if (this._mic) { this._mic.setAttribute('aria-pressed', 'false'); }
    }

    _stopGeneratedAudio() {
      var root = this._log;
      if (!root) { return; }
      Array.prototype.forEach.call(root.querySelectorAll('audio'), function (audio) {
        if (!audio.src) { return; }
        try { audio._suppressAudioError = true; audio.pause(); audio.removeAttribute('src'); audio.load(); } catch (e) { /* detached or unsupported */ }
      });
    }

    async _toggleAddisSpeak(button, text, language) {
      var article = button.closest('article');
      var audio = article && article._speechAudio;
      if (!audio) { this._setStatus(this._t('speechUnavailable')); return; }
      if (audio.src) {
        try { await audio.play(); this._setStatus(''); } catch (e) { this._setStatus(this._t('speechUnavailable')); }
        return;
      }
      if (button.disabled) { return; }
      button.disabled = true;
      this._stopSpeak();
      this._cancelRecording();
      this._stopGeneratedAudio();
      this._setStatus(this._t('speechGenerating'));
      try {
        var result = await this._call('POST', '/v1/speech/synthesize', { text: String(text || '').replace(/\s*\[\d+\]/g, '').slice(0, 600), language: language }, '', 90000);
        if (!result.audioUrl || !/^https:\/\//i.test(result.audioUrl)) throw new Error('invalid_audio_url');
        audio.src = result.audioUrl;
        article._speechControls.hidden = false;
        button.disabled = false;
        await audio.play();
        this._setStatus('');
      } catch (e) {
        this._setStatus(e && e.code === 'unsupported_speech_language' ? this._t('ttsNoVoice') : this._t('speechGenerateFailed'));
        button.disabled = false;
      }
    }

    _handleSpeechAction(button) {
      var article = button.closest('article');
      var audio = article && article._speechAudio;
      if (!audio) { return; }
      var action = button.getAttribute('data-speech-action');
      if (action === 'pause') {
        if (audio.paused) { audio.play().catch(() => this._setStatus(this._t('speechUnavailable'))); }
        else audio.pause();
      }
      if (action === 'stop') {
        audio.pause();
        try { audio.currentTime = 0; } catch (e) { /* metadata may not be loaded */ }
        this._syncAudioButtons(article);
      }
    }

    _syncAudioButtons(article) {
      var audio = article && article._speechAudio;
      var controls = article && article._speechControls;
      if (!audio || !controls) { return; }
      var pause = controls.querySelector('[data-speech-action="pause"]');
      var stop = controls.querySelector('[data-speech-action="stop"]');
      var canControl = Boolean(audio.src) && !audio.ended;
      pause.disabled = !canControl;
      pause.setAttribute('data-k', audio.paused ? 'speechResume' : 'speechPause');
      this._fill(pause);
      stop.disabled = !Boolean(audio.src);
    }

    async _transcribe(blob) {
      this._setStatus(this._t('transcribing'));
      var body = new FormData();
      var extension = blob.type.indexOf('mp4') >= 0 ? 'm4a' : blob.type.indexOf('wav') >= 0 ? 'wav' : 'webm';
      body.append('language', this._lang());
      body.append('audio', blob, 'recording.' + extension);
      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); }, 90000);
      try {
        var response = await fetch(this._base() + '/v1/speech/transcribe', { method: 'POST', body: body, signal: controller.signal });
        var data = await response.json().catch(function () { return null; });
        if (!response.ok || !data || typeof data.text !== 'string') {
          var code = data && data.error && data.error.code;
          throw Object.assign(new Error(code || 'speech_failed'), { code: code, status: response.status });
        }
        this._q.value = data.text;
        this._speechReview = { original: data.text, language: data.language || this._lang() };
        this._setStatus(this._t('speechReady'));
        this._q.focus();
      } catch (e) {
        var statusKey = e && e.name === 'AbortError' ? 'speechTimeout' :
          e && e.code === 'speech_disabled' ? 'speechNotConfigured' :
            e && e.code === 'unsupported_speech_language' ? 'micLangUnsupported' : 'speechFailed';
        this._setStatus(this._t(statusKey));
      } finally {
        clearTimeout(timer);
        blob = null;
      }
    }

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
      if (!voice && lang !== 'en') { this._setStatus(this._t('ttsNoVoice')); return; }

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

  if (!window.customElements.get('inclusive-assistant')) {
    window.customElements.define('inclusive-assistant', InclusiveAssistant);
  }
  if (!window.customElements.get('savanna-assistant')) {
    class LegacyInclusiveAssistant extends InclusiveAssistant { }
    window.customElements.define('savanna-assistant', LegacyInclusiveAssistant);
  }
})();