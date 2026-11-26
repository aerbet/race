import { initPhysics } from '@sr/physics';
import { BRAND } from '@sr/shared';
import { getQuality } from './render/quality';
import { App } from './app';

async function boot() {
  document.title = BRAND.title;
  const root = document.getElementById('app')!;
  const loading = document.createElement('div');
  loading.className = 'loading';
  loading.textContent = 'ЗАГРУЗКА…';
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
