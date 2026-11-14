const errorResponse = (description) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
});
const json = (ref) => ({ 'application/json': { schema: { $ref: `#/components/schemas/${ref}` } } });
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };
const afterParam = { name: 'after', in: 'query', schema: { type: 'integer', default: 0 }, description: 'Only return messages with a higher id.' };
const waitParam = { name: 'wait', in: 'query', schema: { type: 'integer', minimum: 0, maximum: 25 }, description: 'Long poll: hold the request up to this many seconds until something new arrives.' };

export const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'INCLUSIVE API',
    version: '0.2.0',
    description: 'Course-grounded tutor in Amharic and English, with human handoff. Answers only from course content, with citations. All errors use one format: { "error": { "code", "message" } }.'
  },
  components: {
    securitySchemes: {
      learnerToken: { type: 'http', scheme: 'bearer', description: 'The token returned when the handoff was created.' },
      agentKey: { type: 'http', scheme: 'bearer', description: 'The AGENT_KEY configured on the server.' }
    },
    schemas: {
      ChatRequest: {
        type: 'object', required: ['message'],
        properties: {
          message: { type: 'string', maxLength: 1000 },
          lang: { type: 'string', enum: ['am', 'en'], description: 'Optional. Detected from the message if omitted.' },
          history: { type: 'array', maxItems: 4, items: { type: 'object', properties: { role: { enum: ['user', 'assistant'] }, content: { type: 'string' } } } }
        }
      },
      ChatResponse: {
        type: 'object',
        properties: {
          answer: { type: 'string' },
          grounded: { type: 'boolean', description: 'false when no course content answered the question' },
          escalate: { type: 'boolean', description: 'true when the UI should offer one-click human help' },
          citations: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, url: { type: 'string' }, lang: { type: 'string' } } } },
          provider: { type: 'string', description: 'gemini | groq | offline | none' },
          lang: { type: 'string' }
        }
      },
      HandoffCreate: {
        type: 'object',
        properties: {
          question: { type: 'string', maxLength: 1000 },
          lang: { type: 'string', enum: ['am', 'en'] },
          transcript: { type: 'array', maxItems: 10, items: { type: 'object', properties: { role: { enum: ['user', 'assistant'] }, content: { type: 'string' } } } }
        }
      },
      HandoffCreated: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' }, token: { type: 'string', description: 'Secret. Keep it in memory only.' }, status: { type: 'string' } }
      },
      Message: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          from: { type: 'string', enum: ['learner', 'agent', 'system'] },
          text: { type: 'string' },
          code: { type: 'string', description: 'For system messages: agent_joined | closed_by_agent | closed_by_learner' },
          at: { type: 'integer', description: 'Epoch milliseconds' }
        }
      },
      HandoffView: {
        type: 'object',
        properties: { status: { type: 'string', enum: ['waiting', 'active', 'closed'] }, messages: { type: 'array', items: { $ref: '#/components/schemas/Message' } } }
      },
      Say: { type: 'object', required: ['text'], properties: { text: { type: 'string', maxLength: 1000 } } },
      Signal: { type: 'object', required: ['signal'], properties: { signal: { type: 'object', description: 'A WebRTC offer, answer, or ICE candidate. Opaque to the server and relayed as-is.' } } },
      SmsInbound: { type: 'object', required: ['from', 'text'], properties: { from: { type: 'string', description: 'Phone number as sent by the gateway.' }, text: { type: 'string', maxLength: 1000 } } },
      JobSubscribe: { type: 'object', required: ['channel', 'contact'], properties: { channel: { type: 'string', enum: ['telegram', 'sms'] }, contact: { type: 'string', description: 'Telegram chat id or phone number.' }, lang: { type: 'string', enum: ['am', 'en'] } } },
      AccommodationRequest: { type: 'object', required: ['request'], properties: { request: { type: 'string', maxLength: 1000, description: 'What the learner needs. Never a diagnosis.' }, lang: { type: 'string', enum: ['am', 'en'] } } },
      Broadcast: { type: 'object', required: ['text'], properties: { text: { type: 'string', maxLength: 1000 } } },
      SpeechSynthesisRequest: {
        type: 'object', required: ['text', 'language'],
        properties: {
          text: { type: 'string', maxLength: 600 },
          language: { type: 'string', enum: ['am', 'om', 'ti'], description: 'Addis Voices 2 languages. A currently available voice is selected from the Addis catalog.' }
        }
      },
      SpeechSynthesisResponse: {
        type: 'object', properties: {
          audioUrl: { type: 'string', format: 'uri', description: 'Signed Addis clip URL; do not persist indefinitely.' },
          voiceId: { type: 'string' }, language: { type: 'string' }, clipId: { type: 'string' }
        }
      },
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', description: 'Stable machine-readable code, e.g. rate_limited, invalid_json, message_required, text_required, not_found, closed, busy' },
              message: { type: 'string', description: 'Human-readable explanation' }
            }
          }
        }
      }
    }
  },
  paths: {
    '/health': { get: { summary: 'Liveness and loaded content', responses: { 200: { description: 'OK' } } } },
    '/v1/chat': {
      post: {
        summary: 'Ask the tutor a question',
        requestBody: { required: true, content: json('ChatRequest') },
        responses: {
          200: { description: 'Answer', content: json('ChatResponse') },
          400: errorResponse('invalid_json, message_required'),
          413: errorResponse('body_too_large'),
          429: errorResponse('rate_limited')
        }
      }
    },
    '/v1/speech/transcribe': {
      post: {
        summary: 'Transcribe a short uploaded recording using Addis Scribe. Raw audio is not stored.',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['audio', 'language'],
                properties: {
                  audio: { type: 'string', format: 'binary' },
                  language: { type: 'string', enum: ['am', 'om', 'ti', 'en'] }
                }
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Transcript for learner review',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    text: { type: 'string' },
                    language: { type: 'string' },
                    requestId: { type: 'string' }
                  }
                }
              }
            }
          },
          400: errorResponse('audio_required, unsupported_audio_format'),
          413: errorResponse('audio_too_large, audio_too_long'),
          422: errorResponse('unsupported_speech_language, invalid_audio'),
          429: errorResponse('rate_limited'),
          503: errorResponse('speech_disabled')
        }
      }
    },
    '/v1/speech/synthesize': {
      post: {
        summary: 'Create a user-requested Addis Voices 2 clip for Amharic, Afaan Oromo, or Tigrinya text.',
        requestBody: { required: true, content: json('SpeechSynthesisRequest') },
        responses: {
          200: { description: 'Signed playable audio URL', content: json('SpeechSynthesisResponse') },
          400: errorResponse('text_required'),
          413: errorResponse('speech_text_too_long'),
          422: errorResponse('unsupported_speech_language, speech_voice_unavailable'),
          429: errorResponse('rate_limited'),
          503: errorResponse('speech_disabled')
        }
      }
    },
    '/v1/handoff': {
      post: {
        summary: 'Ask for a person. Call only after the learner agrees to share their chat.',
        requestBody: { content: json('HandoffCreate') },
        responses: { 201: { description: 'Created', content: json('HandoffCreated') }, 429: errorResponse('rate_limited'), 503: errorResponse('busy') }
      }
    },
    '/v1/handoff/{id}': {
      get: {
        summary: 'Learner: read new messages (supports long polling)',
        security: [{ learnerToken: [] }],
        parameters: [idParam, afterParam, waitParam],
        responses: { 200: { description: 'Status and new messages', content: json('HandoffView') }, 404: errorResponse('not_found') }
      }
    },
    '/v1/handoff/{id}/messages': {
      post: {
        summary: 'Learner: send a message to the person',
        security: [{ learnerToken: [] }],
        parameters: [idParam],
        requestBody: { required: true, content: json('Say') },
        responses: { 201: { description: 'Sent' }, 400: errorResponse('text_required'), 404: errorResponse('not_found'), 409: errorResponse('closed') }
      }
    },
    '/v1/handoff/{id}/close': {
      post: {
        summary: 'Learner: end the chat. The shared transcript is erased.',
        security: [{ learnerToken: [] }],
        parameters: [idParam],
        responses: { 200: { description: 'Closed' }, 404: errorResponse('not_found') }
      }
    },
    '/v1/handoff/{id}/signal': {
      post: {
        summary: 'Learner: send a WebRTC signal (offer, answer, or ICE candidate) to start or support screen sharing. Only works once a person has joined.',
        security: [{ learnerToken: [] }],
        parameters: [idParam],
        requestBody: { required: true, content: json('Signal') },
        responses: {
          201: { description: 'Sent' },
          400: errorResponse('signal_required, invalid_signal'),
          404: errorResponse('not_found'),
          409: errorResponse('closed, not_active'),
          413: errorResponse('signal_too_large')
        }
      }
    },
    '/v1/agent/handoffs': {
      get: { summary: 'Support person: open chats', security: [{ agentKey: [] }], responses: { 200: { description: 'List' }, 401: errorResponse('unauthorized'), 503: errorResponse('agent_disabled') } }
    },
    '/v1/agent/handoffs/{id}': {
      get: { summary: 'Support person: one chat with transcript (supports long polling)', security: [{ agentKey: [] }], parameters: [idParam, afterParam, waitParam], responses: { 200: { description: 'Chat' }, 401: errorResponse('unauthorized'), 404: errorResponse('not_found') } }
    },
    '/v1/agent/handoffs/{id}/messages': {
      post: { summary: 'Support person: reply', security: [{ agentKey: [] }], parameters: [idParam], requestBody: { required: true, content: json('Say') }, responses: { 201: { description: 'Sent' }, 400: errorResponse('text_required'), 409: errorResponse('closed') } }
    },
    '/v1/agent/handoffs/{id}/close': {
      post: { summary: 'Support person: close the chat', security: [{ agentKey: [] }], parameters: [idParam], responses: { 200: { description: 'Closed' } } }
    },
    '/v1/agent/handoffs/{id}/signal': {
      post: { summary: 'Support person: send a WebRTC signal for screen sharing', security: [{ agentKey: [] }], parameters: [idParam], requestBody: { required: true, content: json('Signal') }, responses: { 201: { description: 'Sent' }, 400: errorResponse('signal_required, invalid_signal'), 409: errorResponse('closed, not_active'), 413: errorResponse('signal_too_large') } }
    },
    '/v1/sms/inbound': {
      post: {
        summary: 'Gateway webhook: an inbound SMS arrived. Protected by SMS_INBOUND_KEY as a bearer token. The exact request shape may need adjusting to match the real gateway chosen at kick-off.',
        security: [{ agentKey: [] }],
        requestBody: { required: true, content: json('SmsInbound') },
        responses: { 200: { description: 'Accepted' }, 401: errorResponse('unauthorized'), 503: errorResponse('sms_disabled') }
      }
    },
        '/v1/sms/outbox': {
      get: { summary: 'Demo/testing only: the console simulator\u2019s sent messages (not available when a real gateway is configured)', security: [{ agentKey: [] }], parameters: [afterParam], responses: { 200: { description: 'Sent messages' } } }
    },
    '/v1/jobs/subscribe': {
      post: { summary: 'Subscribe to job alerts by Telegram or SMS', requestBody: { required: true, content: json('JobSubscribe') }, responses: { 201: { description: 'Subscribed' }, 400: errorResponse('channel_required, contact_required'), 429: errorResponse('rate_limited') } }
    },
    '/v1/jobs/unsubscribe': {
      post: { summary: 'Unsubscribe from job alerts', requestBody: { required: true, content: json('JobSubscribe') }, responses: { 200: { description: 'Unsubscribed' }, 400: errorResponse('contact_required'), 429: errorResponse('rate_limited') } }
    },
    '/v1/accommodations': {
      post: {
        summary: 'Request interview accommodations, without disclosing a diagnosis. Creates a session reachable through the same /v1/handoff/{id} endpoints as human help.',
        requestBody: { required: true, content: json('AccommodationRequest') },
        responses: { 201: { description: 'Created', content: json('HandoffCreated') }, 400: errorResponse('request_required'), 429: errorResponse('rate_limited'), 503: errorResponse('busy') }
      }
    },
    '/v1/agent/jobs/broadcast': {
      post: { summary: 'Support person: send a job alert to every subscriber', security: [{ agentKey: [] }], requestBody: { required: true, content: json('Broadcast') }, responses: { 200: { description: 'Delivery summary: sent, failed, total' }, 400: errorResponse('text_required'), 401: errorResponse('unauthorized'), 429: errorResponse('rate_limited') } }
    }
  }
};