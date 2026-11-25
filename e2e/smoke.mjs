// Дымовые тесты клиента: меню → гонка, слепой тест, онлайн с ботами.
// Запуск: pnpm e2e   (поднимает dev-сервер клиента и сервер гонок на свободных портах)
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const CLIENT_PORT = 5199;
const SERVER_PORT = 2599;
const base = `http://localhost:${CLIENT_PORT}/?q=low&server=ws://localhost:${SERVER_PORT}`;

function start(cmd, args, env = {}) {
  const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
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
  start('pnpm', ['--filter', 'client', 'exec', 'vite', '--port', String(CLIENT_PORT), '--strictPort']),
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
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
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
    return { phase: r.tracker.phase, cars: r.session.cars.length, speed: r.player.vehicle.telemetry().speedKmh };
  });
  await page.keyboard.up('KeyW');
  check('гонка стартует, машина едет', race.phase === 'racing' && race.speed > 10, JSON.stringify(race));
  check('боты на трассе', race.cars > 1);

  // 3. Пауза и выход в меню
  await page.keyboard.press('Escape');
  await page.click('[data-k="menu"]');
  await page.waitForSelector('[data-k="go"]');
  check('пауза → меню', true);

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
