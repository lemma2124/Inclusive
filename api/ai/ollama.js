import { createOpenAICompatible } from './groq.js';

// Ollama exposes an OpenAI-compatible API locally. Keep this provider separate
// from cloud providers so local requests do not receive cloud-only redaction.
export function createOllama({
  baseUrl = 'http://127.0.0.1:11434/v1',
  model = 'aya-expanse:8b',
  fetchImpl = fetch
} = {}) {
  const endpoint = baseUrl.replace(/\/+$/, '');
  const hostname = new URL(endpoint).hostname.toLowerCase();
  const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname.endsWith('.localhost');
  return createOpenAICompatible({
    name: 'ollama',
    baseUrl: endpoint,
    apiKey: '',
    model,
    cloud: !isLoopback,
    requiresApiKey: false,
    fetchImpl
  });
}
