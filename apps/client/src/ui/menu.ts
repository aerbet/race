import { BRAND, CARS, formatTime } from '@sr/shared';
import type { BotLevel } from '@sr/physics';
import { MODES, type ModeId, type RaceResults, type RaceSetup } from '../game/race';
import { loadGhost } from '../game/ghost';

const SETTINGS_KEY = 'sr:settings';

export interface MenuSettings {
  mode: ModeId;
  carId: string;
  bots: number;
  botLevel: BotLevel;
  manual: boolean;
  playerName: string;
}

const DEFAULTS: MenuSettings = {
  mode: 'circuit',
  carId: 'era2000_coupe',
  bots: 5,
  botLevel: 'medium',
  manual: false,
  playerName: 'Игрок',
};

export function loadSettings(): MenuSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<MenuSettings>) };
  } catch {
    /* нет хранилища */
  }
  return { ...DEFAULTS };
}

export function saveSettings(s: MenuSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* нет хранилища */
  }
}

export function setupFromSettings(s: MenuSettings): RaceSetup {
  const m = MODES[s.mode];
  return {
    mode: s.mode,
    trackId: m.track,
    carId: s.carId,
    bots: m.bots ? s.bots : 0,
    botLevel: s.botLevel,
    laps: m.laps,
    manual: s.manual,
    playerName: s.playerName || 'Игрок',
  };
}

const LEVELS: { id: BotLevel; title: string }[] = [
  { id: 'easy', title: 'Лёгкие' },
  { id: 'medium', title: 'Средние' },
  { id: 'hard', title: 'Сложные' },
];

function h(html: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

export interface MenuActions {
  start: (setup: RaceSetup) => void;
  online: () => void;
}

/** Главное меню: режим, машина, соперники. */
export function showMenu(root: HTMLElement, actions: MenuActions): () => void {
  const s = loadSettings();
  const el = h(`<div class="screen"><div class="menu">
    <h1>${BRAND.title}</h1>
    <p class="tagline">${BRAND.tagline}</p>
    <h2>Режим</h2><div class="grid2" data-k="mode"></div>
    <h2>Машина</h2><div class="grid2" data-k="car"></div>
    <div data-k="botsBlock"><h2>Соперники</h2>
      <div class="row" data-k="bots"></div>
      <div class="row" data-k="level" style="margin-top:8px"></div>
    </div>
    <h2>Коробка</h2><div class="row" data-k="gear"></div>
    <h2>Имя</h2><input type="text" maxlength="16" data-k="name" />
    <button class="btn primary" data-k="go">Поехали</button>
    <button class="btn" data-k="online" style="width:100%;margin-top:8px;text-align:center">Онлайн-гонка</button>
    <p class="hint">
      <span class="kbd">W/↑</span> газ · <span class="kbd">S/↓</span> тормоз/задний · <span class="kbd">A D</span> руль ·
      <span class="kbd">Пробел</span> ручник · <span class="kbd">Shift</span> нитро · <span class="kbd">C</span> камера ·
      <span class="kbd">R</span> сброс · <span class="kbd">Esc</span> пауза · <span class="kbd">Q/E</span> передачи (ручная)<br/>
      Геймпад: стик — руль, R2/L2 — газ/тормоз, A — ручник, B — нитро. На телефоне — экранные кнопки, газ автоматический.<br/>
      <a href="?blind" style="color:var(--accent)">Слепой тест управления</a> · <a href="?q=low" style="color:var(--muted)">низкое качество</a> · <a href="?q=high" style="color:var(--muted)">высокое</a>
    </p>
  </div></div>`);
  root.appendChild(el);
  const q = (k: string) => el.querySelector(`[data-k="${k}"]`) as HTMLElement;

  const render = () => {
    const modeBox = q('mode');
    modeBox.innerHTML = '';
    for (const [id, m] of Object.entries(MODES) as [ModeId, (typeof MODES)[ModeId]][]) {
      const b = h(
        `<button class="btn ${s.mode === id ? 'sel' : ''}">${m.title}<small>${m.desc}</small></button>`,
      );
      b.onclick = () => {
        s.mode = id;
        render();
      };
      modeBox.appendChild(b);
    }
    const carBox = q('car');
    carBox.innerHTML = '';
    for (const c of Object.values(CARS)) {
      const ghost = loadGhost(MODES[s.mode].track, c.id);
      const drive = { rwd: 'задний', fwd: 'передний', awd: 'полный' }[c.drive];
      const b = h(`<button class="btn ${s.carId === c.id ? 'sel' : ''}">${c.name}
        <small>эпоха ${c.era} · ${drive} привод · 0–100 за ${c.specs.zeroTo100} с · ${c.specs.topSpeedKmh} км/ч${
          ghost ? `<br/>лучший круг: ${formatTime(ghost.lapSteps / 60)}` : ''
        }</small></button>`);
      b.onclick = () => {
        s.carId = c.id;
        render();
      };
      carBox.appendChild(b);
    }
    q('botsBlock').style.display = MODES[s.mode].bots ? '' : 'none';
    const bots = q('bots');
    bots.innerHTML = '';
    for (const n of [0, 1, 3, 5, 7]) {
      const b = h(
        `<button class="btn ${s.bots === n ? 'sel' : ''}">${n === 0 ? 'Один' : n}</button>`,
      );
      b.onclick = () => {
        s.bots = n;
        render();
      };
      bots.appendChild(b);
    }
    const lv = q('level');
    lv.innerHTML = '';
    for (const l of LEVELS) {
      const b = h(`<button class="btn ${s.botLevel === l.id ? 'sel' : ''}">${l.title}</button>`);
      b.onclick = () => {
        s.botLevel = l.id;
        render();
      };
      lv.appendChild(b);
    }
    const gear = q('gear');
    gear.innerHTML = '';
    for (const [m, t] of [
      [false, 'Автомат'],
      [true, 'Ручная (Q/E)'],
    ] as const) {
      const b = h(`<button class="btn ${s.manual === m ? 'sel' : ''}">${t}</button>`);
      b.onclick = () => {
        s.manual = m;
        render();
      };
      gear.appendChild(b);
    }
  };
  render();
  const name = q('name') as HTMLInputElement;
  name.value = s.playerName;
  name.oninput = () => (s.playerName = name.value);
  name.addEventListener('keydown', (e) => e.stopPropagation());
  q('go').onclick = () => {
    saveSettings(s);
    actions.start(setupFromSettings(s));
  };
  q('online').onclick = () => {
    saveSettings(s);
    actions.online();
  };
  return () => el.remove();
}

export interface ResultActions {
  restart: () => void;
  menu: () => void;
}

export function showResults(root: HTMLElement, r: RaceResults, actions: ResultActions): () => void {
  const me = r.rows.find((x) => x.isPlayer);
  let headline = '';
  let sub = '';
  if (r.setup.mode === 'drift') {
    headline = `${(r.driftScore ?? 0).toLocaleString('ru-RU')} очков`;
    sub = `Лучшая цепочка: ${(r.bestDriftChain ?? 0).toLocaleString('ru-RU')}`;
  } else if (r.setup.mode === 'timeattack') {
    headline = formatTime(me?.time ?? 0);
    sub = `Лучший круг: ${formatTime(r.bestLap ?? 0)}${r.newBestLap ? ' — новый рекорд, призрак сохранён' : ''}`;
  } else {
    headline = me?.finished ? `${me.position} место` : 'Не финишировал';
    sub = `Время: ${formatTime(me?.time ?? 0)} · лучший круг: ${formatTime(r.bestLap ?? 0)}`;
  }
  const rows = r.rows
    .map(
      (x) =>
        `<tr class="${x.isPlayer ? 'me' : ''}"><td>${x.position}</td><td>${escapeHtml(x.name)}</td><td>${
          x.finished ? formatTime(x.time) : '—'
        }</td><td>${formatTime(x.bestLap)}</td></tr>`,
    )
    .join('');
  const el = h(`<div class="screen"><div class="menu results panel">
    <p class="big">${headline}</p>
    <p class="sub">${sub}</p>
    ${r.rows.length > 1 ? `<table><tr><th>#</th><th>Гонщик</th><th>Время</th><th>Лучший круг</th></tr>${rows}</table>` : ''}
    <div class="btnrow"><button class="btn" data-k="again">Ещё раз</button><button class="btn" data-k="menu">В меню</button></div>
  </div></div>`);
  root.appendChild(el);
  (el.querySelector('[data-k="again"]') as HTMLElement).onclick = actions.restart;
  (el.querySelector('[data-k="menu"]') as HTMLElement).onclick = actions.menu;
  return () => el.remove();
}

export interface PauseActions {
  resume: () => void;
  restart: () => void;
  menu: () => void;
  camera: () => void;
  debug: () => void;
}

export function showPause(root: HTMLElement, a: PauseActions): () => void {
  const el = h(`<div class="screen"><div class="menu panel">
    <p class="big" style="font:900 italic 40px var(--font);margin:0 0 12px">Пауза</p>
    <div class="btnrow" style="flex-direction:column">
      <button class="btn" data-k="resume">Продолжить</button>
      <button class="btn" data-k="restart">Заново</button>
      <button class="btn" data-k="camera">Сменить камеру (C)</button>
      <button class="btn" data-k="debug">Панель настройки машины (F2)</button>
      <button class="btn" data-k="menu">В меню</button>
    </div></div></div>`);
  root.appendChild(el);
  for (const k of ['resume', 'restart', 'menu', 'camera', 'debug'] as const) {
    (el.querySelector(`[data-k="${k}"]`) as HTMLElement).onclick = a[k];
  }
  return () => el.remove();
}

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
