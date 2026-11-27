import {
  BRAND,
  CARS,
  formatTime,
  getLang,
  setLang,
  t,
  tn,
  type Lang,
  type Weather,
} from '@sr/shared';
import { CITIES } from '../city/city-view';
import { loadQualitySetting, saveQualitySetting } from '../render/quality';
import { account } from '../meta/account';
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
  /** 'polygon' или id города. */
  location: string;
  weather: Weather;
}

/** Трассы городов по режимам (id трасс из city.json). */
const CITY_TRACKS: Record<string, Record<ModeId, string>> = {
  moscow_center: {
    circuit: 'mskc_ring',
    sprint: 'mskc_sprint',
    drift: 'mskc_drift',
    timeattack: 'mskc_ring',
    free: 'mskc_ring',
  },
  tokyo_shinjuku: {
    circuit: 'tyos_ring',
    sprint: 'tyos_sprint',
    drift: 'tyos_drift',
    timeattack: 'tyos_ring',
    free: 'tyos_ring',
  },
  moscow_synth: {
    circuit: 'msk_ring',
    sprint: 'msk_sprint',
    drift: 'msk_drift',
    timeattack: 'msk_ring',
    free: 'msk_ring',
  },
  tokyo_synth: {
    circuit: 'tyo_ring',
    sprint: 'tyo_sprint',
    drift: 'tyo_drift',
    timeattack: 'tyo_ring',
    free: 'tyo_ring',
  },
};

/** Локации без города (горные трассы): все режимы на одной трассе. */
const TRACK_LOCATIONS: Record<string, string> = { jp_touge: 'jp_touge' };

const LOCATIONS = [
  { id: 'polygon', title: () => t('loc.polygon'), desc: () => t('loc.polygon.desc') },
  ...CITIES.map((c) => ({
    id: c.id,
    title: () => t(`city.${c.id}`),
    desc: () =>
      t(c.id.endsWith('_synth') ? 'loc.synth.desc' : 'loc.real.desc', {
        country: t(`country.${c.country}`),
      }),
  })),
  { id: 'jp_touge', title: () => t('loc.jp_touge'), desc: () => t('loc.jp_touge.desc') },
];

/** Подсказка по клавишам: клавиша → ключ перевода. */
const CONTROLS: [string, string][] = [
  ['W/↑', 'ctl.gas'],
  ['S/↓', 'ctl.brake'],
  ['A D', 'ctl.steer'],
  ['space', 'ctl.handbrake'],
  ['Shift', 'ctl.nitro'],
  ['C', 'ctl.camera'],
  ['R', 'ctl.reset'],
  ['Esc', 'ctl.pause'],
  ['Q/E', 'ctl.shift'],
];

export const LANG_KEY = 'sr:lang';
export function locale(): string {
  return getLang() === 'ru' ? 'ru-RU' : 'en-US';
}

const DEFAULTS: MenuSettings = {
  mode: 'circuit',
  carId: 'era2000_coupe',
  bots: 5,
  botLevel: 'medium',
  manual: false,
  playerName: '',
  location: 'moscow_center',
  weather: 'snow',
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
  const city = CITY_TRACKS[s.location];
  return {
    mode: s.mode,
    trackId: city ? city[s.mode] : (TRACK_LOCATIONS[s.location] ?? m.track),
    cityId: city ? s.location : undefined,
    weather: city ? s.weather : 'dry',
    carId: s.carId,
    bots: m.bots ? s.bots : 0,
    botLevel: s.botLevel,
    laps: m.laps,
    manual: s.manual,
    playerName: s.playerName || t('menu.defaultName'),
  };
}

const LEVELS: { id: BotLevel; title: () => string }[] = [
  { id: 'easy', title: () => t('level.easy') },
  { id: 'medium', title: () => t('level.medium') },
  { id: 'hard', title: () => t('level.hard') },
];

function h(html: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

export interface MenuActions {
  start: (setup: RaceSetup) => void;
  online: () => void;
  /** Экраны метаигры (профиль, гараж, рекорды, рейтинг, диспетчер). */
  meta: (
    screen: 'profile' | 'garage' | 'records' | 'ratings' | 'dispatcher' | 'shop' | 'music',
  ) => void;
}

/** Главное меню: режим, машина, соперники. */
export function showMenu(root: HTMLElement, actions: MenuActions): () => void {
  const s = loadSettings();
  const el = h(`<div class="screen"><div class="menu">
    <div class="topbar">
      <button class="btn" data-meta="profile">${account.token ? `👤 ${escapeHtml(account.name ?? '')}` : t('menu.login')}</button>
      <button class="btn" data-meta="garage">${t('menu.garage')}</button>
      <button class="btn" data-meta="shop">${t('menu.shop')}</button>
      <button class="btn" data-meta="records">${t('menu.records')}</button>
      <button class="btn" data-meta="ratings">${t('menu.ratings')}</button>
      <button class="btn" data-meta="music">${t('menu.music')}</button>
      <button class="btn" data-meta="dispatcher">${t('menu.dispatcher')}</button>
    </div>
    <h1>${BRAND.title}</h1>
    <p class="tagline">${t('brand.tagline')}</p>
    <a class="btn blind-cta" href="?blind">${t('menu.blind')}<small>${t('menu.blind.sub')}</small></a>
    <h2>${t('menu.where')}</h2><div class="grid2" data-k="loc"></div>
    <div data-k="weatherBlock"><h2>${t('menu.weather')}</h2><div class="row" data-k="weather"></div></div>
    <h2>${t('menu.mode')}</h2><div class="grid2" data-k="mode"></div>
    <img data-k="map" class="trackmap" alt="" />
    <h2>${t('menu.car')}</h2><div class="grid2" data-k="car"></div>
    <div data-k="botsBlock"><h2>${t('menu.rivals')}</h2>
      <div class="row" data-k="bots"></div>
      <div class="row" data-k="level" style="margin-top:8px"></div>
    </div>
    <h2>${t('menu.gearbox')}</h2><div class="row" data-k="gear"></div>
    <h2>${t('menu.graphics')}</h2><div class="row" data-k="quality"></div>
    <h2>${t('menu.language')}</h2><div class="row" data-k="lang"></div>
    <h2>${t('menu.name')}</h2><input type="text" maxlength="16" data-k="name" placeholder="${t('menu.defaultName')}" />
    <button class="btn primary" data-k="go">${t('menu.go')}</button>
    <button class="btn" data-k="online" style="width:100%;margin-top:8px;text-align:center">${t('menu.online')}</button>
    <p class="hint">
      ${CONTROLS.map(([k, l]) => `<span class="kbd">${k === 'space' ? t('ctl.space') : k}</span> ${t(l)}`).join(' · ')}<br/>
      ${t('ctl.gamepad')} ${t('ctl.touch')}
    </p>
  </div></div>`);
  root.appendChild(el);
  const q = (k: string) => el.querySelector(`[data-k="${k}"]`) as HTMLElement;

  const render = () => {
    const locBox = q('loc');
    locBox.innerHTML = '';
    for (const l of LOCATIONS) {
      const b = h(
        `<button class="btn ${s.location === l.id ? 'sel' : ''}">${l.title()}<small>${l.desc()}</small></button>`,
      );
      b.onclick = () => {
        s.location = l.id;
        render();
      };
      locBox.appendChild(b);
    }
    q('weatherBlock').style.display = CITY_TRACKS[s.location] ? '' : 'none';
    // Карта трассы (BLENDER_PLAN 7.3): apps/client/public/maps/<trackId>.png
    const map = q('map') as HTMLImageElement;
    map.src = `${import.meta.env.BASE_URL}maps/${setupFromSettings(s).trackId}.png`;
    map.onerror = () => (map.style.display = 'none');
    map.onload = () => (map.style.display = '');
    const wBox = q('weather');
    wBox.innerHTML = '';
    for (const w of ['dry', 'wet', 'snow'] as Weather[]) {
      const b = h(
        `<button class="btn ${s.weather === w ? 'sel' : ''}">${t(`weather.${w}`)}</button>`,
      );
      b.onclick = () => {
        s.weather = w;
        render();
      };
      wBox.appendChild(b);
    }
    const modeBox = q('mode');
    modeBox.innerHTML = '';
    for (const id of Object.keys(MODES) as ModeId[]) {
      const b = h(
        `<button class="btn ${s.mode === id ? 'sel' : ''}">${t(`mode.${id}`)}<small>${t(`mode.${id}.desc`)}</small></button>`,
      );
      b.onclick = () => {
        s.mode = id;
        render();
      };
      modeBox.appendChild(b);
    }
    const carBox = q('car');
    carBox.innerHTML = '';
    if (account.token) {
      // Вошли: едем на машине из гаража (с тюнингом)
      const b = h(
        `<button class="btn sel">${t('menu.garageCar')}<small>${t('menu.garageCar.sub')}</small></button>`,
      );
      b.onclick = () => actions.meta('garage');
      carBox.appendChild(b);
    }
    for (const c of account.token ? [] : Object.values(CARS)) {
      const ghost = loadGhost(setupFromSettings(s).trackId, c.id);
      const stats = t('menu.carStats', {
        era: c.era,
        drive: t(`drive.${c.drive}`),
        t: c.specs.zeroTo100,
        top: c.specs.topSpeedKmh,
      });
      const best = ghost
        ? `<br/>${t('menu.bestLap', { time: formatTime(ghost.lapSteps / 60) })}`
        : '';
      const b = h(
        `<button class="btn ${s.carId === c.id ? 'sel' : ''}">${c.name}<small>${stats}${best}</small></button>`,
      );
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
        `<button class="btn ${s.bots === n ? 'sel' : ''}">${n === 0 ? t('menu.solo') : n}</button>`,
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
    for (const [m, key] of [
      [false, 'gear.auto'],
      [true, 'gear.manual'],
    ] as const) {
      const b = h(`<button class="btn ${s.manual === m ? 'sel' : ''}">${t(key)}</button>`);
      b.onclick = () => {
        s.manual = m;
        render();
      };
      gear.appendChild(b);
    }
    // Качество графики — здесь, а не ссылками в подсказке (PLAN_V2 7.0.6)
    const qBox = q('quality');
    qBox.innerHTML = '';
    const cur = loadQualitySetting();
    for (const [v, key] of [
      ['auto', 'quality.auto'],
      ['low', 'quality.low'],
      ['high', 'quality.high'],
    ] as const) {
      const b = h(`<button class="btn ${cur === v ? 'sel' : ''}">${t(key)}</button>`);
      b.onclick = () => {
        saveQualitySetting(v);
        render();
      };
      qBox.appendChild(b);
    }
    const langBox = q('lang');
    langBox.innerHTML = '';
    for (const l of ['ru', 'en'] as Lang[]) {
      const b = h(`<button class="btn ${getLang() === l ? 'sel' : ''}">${t(`lang.${l}`)}</button>`);
      b.onclick = () => {
        try {
          localStorage.setItem(LANG_KEY, l);
        } catch {
          /* без хранилища язык держится до перезагрузки */
        }
        setLang(l);
        document.documentElement.lang = l;
        // Шаблон меню собран на старом языке — пересобираем экран целиком
        // (сначала язык уходит в профиль, но не дольше 1,5 с)
        void Promise.race([
          import('../meta/settings-sync').then((m) => m.pushSettings({ lang: l })),
          new Promise((r) => setTimeout(r, 1500)),
        ]).finally(() => location.reload());
      };
      langBox.appendChild(b);
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
  el.querySelectorAll<HTMLElement>('[data-meta]').forEach((b) => {
    b.onclick = () => {
      saveSettings(s);
      actions.meta(b.dataset.meta as Parameters<MenuActions['meta']>[0]);
    };
  });
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
    headline = tn('res.points', r.driftScore ?? 0);
    sub = t('res.bestChain', { n: (r.bestDriftChain ?? 0).toLocaleString(locale()) });
  } else if (r.setup.mode === 'timeattack') {
    headline = formatTime(me?.time ?? 0);
    sub = r.newBestLap
      ? t('res.newRecord')
      : t('res.bestLap', { time: formatTime(r.bestLap ?? 0) });
  } else {
    const time = formatTime(me?.time ?? 0);
    if (!me?.finished) {
      headline = t('res.dnf');
      sub = t('res.bestLap', { time: formatTime(r.bestLap ?? 0) });
    } else if (me.position === 1) {
      headline = t('res.win');
      sub = t('res.win.sub', { time });
    } else {
      headline = t('res.place', { n: me.position });
      sub = t('res.almost', { time });
    }
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
    ${r.rows.length > 1 ? `<table><tr><th>#</th><th>${t('res.racer')}</th><th>${t('res.time')}</th><th>${t('res.bestLapH')}</th></tr>${rows}</table>` : ''}
    <div class="btnrow"><button class="btn" data-k="again">${t('res.again')}</button><button class="btn" data-k="menu">${t('res.menu')}</button></div>
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
  /** Фоторежим (нет в онлайне). */
  photo?: () => void;
  /** Переключатели (например, сенсорное управление): подпись зависит от состояния. */
  toggles?: { label: () => string; toggle: () => void | Promise<void> }[];
}

export function showPause(root: HTMLElement, a: PauseActions): () => void {
  const el = h(`<div class="screen"><div class="menu panel">
    <p class="big" style="font:900 italic 40px var(--font);margin:0 0 12px">${t('pause.title')}</p>
    <div class="btnrow" style="flex-direction:column">
      <button class="btn" data-k="resume">${t('pause.resume')}</button>
      <button class="btn" data-k="restart">${t('pause.restart')}</button>
      <button class="btn" data-k="camera">${t('pause.camera')}</button>
      ${a.photo ? `<button class="btn" data-k="photo">${t('pause.photo')}</button>` : ''}
      <button class="btn" data-k="debug">${t('pause.debug')}</button>
      <button class="btn" data-k="menu">${t('pause.menu')}</button>
    </div></div></div>`);
  root.appendChild(el);
  for (const k of ['resume', 'restart', 'menu', 'camera', 'debug'] as const) {
    (el.querySelector(`[data-k="${k}"]`) as HTMLElement).onclick = a[k];
  }
  if (a.photo) (el.querySelector('[data-k="photo"]') as HTMLElement).onclick = a.photo;
  const row = el.querySelector('.btnrow') as HTMLElement;
  for (const t of a.toggles ?? []) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = t.label();
    b.onclick = async () => {
      await t.toggle();
      b.textContent = t.label();
    };
    row.insertBefore(b, row.lastElementChild);
  }
  return () => el.remove();
}

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
