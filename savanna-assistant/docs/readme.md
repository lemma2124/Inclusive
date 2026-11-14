# Savanna Assistant

A bilingual (English and Amharic) course assistant for learners. It answers questions from course content with sources, hands over to a real person on request, and offers a career gateway (job alerts and interview accommodations). It works on the web, on Telegram and by SMS. Vanilla JavaScript and Node, no front-end framework, no database.

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
| Voice input and read-aloud | Yes (browser-dependent) | No | No |
| Talk to a person (with consent) | Yes | Yes | Yes |
| Screen sharing with a support person | Yes | No | No |
| Job information | Yes | Yes | Yes |
| Job alert subscription | API | `/jobs` | `JOBS` |
| Interview accommodation request (no diagnosis needed) | Yes | `/accommodation` | `ACCOMMODATION` |

## 2. Quick start

Requirements: Node.js CONFIRM (18 or newer), npm. A Telegram bot token is optional.

```
git clone CONFIRM-REPO-URL
cd savanna-assistant
npm install
copy .env.example .env
```

(On macOS or Linux use `cp .env.example .env`.)

Open `.env` and set at least `AGENT_KEY`. Then:

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
| CONFIRM AI variables | CONFIRM | Provider, key and model. |
| `PORT` | No | Defaults to 8787. |

## 4. Architecture

```
Web widget (<savanna-assistant>) --+
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
| `widget/savanna-assistant.v1.js` | Web component, version 1.3.0 |
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

## 7. Embedding the widget

```html
<script src="https://YOUR-SERVER/widget/savanna-assistant.v1.js" defer></script>
<savanna-assistant lang="en"
  api-url="https://YOUR-SERVER"
  source-base="https://YOUR-SITE"
  support-url="https://YOUR-SUPPORT-PAGE"></savanna-assistant>
```

| Attribute | Meaning |
|---|---|
| `lang` | `en` or `am` |
| `api-url` | API address (defaults to where the script came from) |
| `source-base` | Turns relative source links into full links |
| `support-url` | Fallback link if human help is unavailable |
| `heading` | Custom title |
| `theme` | `light` or `dark` (otherwise follows the device) |

Events (prefix `savanna-assistant:`): `ready`, `answer`, `error`, `escalate` (cancelable), `handoff`, `accommodation`.

## 8. Swapping the AI provider

CONFIRM: describe the file that talks to the AI provider, the `.env` variables that choose it, and the steps to add another provider. If answers come only from `content/` without an external AI, say that here instead.

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

CONFIRM: expected number of passing tests (27 after Step 7).

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

## Licence
CONFIRM (the widget header says MIT).