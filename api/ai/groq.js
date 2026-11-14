import { ProviderError, retryAfter } from './errors.js';

// Adapter for OpenAI-compatible chat-completion APIs, used by Groq and Ollama.
export function createOpenAICompatible({ name = 'groq', baseUrl = 'https://api.groq.com/openai/v1', apiKey, model, cloud = true, requiresApiKey = cloud, fetchImpl = fetch }) {
  return {
    name,
    cloud,
    available: () => Boolean(apiKey) || !requiresApiKey,
    async generate({ system, messages, signal }) {
      const headers = { 'content-type': 'application/json' };
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;
      const res = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        signal,
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: 600,
          messages: [{ role: 'system', content: system }, ...messages]
        })
      });
      if (!res.ok) throw new ProviderError(`${name} http ${res.status}`, { status: res.status, retryAfterMs: retryAfter(res) });
      const data = await res.json();
      const text = (data?.choices?.[0]?.message?.content || '').trim();
      if (!text) throw new ProviderError(`${name} empty response`);
      return { text };
    }
  };
}