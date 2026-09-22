import english from './locales/en.json' with { type: 'json' };

export const languages = ['ko', 'en'];
export const dateLocale = language => language === 'en' ? 'en-US' : 'ko-KR';
export function translate(key, language = 'ko', values = []) {
  if (typeof key !== 'string') return key;
  const text = language === 'en' && Object.hasOwn(english, key) ? english[key] : key;
  return text.replace(/\{(\d+)\}/g, (match, index) => index < values.length ? String(values[index]) : match);
}

// Translate only recognized local diagnostics; keep server and provider text intact.
export function translateError(message, language) {
  if (typeof message !== 'string' || language !== 'en') return message;
  if (Object.hasOwn(english, message)) return english[message];
  const prefix = message.match(/^(?:Error invoking remote method '[^']+': Error: )?(?:HTTP \d+: )?/)[0];
  const detail = message.slice(prefix.length);
  return Object.hasOwn(english, detail) ? prefix + english[detail] : message;
}
