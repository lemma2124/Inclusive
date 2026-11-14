export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT) || 8787,
    providers: (env.AI_PROVIDERS || 'gemini,groq,offline').split(',').map((s) => s.trim()).filter(Boolean),
    geminiKey: env.GEMINI_API_KEY || '',
    geminiModel: env.GEMINI_MODEL || 'gemini-2.5-flash',
    groqKey: env.GROQ_API_KEY || '',
    groqModel: env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    timeoutMs: Number(env.AI_TIMEOUT_MS) || 8000,
    minCoverage: env.MIN_COVERAGE !== undefined ? Number(env.MIN_COVERAGE) : 0.3,
    corsOrigin: env.CORS_ORIGIN || '*',
    rateLimitPerMin: Number(env.RATE_LIMIT_PER_MIN) || 30,
    handoffRateLimitPerMin: Number(env.HANDOFF_RATE_LIMIT_PER_MIN) || 5,
    agentKey: env.AGENT_KEY || '',
    internalKey: env.INTERNAL_KEY || '',
    smsProvider: env.SMS_PROVIDER || 'console',
    smsInboundKey: env.SMS_INBOUND_KEY || '',
    smsWebhookUrl: env.SMS_WEBHOOK_URL || '',
    smsWebhookKey: env.SMS_WEBHOOK_KEY || '',
    telegramBotToken: env.TELEGRAM_BOT_TOKEN || '',
    addisAiKey: env.ADDIS_AI_API_KEY || '',
    addisAiBaseUrl: env.ADDIS_AI_BASE_URL || 'https://api.addisassistant.com',
    contentDir: env.CONTENT_DIR || ''
  };
}