/**
 * Telegram Mini App (PLAN_V3 11.3). Официальный скрипт telegram-web-app.js грузится
 * только когда игра открыта внутри Telegram (Telegram передаёт tgWebAppData в адресе) —
 * обычный сайт лишних запросов не делает.
 */
import { detectLang, type Lang } from '@sr/shared';
import { account } from './account';
import { loginTelegramWebApp } from './api';

export interface TgWebApp {
  initData: string;
  initDataUnsafe?: { user?: { language_code?: string } };
  version?: string;
  ready(): void;
  expand(): void;
  disableVerticalSwipes?(): void;
  setHeaderColor?(c: string): void;
  setBackgroundColor?(c: string): void;
  BackButton?: { show(): void; hide(): void; onClick(f: () => void): void };
  contentSafeAreaInset?: { top: number; bottom: number; left: number; right: number };
  safeAreaInset?: { top: number; bottom: number; left: number; right: number };
  onEvent?(e: string, f: () => void): void;
  openInvoice?: (url: string, cb?: (status: string) => void) => void;
  openTelegramLink?: (url: string) => void;
}

/** Игра открыта внутри Telegram: параметры запуска в hash или в query. */
export function launchedInTelegram(loc: { hash: string; search: string } = location): boolean {
  return /tgWebAppData=/.test(loc.hash) || /tgWebAppData=/.test(loc.search);
}

export const tg = (): TgWebApp | undefined =>
  (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;

/** Подключить официальный скрипт Telegram; не загрузился за 4 с — играем как на сайте. */
function loadSdk(): Promise<TgWebApp | undefined> {
  if (tg()) return Promise.resolve(tg());
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://telegram.org/js/telegram-web-app.js';
    const timer = setTimeout(() => resolve(undefined), 4000);
    s.onload = () => {
      clearTimeout(timer);
      resolve(tg());
    };
    s.onerror = () => {
      clearTimeout(timer);
      resolve(undefined);
    };
    document.head.appendChild(s);
  });
}

/** Язык из Telegram (если игрок не выбирал сам). */
export function telegramLang(app: TgWebApp | undefined): Lang | null {
  const code = app?.initDataUnsafe?.user?.language_code;
  return code ? detectLang(code) : null;
}

/** Отступы безопасной зоны Telegram → CSS-переменные --safe-top/--safe-bottom. */
function applyInsets(app: TgWebApp): void {
  const top = (app.safeAreaInset?.top ?? 0) + (app.contentSafeAreaInset?.top ?? 0);
  const bottom = (app.safeAreaInset?.bottom ?? 0) + (app.contentSafeAreaInset?.bottom ?? 0);
  document.documentElement.style.setProperty('--safe-top', `${top}px`);
  document.documentElement.style.setProperty('--safe-bottom', `${bottom}px`);
}

/**
 * Кнопка «Назад» Telegram: видна, когда открыт экран поверх меню или идёт заезд;
 * нажатие — как «Назад» на экране, в заезде — пауза (Esc).
 */
function wireBackButton(app: TgWebApp, root: HTMLElement): void {
  const bb = app.BackButton;
  if (!bb) return;
  const topScreen = () => {
    const list = root.querySelectorAll<HTMLElement>('.screen');
    return list[list.length - 1] ?? null;
  };
  const isMainMenu = (s: HTMLElement | null) => !!s?.querySelector('[data-k="go"]');
  const sync = () => {
    const s = topScreen();
    if (s && isMainMenu(s)) bb.hide();
    else bb.show();
  };
  bb.onClick(() => {
    const s = topScreen();
    const back = s?.querySelector<HTMLElement>(
      '[data-k="back"], [data-k="resume"], [data-k="menu"], [data-k="exit"]',
    );
    if (back) back.click();
    else window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
  });
  new MutationObserver(sync).observe(root, { childList: true, subtree: false });
  sync();
}

/**
 * Запуск внутри Telegram: ready/expand, тёмная шапка, отступы, «Назад»,
 * автоматический вход по initData. Вне Telegram ничего не делает.
 */
export async function initTelegram(root: HTMLElement): Promise<TgWebApp | undefined> {
  if (!launchedInTelegram()) return undefined;
  const app = await loadSdk();
  if (!app) return undefined;
  document.body.classList.add('tg-app');
  app.ready();
  app.expand();
  app.disableVerticalSwipes?.();
  app.setHeaderColor?.('#07070d');
  app.setBackgroundColor?.('#07070d');
  applyInsets(app);
  app.onEvent?.('safeAreaChanged', () => applyInsets(app));
  app.onEvent?.('contentSafeAreaChanged', () => applyInsets(app));
  wireBackButton(app, root);
  if (!account.token && app.initData) {
    try {
      await loginTelegramWebApp(app.initData);
    } catch {
      /* API недоступен или подпись не прошла — играем гостем */
    }
  }
  return app;
}
