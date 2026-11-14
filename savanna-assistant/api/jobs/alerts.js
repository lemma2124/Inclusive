// Fans one alert out to every subscriber over their chosen channel.
// Each subscriber is tried independently, so one failure never blocks others.
export function createAlertService({ jobStore, telegramSender, smsAdapter }) {
  return {
    async broadcast(text) {
      const subs = jobStore.list();
      let sent = 0;
      let failed = 0;
      for (const sub of subs) {
        try {
          if (sub.channel === 'telegram') {
            const ok = await telegramSender.send(sub.contact, text);
            ok ? sent++ : failed++;
          } else if (sub.channel === 'sms') {
            await smsAdapter.send({ to: sub.contact, text });
            sent++;
          } else {
            failed++;
          }
        } catch (e) {
          failed++;
        }
      }
      return { sent, failed, total: subs.length };
    }
  };
}