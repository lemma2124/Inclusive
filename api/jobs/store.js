// In-memory job-alert subscriptions. No personal data beyond a contact
// address the learner already gave us by messaging that channel.
export function createJobStore() {
  const subs = new Map(); // key: `${channel}:${contact}`

  return {
    subscribe({ channel, contact, lang }) {
      subs.set(`${channel}:${contact}`, { channel, contact, lang: lang === 'am' ? 'am' : 'en', at: Date.now() });
      return { subscribed: true };
    },
    unsubscribe({ channel, contact }) {
      return { removed: subs.delete(`${channel}:${contact}`) };
    },
    list() { return [...subs.values()]; }
  };
}