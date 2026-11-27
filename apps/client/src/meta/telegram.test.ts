import { describe, expect, it } from 'vitest';
import { launchedInTelegram, telegramLang, type TgWebApp } from './telegram';

describe('Telegram Mini App (11.3)', () => {
  it('распознаёт запуск внутри Telegram по параметрам адреса', () => {
    expect(
      launchedInTelegram({ hash: '#tgWebAppData=query_id%3DAA&tgWebAppVersion=8.0', search: '' }),
    ).toBe(true);
    expect(launchedInTelegram({ hash: '', search: '?tgWebAppData=x' })).toBe(true);
    expect(launchedInTelegram({ hash: '#top', search: '?q=low' })).toBe(false);
  });

  it('язык из Telegram', () => {
    const app = (code?: string) =>
      ({ initDataUnsafe: { user: { language_code: code } } }) as TgWebApp;
    expect(telegramLang(app('ru'))).toBe('ru');
    expect(telegramLang(app('uk'))).toBe('ru');
    expect(telegramLang(app('de'))).toBe('en');
    expect(telegramLang(app())).toBeNull();
    expect(telegramLang(undefined)).toBeNull();
  });
});
