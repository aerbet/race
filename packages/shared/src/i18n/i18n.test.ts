import { afterEach, describe, expect, it } from 'vitest';
import { DICTS, detectLang, setLang, t, tn } from './index';

afterEach(() => setLang('ru'));

describe('i18n (7.3)', () => {
  it('ru и en содержат одни и те же ключи', () => {
    const ru = Object.keys(DICTS.ru).sort();
    const en = Object.keys(DICTS.en).sort();
    expect(ru.filter((k) => !(k in DICTS.en))).toEqual([]);
    expect(en.filter((k) => !(k in DICTS.ru))).toEqual([]);
  });

  it('подстановки {var} совпадают в обоих языках', () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(DICTS.ru))
      expect(vars(DICTS.en[k] ?? ''), k).toEqual(vars(DICTS.ru[k]!));
  });

  it('в текстах нет запрещённых слов', () => {
    const all = JSON.stringify(DICTS).toLowerCase();
    for (const w of ['need for speed', 'nfs', 'underground']) expect(all).not.toContain(w);
  });

  it('t подставляет переменные и падает на ключ', () => {
    expect(t('hud.lap', { n: 2, of: 3 })).toBe('КРУГ 2/3');
    setLang('en');
    expect(t('hud.lap', { n: 2, of: 3 })).toBe('LAP 2/3');
    expect(t('no.such.key')).toBe('no.such.key');
  });

  it('tn выбирает форму множественного числа', () => {
    expect(tn('res.points', 1)).toBe('1 очко');
    expect(tn('res.points', 3)).toBe('3 очка');
    expect(tn('res.points', 25)).toBe('25 очков');
    setLang('en');
    expect(tn('music.tracks', 1)).toBe('1 track');
    expect(tn('music.tracks', 5)).toBe('5 tracks');
  });

  it('detectLang', () => {
    expect(detectLang('ru-RU')).toBe('ru');
    expect(detectLang('uk')).toBe('ru');
    expect(detectLang('en-US')).toBe('en');
    expect(detectLang(undefined)).toBe('en');
  });
});
