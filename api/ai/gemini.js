import { ProviderError, retryAfter } from './errors.js';

// Google AI Studio free tier (Flash models). Free-tier inputs may be used by
// Google for product improvement, so the router redacts personal data first.
export function createGemini({ apiKey, model, fetchImpl = fetch }) {
  return {
    name: 'gemini',
    cloud: true,
    available: () => Boolean(apiKey),
    async generate({ system, messages, signal }) {
      const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
          generationConfig: { temperature: 0.2, maxOutputTokens: 800 }
        })
      });
      if (!res.ok) throw new ProviderError(`gemini http ${res.status}`, { status: res.status, retryAfterMs: retryAfter(res) });
      const data = await res.json();
      const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
      if (!text) throw new ProviderError('gemini empty response');
      return { text };
    }
  };
}