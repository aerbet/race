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
  const R = await initPhysics();
  const params = new URLSearchParams(location.search);
  loading.remove();

  if (params.has('blind')) {
    const { BlindTest } = await import('./ui/blind-test');
    new BlindTest(R, root, quality).start();
    return;
  }
  const app = new App(R, root, quality);
  app.onOnline = async () => {
    const { startOnline } = await import('./net/online');
    startOnline(app);
  };
  (window as unknown as { __app: App }).__app = app;
  if (params.has('room')) app.onOnline();
  else app.menu();
}

void boot();
