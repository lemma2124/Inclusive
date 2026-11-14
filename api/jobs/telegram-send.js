// Sends a Telegram message directly from the main server process (separate
// from telegram/bot.js's own long-polling loop), so job alerts work even if
// the bot process is not running. Same token, read from the same .env.
export function createTelegramSender(token, fetchImpl = fetch) {
  return {
    async send(chatId, text) {
      if (!token) return false;
      try {
        const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text })
        });
        return res.ok;
      } catch (e) {
        return false;
      }
    }
  };
}