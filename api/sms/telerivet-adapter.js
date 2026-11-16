const API_BASE_URL = 'https://api.telerivet.com/v1';

export class TelerivetSmsError extends Error {
  constructor(message, { code = 'telerivet_error', retryable = false, status } = {}) {
    super(message);
    this.name = 'TelerivetSmsError';
    this.code = code;
    this.retryable = retryable;
    if (status !== undefined) this.status = status;
  }
}

export function createTelerivetSmsAdapter({
  apiKey,
  projectId,
  routeId = '',
  fetchImpl = fetch,
  timeoutMs = 7000
}) {
  return {
    name: 'telerivet',
    async send({ to, text }) {
      if (!apiKey) throw new TelerivetSmsError('TELERIVET_API_KEY is not set.', { code: 'configuration_error' });
      if (!projectId) throw new TelerivetSmsError('TELERIVET_PROJECT_ID is not set.', { code: 'configuration_error' });
      if (typeof to !== 'string' || !to.trim()) throw new TelerivetSmsError('A destination phone number is required.', { code: 'invalid_destination' });
      if (typeof text !== 'string' || !text.trim()) throw new TelerivetSmsError('SMS text is required.', { code: 'invalid_text' });

      const headers = {
        authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
        'content-type': 'application/json',
        accept: 'application/json'
      };
      const body = { to_number: to, content: text };
      if (routeId) body.route_id = routeId;

      let response;
      try {
        response = await fetchImpl(`${API_BASE_URL}/projects/${encodeURIComponent(projectId)}/messages/send`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs)
        });
      } catch (error) {
        throw new TelerivetSmsError('Telerivet SMS request failed before a response was received.', {
          code: error && error.name === 'TimeoutError' ? 'provider_timeout' : 'provider_network_error',
          retryable: true
        });
      }

      if (!response.ok) {
        const retryable = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500;
        throw new TelerivetSmsError(`Telerivet SMS API returned HTTP ${response.status}.`, {
          code: 'provider_http_error',
          retryable,
          status: response.status
        });
      }

      let result;
      try { result = await response.json(); }
      catch {
        throw new TelerivetSmsError('Telerivet SMS API returned invalid JSON.', {
          code: 'invalid_provider_response',
          retryable: true
        });
      }
      if (result && result.error) {
        const code = typeof result.error.code === 'string' ? result.error.code : 'unknown';
        throw new TelerivetSmsError(`Telerivet SMS API rejected the request (${code}).`, {
          code: 'provider_rejected',
          retryable: false
        });
      }
      return result;
    }
  };
}
