// Free cloud AI tiers may train on inputs. Strip obvious personal data
// before anything leaves our server. Course content is never redacted.
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// 7+ digits, allowing spaces, dashes, dots and a leading +
const PHONE = /\+?\d[\d\s().-]{5,}\d/g;

export function redact(text) {
  return String(text).replace(EMAIL, '[email]').replace(PHONE, '[number]');
}

export function redactMessages(messages) {
  return messages.map((m) => ({ ...m, content: redact(m.content) }));
}