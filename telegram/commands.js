import { parseChannelLanguage } from '../api/sms/language.js';

const COMMANDS = new Set([
  '/start', '/help', '/learn', '/jobs', '/support', '/human', '/language', '/lang',
  '/end', '/unsubscribe', '/accommodation', '/cancel', '/en', '/am', '/om', '/ti', '/text', '/voice'
]);

export function parseTelegramInput(value) {
  const text = String(value || '').trim();
  if (!text) return { text: '', command: '', argument: '', language: null };
  const [rawCommand, ...args] = text.split(/\s+/);
  const command = rawCommand.startsWith('/') ? rawCommand.toLowerCase().replace(/@[^@]+$/, '') : '';
  const argument = command ? args.join(' ').trim() : '';
  const commandLanguage = command === '/language' || command === '/lang'
    ? parseChannelLanguage(argument) || (['en', 'am', 'om', 'ti'].includes(argument.toLowerCase()) ? argument.toLowerCase() : null)
    : null;
  const language = commandLanguage || (command && /^\/(en|am|om|ti)$/.test(command) ? command.slice(1) : parseChannelLanguage(command ? argument : text));
  return {
    text,
    command,
    argument,
    language,
    knownCommand: !command || COMMANDS.has(command)
  };
}

export function applyTelegramLanguage(session, parsed) {
  if (!parsed.language) return null;
  session.lang = parsed.language;
  session.languageExplicit = true;
  return session.lang;
}
