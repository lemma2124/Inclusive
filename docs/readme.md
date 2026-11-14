# INCLUSIVE

A course-grounded assistant for learners. The web widget can request answers in English, Amharic, Tigrinya, Afaan Oromo, Somali, or Arabic using English and Amharic source content; Telegram and SMS remain English/Amharic. It cites course sources, offers human handoff, and provides job alerts and interview accommodations. Vanilla JavaScript and Node, no front-end framework, no database.

## Contents
1. Features
2. Quick start (under 1 hour)
3. Configuration
4. Architecture
5. Using each channel
6. API
7. Embedding the widget
8. Swapping the AI provider
9. Privacy and safety
10. Accessibility
11. Testing
12. Troubleshooting
13. Known limitations

## 1. Features

| Capability | Web | Telegram | SMS |
|---|---|---|---|
| Course questions with cited sources | Yes | Yes | Yes |
| English and Amharic | Yes | Yes | Yes |
| Web chat reply language selection (English, Amharic, Tigrinya, Afaan Oromo, Somali, Arabic) | Yes | No | No |
| Voice input and read-aloud | Yes (browser-dependent) | No | No |
| Talk to a person (with consent) | Yes | Yes | Yes |
| Screen sharing with a support person | Yes | No | No |
| Job information | Yes | Yes | Yes |
| Job alert subscription | API | `/jobs` | `JOBS` |
| Interview accommodation request (no diagnosis needed) | Yes | `/accommodation` | `ACCOMMODATION` |

## 2. Quick start

Requirements: Node.js 20.12 or newer and npm. A Telegram bot token is optional.

```
cd savanna-assistant
npm install
copy .env.example .env
```

(On macOS or Linux use `cp .env.example .env`.)

Open `.env` and set a strong, private `AGENT_KEY` to enable the support console. Set `SMS_INBOUND_KEY` to enable SMS. The example file leaves secrets blank; never commit real credentials. Then:

```
npm test
npm start
```

The server runs on http://localhost:8787. Open:

| URL | What it is |
|---|---|
| `/demo` | The assistant widget |
| `/agent` | Support person console (needs `AGENT_KEY`) |
| `/sms-demo` | SMS simulator (needs `SMS_INBOUND_KEY`) |

Optional Telegram bot, in a second terminal:

```
npm run bot
```

### Five-minute tour
1. Open `/demo` and ask a course question. You get an answer with sources.
2. Ask something off-topic and press **Talk to a person**. Confirm consent.
3. In another tab open `/agent`, enter your `AGENT_KEY`, join the chat and reply.
4. Back in `/demo`, press **Request interview accommodations** and describe a need. It appears in `/agent` tagged "Accommodation".
5. Send a job alert (section 5).

## 3. Configuration

All settings are in `.env`. Copy `.env.example` and edit it.

| Variable | Required | Purpose |
|---|---|---|
| `AGENT_KEY` | For `/agent` and job broadcasts | Secret for the support console. Use a long random value. |
| `TELEGRAM_BOT_TOKEN` | For Telegram | Token from @BotFather. Used by the bot and by job alerts. |
| `SMS_INBOUND_KEY` | For SMS | Secret the SMS gateway sends with inbound messages. Empty means SMS is off. |
| `SMS_PROVIDER` | No | `webhook` for a real gateway, otherwise the console simulator. |
| `SMS_WEBHOOK_URL` | With `webhook` | Where outbound SMS are sent. |
| `SMS_WEBHOOK_KEY` | With `webhook` | Key sent to the gateway. |
| `AI_PROVIDERS` | No | Provider priority list; defaults to `gemini,ollama,offline`. Offline is always added as a fallback. |
| `OLLAMA_BASE_URL` | No | Local Ollama OpenAI-compatible endpoint; defaults to `http://127.0.0.1:11434/v1`. |
| `OLLAMA_MODEL` | No | Local Ollama model; defaults to `aya-expanse:8b`. Install/pull the model before use. |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | No | Optional Gemini API key and model. |
| `GROQ_API_KEY`, `GROQ_MODEL` | No | Optional Groq API key and model. |
| `ADDIS_API_KEY` | For Addis speech | Optional server-only key for speech-to-text and text-to-speech. Speech calls may be billed. |
| `AI_TIMEOUT_MS` | No | Provider timeout in milliseconds; defaults to 8000. |
| `MIN_COVERAGE` | No | Minimum course-content match threshold; defaults to 0.3. |
| `CORS_ORIGIN` | No | `*` or a comma-separated origin allowlist. |
| `RATE_LIMIT_PER_MIN` | No | Per-IP chat limit; defaults to 30. |
| `INTERNAL_KEY` | No | Optional shared secret for trusted internal clients such as the Telegram bot. |
| `API_URL` | For Telegram | API server URL used by the bot; defaults to `http://localhost:8787`. |
| `PORT` | No | Defaults to 8787. |

## 4. Architecture

```
Web widget (<inclusive-assistant>) --+
Telegram bot (telegram/bot.js) ----+--> API server (api/server.js)
SMS gateway -----------------------+        |
                                            +-- chat + retrieval over content/*.json
                                            +-- handoff store (human help, accommodations, screen-share signals)
                                            +-- job store + alert service
                                            +-- OpenAPI spec (api/openapi.js)

Support person --> /agent console --> /v1/agent/* (Bearer AGENT_KEY)
```

| Path | Purpose |
|---|---|
| `api/server.js` | HTTP server, routing, rate limits |
| `api/openapi.js` | OpenAPI description of every endpoint |
| `api/lib/config.js` | Reads `.env` into one config object |
| `api/handoff/store.js` | Human-help sessions, `kind` is `support` or `accommodation` |
| `api/sms/session.js` | SMS conversation logic |
| `api/jobs/` | Job subscriptions, Telegram sender, alert broadcast |
| `content/` | Knowledge base (course content, `jobs-en.json`, `jobs-am.json`) |
| `widget/savanna-assistant.v1.js` | Widget implementation file; the branded public element is `<inclusive-assistant>`. |
| `widget/agent.html` | Support console |
| `telegram/bot.js` | Telegram bot |
| `tests/core.test.js` | Automated tests |
| `tests/a11y.mjs` | axe-core accessibility scan |

## 5. Using each channel

| | Telegram | SMS |
|---|---|---|
| Language | `/en`, `/am` | `EN`, `AM` |
| Human help | `/human`, `/end` | `HUMAN`, `END` |
| Job alerts | `/jobs`, `/unsubscribe` | `JOBS`, `UNSUBSCRIBE` or `STOP` |
| Interview accommodation | `/accommodation`, `/cancel` | `ACCOMMODATION`, `CANCEL` |

Send a job alert to all subscribers (Windows):

```
curl -X POST http://localhost:8787/v1/agent/jobs/broadcast -H "authorization: Bearer YOUR_AGENT_KEY" -d "{\"text\":\"New job: Customer Support Rep, apply by Friday\"}"
```

The reply shows `sent`, `failed` and `total`.

## 6. API

| Method and path | Auth | Purpose |
|---|---|---|
| `POST /v1/chat` | none | Ask a question. Returns answer, citations, `escalate` |
| `POST /v1/handoff` | none | Start human help. Returns `id` and a learner `token` |
| `GET /v1/handoff/:id?after=&wait=` | learner token | Long-poll for new messages |
| `POST /v1/handoff/:id/messages` | learner token | Learner sends a message |
| `POST /v1/handoff/:id/signal` | learner token | Screen-share signalling |
| `POST /v1/handoff/:id/close` | learner token | End the chat |
| `POST /v1/accommodations` | none | Request interview accommodation (creates a session with `kind: accommodation`) |
| `POST /v1/jobs/subscribe` | none | `channel` (`telegram` or `sms`), `contact`, `lang` |
| `POST /v1/jobs/unsubscribe` | none | Same body |
| `GET /v1/agent/handoffs` | agent key | List waiting and active chats |
| `GET /v1/agent/handoffs/:id` | agent key | View one chat |
| `POST /v1/agent/jobs/broadcast` | agent key | `text`. Returns `{sent, failed, total}` |
| `GET /v1/sms/outbox` | SMS key | Demo only |

The full machine-readable spec is in `api/openapi.js`.

## Speech services: Addis AI

Addis AI is an optional speech service, separate from the LLM and course retrieval. It does not answer questions or generate course facts. The browser records only after explicit user action, submits a short multipart recording to the INCLUSIVE backend, receives a transcription for review/editing, then uses the existing `/v1/chat` flow. Addis Voices 2 is called only after the learner presses the per-answer Listen button. No automatic recording or audio playback occurs.

### Configuration and API routes

Set `ADDIS_API_KEY` in the server's private `.env`; never put it in widget code or logs. Leave it empty to disable speech features while preserving typed chat and existing browser read-aloud where available.

| Route | Request / response | Limits |
|---|---|---|
| `POST /v1/speech/transcribe` | `multipart/form-data`: `audio` file and `language` (`am`, `om`, `ti`, `en`). Returns `{text, language, requestId}` for user review. | WebM, WAV, MP3, M4A; 8 MB and 30 seconds; rate limited. |
| `POST /v1/speech/synthesize` | JSON `{text, language}` where TTS supports `am`, `om`, `ti`. Returns `{audioUrl, voiceId, language, clipId?}`. | 600 characters; rate limited; voice chosen from currently available Addis catalog entries. |

Audio is parsed in memory, not written to disk, and the transcription buffer is cleared after the provider request. Addis API errors are translated into safe local errors; keys and provider response bodies are not returned to clients. TTS URLs are signed/temporary and should not be persisted. The app does not cache generated clips, so each new Listen request can incur a charge; once generated for a particular response, replay reuses that clip URL in the current page.

### Supported speech versus chat languages

The web widget can request chat replies in English (`en`), Amharic (`am`), Tigrinya (`ti`), Afaan Oromo (`om`), Somali (`so`), or Arabic (`ar`). The curated course passages remain English and Amharic; replies in other languages are generated from those passages, are cited, and have not been independently reviewed. Addis Scribe speech-to-text remains available for English, Amharic, Afaan Oromo, and Tigrinya only. Addis Voices text-to-speech remains available for Amharic, Afaan Oromo, and Tigrinya only. Somali and Arabic are typed-chat languages; their selection in the speech dropdown does not add provider speech support.

### Costs, security, and setup

The official documentation currently lists Scribe at 3.5 ETB per 1,000 final transcript characters and Addis Voices 2 at 5 ETB per generated minute. Check the [official pricing page](https://docs.addisassistant.com/docs/platform/pricing) and account balance; prices may change. These are paid, wallet-based services, not assumed free-tier features. Per-IP request limits reduce abuse but do not cap account spending.

The backend sends `x-api-key` server-side only. STT supplies a unique `request_id`; Addis documents that accepted transcription may complete and be billed even if a client disconnects. Avoid sensitive speech and tell users that recordings are sent to Addis AI for transcription. Production deployment requires HTTPS for browser microphone permissions.

Official references: [Speech-to-Text](https://docs.addisassistant.com/docs/capabilities/speech-to-text), [Text-to-Speech](https://docs.addisassistant.com/docs/capabilities/text-to-speech), [Web integration security](https://docs.addisassistant.com/docs/integration/web).

## 7. Embedding the widget

```html
<script src="https://YOUR-SERVER/widget/inclusive-assistant.v1.js" defer></script>
<inclusive-assistant lang="en"
  api-url="https://YOUR-SERVER"
  source-base="https://YOUR-SITE"
  support-url="https://YOUR-SUPPORT-PAGE"></inclusive-assistant>
```

| Attribute | Meaning |
|---|---|
| `lang` | `en`, `am`, `ti`, `om`, `so`, or `ar` |
| `api-url` | API address (defaults to where the script came from) |
| `source-base` | Turns relative source links into full links |
| `support-url` | Fallback link if human help is unavailable |
| `mode="inline"` | Optional: render the full assistant in the page instead of as a floating launcher |
| `heading` | Custom title |
| `theme` | `light` or `dark` (otherwise follows the device) |

By default, the assistant appears as a fixed floating button at the bottom-right of the page. Activate it to open the chat; use Close or Escape to collapse it. The panel and controls are isolated in the component's Shadow DOM. Add `mode="inline"` to render the full assistant inline, as on the demo page.

Events (prefix `inclusive-assistant:`): `ready`, `answer`, `error`, `escalate` (cancelable), `handoff`, `accommodation`. The former `savanna-assistant` custom element, asset URL, and event prefix remain supported as backward-compatible aliases.

### Supplying the current course lesson

The widget cannot infer ALX lesson content from the INCLUSIVE server. Add a small host-page bridge using the real ALX selectors for the visible lesson title and text:

```js
(async function connectCurrentLesson() {
  await customElements.whenDefined('inclusive-assistant');
  const assistant = document.querySelector('inclusive-assistant');
  const lesson = document.querySelector('[REPLACE_WITH_LESSON_CONTENT_SELECTOR]');
  const title = document.querySelector('[REPLACE_WITH_LESSON_TITLE_SELECTOR]');
  if (!assistant) return;
  if (!lesson) {
    assistant.setCourseContext(null);
    return;
  }
  assistant.setCourseContext({
    title: title ? title.innerText : document.title,
    text: lesson.innerText,
    url: location.origin + location.pathname,
    lang: (document.documentElement.lang || 'en').slice(0, 2)
  });
})();
```

Replace both selectors with selectors confirmed on the ALX page, and call `setCourseContext()` again after client-side lesson navigation. It accepts a relevant excerpt up to 1,000 characters in English or Amharic; only a matching excerpt is passed to the answer provider and cited. Do not send grades, learner details, hidden page content, or material you are not authorized to share. Add the ALX site origin to the API's `CORS_ORIGIN` allowlist. On Render, set `AI_PROVIDERS=gemini,ollama,offline` and `GEMINI_API_KEY` in the service environment; never put the key in this bridge.

## 8. AI providers and grounded answers

Course passage retrieval happens before any AI call. If no relevant passage is found, the assistant does not call a model and instead offers human help. When a passage is found, the configured providers can phrase a grounded answer; the built-in offline provider is the final fallback and can run without external API keys.

Provider implementations and routing live in `api/ai/`. Gemini is first in the default provider order and is enabled when `GEMINI_API_KEY` is set in `.env`; Ollama and offline remain fallbacks. For local Ollama first, set `AI_PROVIDERS=ollama,gemini,offline`. Cloud providers are subject to message redaction. The server start script loads `.env` with Node's native `--env-file` option.

The web widget's chat selector accepts English (`en`), Amharic (`am`), Tigrinya (`ti`), Afaan Oromo (`om`), Somali (`so`), and Arabic (`ar`). The selected language is passed to the configured answer provider. The retriever currently has reviewed English and Amharic passages only, so answers in other languages are generated from those source passages rather than supported by translated course content. Keep citations visible and seek human help when retrieval cannot ground an answer.

## 9. Privacy and safety

- Human help always asks for consent first and warns against sharing passwords or ID numbers.
- Interview accommodation requests never ask for a diagnosis or medical condition.
- No accounts and no database. Everything is in memory and is lost when the server restarts.
- Screen sharing is started only by the learner and uses the browser's own sharing controls.
- Endpoints are rate limited. Support endpoints need a secret key.

## 10. Accessibility

Target: WCAG 2.2 Level AA. Method and results are in `docs/ACCESSIBILITY.md`.

Run the automated check with the server running:

```
npm run a11y
```

## 11. Testing

```
npm test
```

The test suite covers retrieval, chat grounding, provider fallback, HTTP routes, rate limits, handoff, SMS, job alerts, and accommodations. The test runner prints the current pass/fail count.

## 12. Troubleshooting

| Problem | Fix |
|---|---|
| `EADDRINUSE` (port in use) | Stop the other process or set `PORT` in `.env` |
| `/agent` says unauthorized | `AGENT_KEY` is missing or does not match what you typed |
| `/sms-demo` or SMS does nothing | Set `SMS_INBOUND_KEY` in `.env` and restart |
| Telegram bot does not reply | Check `TELEGRAM_BOT_TOKEN`, and that `npm run bot` is running |
| Job alert shows `failed` for Telegram | No token set, or that person never messaged the bot |
| Amharic is not read aloud | The device has no Amharic voice. The widget shows a notice |
| Voice input unsupported | Use Chrome or Edge, or type the question |
| Screen sharing fails | Some networks block it. Describe the problem in words instead |

## 13. Known limitations

- Handoff sessions and job subscriptions are in memory and reset on restart.
- `STOP` unsubscribes from job alerts only when the learner is not in a human chat. Carriers treat STOP as a global opt-out, so `UNSUBSCRIBE` is also supported.
- Telegram alerts only reach people who have messaged the bot at least once (Telegram's rule).
- There is no admin page for broadcasts, only the API.
- Amharic text was machine-drafted and needs review by a fluent speaker.
- Amharic voice features depend on the device.
- Screen sharing uses STUN only, with no TURN server, so it can fail on strict networks.
- The Telegram bot does not handle voice messages.
- Manual accessibility testing is documented in `docs/ACCESSIBILITY.md`, including anything still pending.

## License

The package metadata declares the MIT license. Add or retain the repository's MIT license text when distributing the project.