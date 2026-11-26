// Дымовые тесты клиента: меню → гонка, слепой тест, онлайн с ботами.
// Запуск: pnpm e2e   (поднимает dev-сервер клиента и сервер гонок на свободных портах)
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const CLIENT_PORT = 5199;
const SERVER_PORT = 2599;
const base = `http://localhost:${CLIENT_PORT}/?q=low&server=ws://localhost:${SERVER_PORT}`;

function start(cmd, args, env = {}) {
  const p = spawn(cmd, args, {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  p.stdout.on('data', () => {});
  p.stderr.on('data', () => {});
  return p;
}

async function waitFor(url, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url);
      if (r.ok || r.status === 404) return;
    } catch {
      /* ещё не поднялся */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`не дождались ${url}`);
}

const procs = [
  start('pnpm', [
    '--filter',
    'client',
    'exec',
    'vite',
    '--port',
    String(CLIENT_PORT),
    '--strictPort',
  ]),
  start('pnpm', ['--filter', 'race-server', 'start'], { PORT: String(SERVER_PORT), BOT_FILL: '3' }),
];
const failures = [];
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures.push(name);
};

try {
  await waitFor(`http://localhost:${CLIENT_PORT}/`);
  await waitFor(`http://localhost:${SERVER_PORT}/health`);
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
  // Диалог «Диспетчера» при первом запуске проверяется отдельно — здесь сразу меню
  await page.addInitScript(() => localStorage.setItem('sr:dispatcher-seen', '1'));
  page.on('pageerror', (e) => errors.push(e.message));

  // 1. Меню
  await page.goto(base);
  await page.waitForSelector('[data-k="go"]', { timeout: 30000 });
  check('меню открывается', true);

  // 2. Гонка с ботами
  await page.click('[data-k="go"]');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(7000);
  const race = await page.evaluate(() => {
    const r = window.__app.current;
    return {
      phase: r.tracker.phase,
      cars: r.session.cars.length,
      speed: r.player.vehicle.telemetry().speedKmh,
    };
  });
  await page.keyboard.up('KeyW');
  check(
    'гонка стартует, машина едет',
    race.phase === 'racing' && race.speed > 10,
    JSON.stringify(race),
  );
  check('боты на трассе', race.cars > 1);

  // 2б. Город: стриминг блоков и трасса по улицам
  await page.evaluate(() =>
    window.__app.start({
      mode: 'sprint',
      trackId: 'msk_sprint',
      cityId: 'moscow_synth',
      weather: 'wet',
      carId: 'era2026_hatch',
      bots: 3,
      botLevel: 'medium',
      laps: 1,
      manual: false,
      playerName: 'T',
    }),
  );
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(7000);
  const city = await page.evaluate(() => {
    const r = window.__app.current;
    return {
      tiles: r.session.cityView?.loadedCount ?? 0,
      phys: r.session.sim.tileKeys.length,
      speed: r.player.vehicle.telemetry().speedKmh,
    };
  });
  await page.keyboard.up('KeyW');
  check(
    'город: блоки грузятся, коллайдеры рядом, машина едет',
    city.tiles > 4 && city.phys > 0 && city.speed > 10,
    JSON.stringify(city),
  );

  // 3. Пауза и выход в меню
  await page.keyboard.press('Escape');
  await page.click('[data-k="menu"]');
  await page.waitForSelector('[data-k="go"]');
  check('пауза → меню', true);

  // 3б. Музыка: YouTube недоступен → сообщение и радио игры (PLAN_V2 8.5)
  await page.route(/youtube\.com|googleapis/, (r) => r.abort());
  await page.click('[data-meta="music"]');
  await page.click('[data-tab="youtube"]');
  await page.click('[data-play]');
  const fallback = await page
    .waitForFunction(
      () =>
        globalThis.document.querySelector('.music')?.classList.contains('on') &&
        !!globalThis.document.querySelector('[data-k="msg"]')?.textContent,
      null,
      { timeout: 8000 },
    )
    .then(
      () => true,
      () => false,
    );
  check('музыка: без YouTube включается радио', fallback);
  await page.click('[data-k="back"]');
  await page.unroute(/youtube\.com|googleapis/);

  // 4. Слепой тест
  await page.goto(base + '&blind');
  await page.waitForSelector('[data-k="name"]');
  check('слепой тест открывается', true);

  // 5. Онлайн: приватная комната, старт хостом → боты
  await page.goto(base);
  await page.waitForSelector('[data-k="online"]');
  await page.click('[data-k="online"]');
  await page.click('[data-k="create"]');
  await page.waitForSelector('[data-k="start"]', { timeout: 10000 });
  await page.click('[data-k="start"]');
  await page.waitForTimeout(5000);
  const online = await page.evaluate(() => {
    const r = window.__app.current;
    return r ? { remotes: r.remotes?.size ?? 0, phase: r.tracker.phase } : null;
  });
  check('онлайн: гонка с ботами сервера', !!online && online.remotes >= 3, JSON.stringify(online));

  // 6. Свободная езда по городу (онлайн)
  await page.goto(base);
  await page.waitForSelector('[data-k="online"]');
  await page.click('[data-k="online"]');
  await page.click('[data-k="freeroam"]');
  await page.waitForTimeout(5000);
  const fr = await page.evaluate(() => {
    const r = window.__app.current;
    return r
      ? { mode: r.setup.mode, city: r.setup.cityId, tiles: r.session.cityView?.loadedCount ?? 0 }
      : null;
  });
  check(
    'онлайн: свободная езда по городу',
    !!fr && fr.mode === 'free' && fr.city === 'moscow_synth' && fr.tiles > 0,
    JSON.stringify(fr),
  );

  check('нет ошибок на странице', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
} catch (e) {
  check('исключение', false, String(e));
} finally {
  for (const p of procs) {
    try {
      process.kill(-p.pid);
    } catch {
      /* уже завершён */
    }
  }
}
if (failures.length) {
  console.log(`\nПровалено: ${failures.length}`);
  process.exit(1);
}
console.log('\nВсе дымовые тесты прошли');
