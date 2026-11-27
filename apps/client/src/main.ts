import { initPhysics } from '@sr/physics';
import { BRAND, detectLang, getLang, setLang, t, type Lang } from '@sr/shared';
import { getQuality } from './render/quality';
import { App } from './app';
import { initTelegram, telegramLang } from './meta/telegram';
import { initSettingsSync, pullSettings } from './meta/settings-sync';

async function boot() {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem('sr:lang');
  } catch {
    /* без хранилища — по языку браузера */
  }
  const lang: Lang = saved === 'ru' || saved === 'en' ? saved : detectLang(navigator.language);
  setLang(lang);
  document.documentElement.lang = lang;
  document.title = BRAND.title;
  const root = document.getElementById('app')!;
  const loading = document.createElement('div');
  loading.className = 'loading';
  loading.textContent = t('loading');
  root.appendChild(loading);
  const quality = getQuality();
  // Физика (WASM) качается в фоне: меню не ждёт её (PLAN_V2 7.0.5)
  const rapier = initPhysics();
  const params = new URLSearchParams(location.search);

  if (params.has('blind')) {
    const [R, { BlindTest }] = await Promise.all([rapier, import('./ui/blind-test')]);
    loading.remove();
    new BlindTest(R, root, quality).start();
    return;
  }
  // Внутри Telegram Mini App: SDK, вход по initData, язык Telegram (если не выбран свой)
  const tgApp = await initTelegram(root);
  const tgLang = telegramLang(tgApp);
  if (!saved && tgLang) {
    setLang(tgLang);
    document.documentElement.lang = tgLang;
  }
  // Настройки из профиля (язык, стример, плейлисты) — до первого экрана
  initSettingsSync();
  await pullSettings();
  document.documentElement.lang = getLang();
  loading.remove();
  const app = new App(rapier, root, quality);
  app.onOnline = async () => {
    const { startOnline } = await import('./net/online');
    startOnline(app);
  };
  (window as unknown as { __app: App }).__app = app;
  if (params.has('room')) app.onOnline();
  else app.menu();
}

void boot();
