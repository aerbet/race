import type { Rapier } from '@sr/physics';
import { formatTime, toBase64, type City, type RaceEvent } from '@sr/shared';
import { loadCity } from './city/city-view';
import { RaceController, type RaceResults, type RaceSetup } from './game/race';
import type { Quality } from './render/quality';
import { FpsCounter } from './render/fps';
import { InputManager } from './input/input';
import { Hud, type MinimapDot } from './ui/hud';
import { showMenu, showPause, showResults } from './ui/menu';
import { DebugPanel } from './ui/debug-panel';
import { InputDebug } from './ui/input-debug';
import { CarAudio, audio } from './audio/engine-audio';
import { showShop } from './meta/shop-screen';
import { MusicWidget } from './ui/music-ui';
import { account } from './meta/account';
import { ApiError, activeCar, api } from './meta/api';
import {
  dispatcherSeen,
  showDispatcher,
  showGarage,
  showProfile,
  showRatings,
  showRecords,
} from './meta/screens';

const DOT_COLORS = ['#ff4d5e', '#4d9bff', '#ffc23d', '#3ddc84', '#b56dff', '#ff8a3d', '#3de0d6'];

/** Корневой контроллер приложения: меню → гонка → результаты. */
export class App {
  readonly input: InputManager;
  private race: RaceController | null = null;
  private hud: Hud | null = null;
  private fps: FpsCounter;
  private closeScreen: (() => void) | null = null;
  private debug: DebugPanel | null = null;
  private inputDebug: InputDebug | null = null;
  private audios: CarAudio[] = [];
  private lastSetup: RaceSetup | null = null;
  private paused = false;
  /** Онлайн: пауза не останавливает симуляцию, «заново» недоступно. */
  private online = false;
  private pauseBtn: HTMLButtonElement;
  /** Внешний хук для онлайн-режима. */
  onOnline: () => void = () => {};

  constructor(
    readonly R: Rapier,
    readonly root: HTMLElement,
    readonly quality: Quality,
  ) {
    this.input = new InputManager(root);
    this.fps = new FpsCounter(root);
    if (new URLSearchParams(location.search).has('debug'))
      this.inputDebug = new InputDebug(root, this.input);
    this.pauseBtn = document.createElement('button');
    this.pauseBtn.className = 'pause-btn hidden';
    this.pauseBtn.textContent = 'II';
    this.pauseBtn.onclick = () => this.togglePause();
    root.appendChild(this.pauseBtn);
    window.addEventListener('keydown', (e) => this.onKey(e));
    new MusicWidget(root);
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.race) return;
    if (e.code === 'Escape') this.togglePause();
    if (e.code === 'KeyC') this.race.session.rig.cycle();
    if (e.code === 'F2') {
      e.preventDefault();
      this.toggleDebug();
    }
  }

  private cities = new Map<string, City>();

  async loadCityCached(id: string): Promise<City> {
    let c = this.cities.get(id);
    if (!c) {
      c = await loadCity(id);
      this.cities.set(id, c);
    }
    return c;
  }

  /** Короткое сообщение поверх HUD. */
  toast(text: string, seconds = 2.5): void {
    this.hud?.showToast(text, seconds);
  }

  /** Закрыть текущий экран (меню, пауза, результаты). */
  closeScreens(): void {
    this.closeScreen?.();
    this.closeScreen = null;
  }

  menu(): void {
    this.endRace();
    this.closeScreen?.();
    this.closeScreen = showMenu(this.root, {
      start: (setup) => void this.start(setup),
      online: () => this.onOnline(),
      meta: (m) => {
        this.closeScreens();
        const back = () => this.menu();
        if (m === 'profile') showProfile(this.root, back);
        if (m === 'garage') showGarage(this.root, back);
        if (m === 'records') showRecords(this.root, back);
        if (m === 'ratings') showRatings(this.root, back);
        if (m === 'dispatcher') showDispatcher(this.root, back);
        if (m === 'shop') showShop(this.root, back);
      },
    });
    // Возврат со страницы оплаты: ?payment=<id>
    const returned = new URLSearchParams(location.search).get('payment');
    if (returned && /^[0-9a-f-]{36}$/.test(returned)) {
      history.replaceState(null, '', location.pathname);
      this.closeScreens();
      showShop(this.root, () => this.menu(), returned);
      return;
    }
    // Первый запуск — знакомство с «Диспетчером»
    if (!dispatcherSeen()) {
      this.closeScreens();
      showDispatcher(this.root, () => this.menu());
    }
  }

  async start(setup: RaceSetup): Promise<void> {
    this.closeScreen?.();
    this.closeScreen = null;
    this.endRace();
    // Вошли — едем на машине из гаража (тюнинг, окраска); API недоступен — на стоковой
    if (account.token && !setup.ownedCarId) {
      try {
        const car = await activeCar();
        if (car) {
          setup = {
            ...setup,
            carId: car.carId,
            parts: car.parts,
            paint: car.visual.paint,
            neon: car.visual.neon,
            visual: car.visual,
            ownedCarId: car.id,
          };
        }
      } catch {
        /* офлайн */
      }
    }
    this.lastSetup = setup;
    const city = setup.cityId ? await this.loadCityCached(setup.cityId) : null;
    const race = new RaceController(this.R, setup, this.quality, this.root, this.input, city);
    this.race = race;
    this.attach(race);
    race.session.start();
  }

  /** Подключить HUD, звук и обработчики к уже созданной гонке (используется и онлайн-режимом). */
  attach(
    race: RaceController,
    opts: { onResults?: (r: RaceResults) => void; online?: boolean } = {},
  ): void {
    this.race = race;
    this.online = !!opts.online;
    const hud = new Hud(this.root);
    hud.setTrack(race.session.track, race.session.city);
    this.hud = hud;
    this.pauseBtn.classList.remove('hidden');
    this.input.touch.show(this.input.device === 'touch');

    const a = audio();
    if (a) {
      for (const c of race.session.cars) {
        const isPlayer = c === race.player;
        this.audios.push(
          new CarAudio(a.ctx, c.vehicle.cfg.engine.sound, a.master, isPlayer ? 0.8 : 0),
        );
      }
    }

    race.onEvent = (e) => this.onRaceEvent(e);
    race.onResults =
      opts.onResults ??
      ((r) => {
        setTimeout(() => this.showResults(r), 600);
      });

    race.session.hooks.frame = (dt, alpha) => this.frame(dt, alpha);
  }

  private onRaceEvent(e: RaceEvent): void {
    const race = this.race;
    const hud = this.hud;
    if (!race || !hud) return;
    if (e.racer !== 'player') return;
    if (e.type === 'lap' && race.setup.mode !== 'free') {
      const left = race.tracker.laps - (e.lap ?? 0);
      const t = formatTime((e.lapSteps ?? 0) / 60);
      if (left === 1) hud.showToast(`ПОСЛЕДНИЙ КРУГ · ${t}`);
      else if (left > 1) hud.showToast(`КРУГ ${t}`);
    }
    if (e.type === 'lap' && race.setup.mode === 'free')
      hud.showToast(`КРУГ ${formatTime((e.lapSteps ?? 0) / 60)}`);
    if (e.type === 'overtake') hud.showToast('ОБГОН +N₂O', 1.2, 'good');
    if (e.type === 'finish') hud.showToast('ФИНИШ', 3);
  }

  private frame(dt: number, alpha: number): void {
    const race = this.race;
    const hud = this.hud;
    if (!race || !hud) return;
    this.fps.tick(dt, this.quality.name);
    this.inputDebug?.update();
    race.updateGhost(alpha);
    race.frame(dt, alpha);
    const pinfo = race.positionInfo();
    const pv = race.player.vehicle;
    const tel = pv.telemetry();
    const st = race.playerState();
    const tr = race.tracker;
    const time =
      tr.phase === 'countdown' ? 0 : st.finished ? st.finishStep / 60 : tr.raceSteps / 60;
    const drift = race.drift?.snapshot() ?? null;
    if (race.drift && drift?.lastEvent) {
      if (drift.lastEvent === 'lost')
        hud.showToast(`УДАР! −${drift.lastEventValue.toLocaleString('ru-RU')}`, 1.5, 'bad');
      else hud.showToast(`+${drift.lastEventValue.toLocaleString('ru-RU')}`, 1.5, 'good');
      race.drift.lastEvent = null;
    }
    hud.update(
      {
        speedKmh: tel.speedKmh,
        gear: tel.gear,
        rpm: tel.rpm,
        redline: pv.cfg.engine.redlineRpm,
        nitro: tel.nitro,
        nitroActive: tel.nitroActive,
        position: pinfo.position,
        total: pinfo.total,
        lap: st.lap,
        laps: tr.laps,
        time,
        lapTime: (tr.step - st.lapStartStep) / 60,
        bestLap: st.bestLapSteps / 60,
        ghostBest: race.ghostBestSteps / 60,
        countdown: tr.countdown,
        racing: tr.phase !== 'countdown',
        wrongWay: st.wrongWay,
        drift,
        mode: race.setup.mode,
        manual: race.setup.manual,
      },
      [
        ...race.extraDots(),
        ...race.session.cars.map(
          (c, i): MinimapDot => ({
            x: c.vehicle.position.x,
            z: c.vehicle.position.z,
            color: c === race.player ? '#29e0ff' : DOT_COLORS[i % DOT_COLORS.length]!,
            player: c === race.player,
          }),
        ),
      ],
      dt,
    );

    // Звук
    const pp = pv.position;
    race.session.cars.forEach((c, i) => {
      const au = this.audios[i];
      if (!au) return;
      const v = c.vehicle;
      const t = v.telemetry();
      if (c !== race.player) {
        const p = v.position;
        const d = Math.hypot(p.x - pp.x, p.z - pp.z);
        au.setVolume(Math.max(0, 1 - d / 80) * 0.35);
      }
      au.update(
        {
          rpm: t.rpm,
          throttle: c.input.throttle,
          slip: Math.max(...v.wheels.map((w) => w.slip)),
          nitro: t.nitroActive,
          speedKmh: t.speedKmh,
          wallHit: v.wallContact,
          grounded: t.grounded > 0,
        },
        dt,
      );
    });

    this.debug?.update();
  }

  togglePause(): void {
    if (!this.race || this.race.done) return;
    this.paused = !this.paused;
    if (!this.online) {
      this.race.session.setPaused(this.paused);
      const a = audio();
      if (a) void (this.paused ? a.ctx.suspend() : a.ctx.resume());
    }
    if (this.paused) {
      this.closeScreen = showPause(this.root, {
        resume: () => this.togglePause(),
        restart: () => {
          this.paused = false;
          if (this.online) this.menu();
          else if (this.lastSetup) this.start(this.lastSetup);
        },
        menu: () => {
          this.paused = false;
          this.menu();
        },
        camera: () => this.race?.session.rig.cycle(),
        debug: () => this.toggleDebug(),
        toggles:
          this.input.device === 'touch'
            ? [
                {
                  label: () => `Руль: ${this.input.touch.tilt ? 'наклон телефона' : 'кнопки'}`,
                  toggle: () => this.input.touch.enableTilt(!this.input.touch.tilt),
                },
                {
                  label: () => `Газ: ${this.input.touch.autoGas ? 'автоматический' : 'кнопкой'}`,
                  toggle: () => {
                    this.input.touch.autoGas = !this.input.touch.autoGas;
                    this.input.touch.savePrefs();
                  },
                },
              ]
            : [],
      });
    } else {
      this.closeScreen?.();
      this.closeScreen = null;
    }
  }

  toggleDebug(): void {
    if (!this.race) return;
    if (this.debug) {
      this.debug.dispose();
      this.debug = null;
    } else {
      this.debug = new DebugPanel(this.race.player.vehicle, this.root);
    }
  }

  /** Результаты с собственным действием «ещё раз» (онлайн). */
  showResultsPublic(r: RaceResults, again: () => void): void {
    this.closeScreen?.();
    this.closeScreen = showResults(this.root, r, {
      restart: () => {
        this.closeScreen?.();
        this.closeScreen = null;
        this.endRace();
        again();
      },
      menu: () => this.menu(),
    });
  }

  private showResults(r: RaceResults): void {
    this.closeScreen?.();
    this.closeScreen = showResults(this.root, r, {
      restart: () => this.lastSetup && void this.start(this.lastSetup),
      menu: () => this.menu(),
    });
    void this.submitRecord(r);
  }

  /** Заезд на время → рекорд в API (с записью ввода: сервер повторит заезд и сверит время). */
  private async submitRecord(r: RaceResults): Promise<void> {
    const race = this.race;
    const s = r.setup;
    if (!race || s.mode !== 'timeattack' || !account.token || !s.ownedCarId) return;
    const me = race.playerState();
    if (!me.finished || !me.bestLapSteps) return;
    const note = document.createElement('p');
    note.className = 'sub record-note';
    note.textContent = 'Отправляем рекорд на проверку…';
    this.root.querySelector('.results')?.appendChild(note);
    try {
      const res = await api<{ verified: boolean; rank: number; carClass: string }>('/api/records', {
        body: {
          trackId: s.trackId,
          ownedCarId: s.ownedCarId,
          weather: s.weather ?? 'dry',
          laps: s.laps,
          lapSteps: me.bestLapSteps,
          manual: s.manual,
          inputs: toBase64(race.session.recorder.toBytes()),
        },
      });
      note.textContent = `Рекорд принят: ${res.rank} место в классе ${res.carClass}${res.verified ? ' (проверен повтором)' : ''}`;
    } catch (e) {
      note.textContent =
        e instanceof ApiError ? `Рекорд не принят: ${e.message}` : 'Рекорд не отправлен';
    }
  }

  endRace(): void {
    this.debug?.dispose();
    this.debug = null;
    for (const a of this.audios) a.dispose();
    this.audios = [];
    this.hud?.dispose();
    this.hud = null;
    this.race?.dispose();
    this.race = null;
    this.paused = false;
    this.online = false;
    this.pauseBtn.classList.add('hidden');
    this.input.touch.show(false);
    const a = audio();
    if (a && a.ctx.state === 'suspended') void a.ctx.resume();
  }

  get current(): RaceController | null {
    return this.race;
  }
}
