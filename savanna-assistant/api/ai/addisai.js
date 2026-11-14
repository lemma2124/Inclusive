import { ProviderError } from './errors.js';

// Addis AI (addisassistant.com): purpose-built for Amharic and Afaan Oromo.
// UNLIKE Gemini/Groq in this project, this is a PAID, credit-metered service
// (billed from a prepaid wallet), not an ongoing free tier. It must never be
// enabled by default: it only runs if the person deliberately adds 'addisai'
// to AI_PROVIDERS in their own .env, after getting a key and understanding
// the cost. Auth uses x-api-key, not Authorization: Bearer, unlike the other
// two adapters in this project.
//
// Confirmed native REST response shape (from the official API overview docs,
// 2026-10-27): { response_text, finish_reason, usage_metadata, modelVersion }.
// This is NOT the same as the SDK's response.choices/response.usage surface,
// which is a client-side wrapper over this raw shape.
export function createAddisAI({ apiKey, baseUrl = 'https://api.addisassistant.com', fetchImpl = fetch }) {
  return {
    name: 'addisai',
    cloud: true,
    available: () => Boolean(apiKey),
    async generate({ system, messages, signal }) {
      const res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/api/v1/chat_generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
        signal,
        body: JSON.stringify({
          messages: [{ role: 'system', content: system }, ...messages]
        })
      });
      if (!res.ok) {
        let detail = '';
        try { detail = (await res.text()).slice(0, 200); } catch (e) { /* ignore */ }
        throw new ProviderError(`addisai http ${res.status}${detail ? `: ${detail}` : ''}`, { status: res.status });
      }
      const data = await res.json();
      const text = data?.response_text;
      if (!text || typeof text !== 'string') {
        throw new ProviderError(`addisai: no response_text in reply, keys were: ${Object.keys(data || {}).join(', ')}`);
      }
      if (data.finish_reason && data.finish_reason !== 'stop') {
        console.warn(`addisai: finished with reason "${data.finish_reason}" (modelVersion: ${data.modelVersion || 'unknown'})`);
      }
      return { text: text.trim() };
    }
  };
}