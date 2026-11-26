import ru from './ru.json';
import en from './en.json';

/**
 * Тексты игры (PLAN_V2 7.3): все строки — в ru.json / en.json, в коде только ключи.
 * Подстановка: t('shop.lack', { n: 120 }) → «Не хватает 120 ⛁».
 * Множественное число: ключи `<ключ>.one|few|many|other` и tn('ключ', n).
 */
export type Lang = 'ru' | 'en';
type Dict = Record<string, string>;

export const DICTS: Record<Lang, Dict> = { ru: ru as Dict, en: en as Dict };
let lang: Lang = 'ru';

export function setLang(l: Lang): void {
  lang = l;
}

export function getLang(): Lang {
  return lang;
}

/** Язык по умолчанию: русский для ru/uk/be/kk/ky, иначе английский. */
export function detectLang(navLang: string | undefined): Lang {
  return /^(ru|uk|be|kk|ky)\b/i.test(navLang ?? '') ? 'ru' : 'en';
}

function fill(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_m, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}

/** Строка по ключу; нет в текущем языке → русская; нет нигде → сам ключ (видно в тестах). */
export function t(key: string, vars?: Record<string, string | number>): string {
  const s = DICTS[lang][key] ?? DICTS.ru[key];
  return fill(s ?? key, vars);
}

/** Есть ли ключ (для необязательных переводов данных: трасс, предметов). */
export function has(key: string): boolean {
  return key in DICTS[lang] || key in DICTS.ru;
}

/** Множественное число по правилам языка: tn('unit.tokens', 5) → «5 жетонов». */
export function tn(key: string, n: number, vars?: Record<string, string | number>): string {
  const form = new Intl.PluralRules(lang === 'ru' ? 'ru-RU' : 'en-US').select(n);
  const k = has(`${key}.${form}`) ? `${key}.${form}` : `${key}.other`;
  return t(k, { n, ...vars });
}
