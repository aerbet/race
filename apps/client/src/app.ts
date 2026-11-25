import type { Rapier } from '@sr/physics';
import { formatTime, type RaceEvent } from '@sr/shared';
import { RaceController, type RaceResults, type RaceSetup } from './game/race';
import type { Quality } from './render/quality';
import { FpsCounter } from './render/fps';
import { InputManager } from './input/input';
import { Hud, type MinimapDot } from './ui/hud';
import { showMenu, showPause, showResults } from './ui/menu';
import { DebugPanel } from './ui/debug-panel';
import { InputDebug } from './ui/input-debug';
import { CarAudio, audio } from './audio/engine-audio';

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

  menu(): void {
    this.endRace();
    this.closeScreen?.();
    this.closeScreen = showMenu(this.root, {
      start: (setup) => this.start(setup),
      online: () => this.onOnline(),
    });
  }

  start(setup: RaceSetup): void {
    this.closeScreen?.();
    this.closeScreen = null;
    this.endRace();
    this.lastSetup = setup;
    const race = new RaceController(this.R, setup, this.quality, this.root, this.input);
    this.race = race;
    this.attach(race);
    race.session.start();
  }

  /** Подключить HUD, звук и обработчики к уже созданной гонке (используется и онлайн-режимом). */
  attach(race: RaceController, opts: { onResults?: (r: RaceResults) => void } = {}): void {
    this.race = race;
    const hud = new Hud(this.root);
    hud.setTrack(race.session.track);
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
        position: st.position,
        total: tr.racers.size,
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
      race.session.cars.map(
        (c, i): MinimapDot => ({
          x: c.vehicle.position.x,
          z: c.vehicle.position.z,
          color: c === race.player ? '#29e0ff' : DOT_COLORS[i % DOT_COLORS.length]!,
          player: c === race.player,
        }),
      ),
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
    this.race.session.setPaused(this.paused);
    const a = audio();
    if (a) void (this.paused ? a.ctx.suspend() : a.ctx.resume());
    if (this.paused) {
      this.closeScreen = showPause(this.root, {
        resume: () => this.togglePause(),
        restart: () => {
          this.paused = false;
          if (this.lastSetup) this.start(this.lastSetup);
        },
        menu: () => {
          this.paused = false;
          this.menu();
        },
        camera: () => this.race?.session.rig.cycle(),
        debug: () => this.toggleDebug(),
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

  private showResults(r: RaceResults): void {
    this.closeScreen?.();
    this.closeScreen = showResults(this.root, r, {
      restart: () => this.lastSetup && this.start(this.lastSetup),
      menu: () => this.menu(),
    });
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
    this.pauseBtn.classList.add('hidden');
    this.input.touch.show(false);
    const a = audio();
    if (a && a.ctx.state === 'suspended') void a.ctx.resume();
  }

  get current(): RaceController | null {
    return this.race;
  }
}
