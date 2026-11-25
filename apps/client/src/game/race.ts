import * as THREE from 'three';
import {
  DriftScorer,
  FIXED_DT,
  RaceTracker,
  emptyInput,
  getCar,
  getTrack,
  CAR_IDS,
  type City,
  type Weather,
  type RaceEvent,
  type RacerState,
} from '@sr/shared';
import { Bot, type BotLevel, type Rapier } from '@sr/physics';
import { Session, type SessionCar } from './session';
import { CarView } from '../render/car';
import type { Quality } from '../render/quality';
import type { InputManager } from '../input/input';
import {
  GHOST_EVERY,
  GhostRecorder,
  decodeGhost,
  loadGhost,
  saveGhost,
  type GhostFrame,
} from './ghost';

export type ModeId = 'circuit' | 'sprint' | 'drift' | 'timeattack' | 'free';

export interface RaceSetup {
  mode: ModeId;
  trackId: string;
  carId: string;
  bots: number;
  botLevel: BotLevel;
  laps: number;
  manual: boolean;
  playerName: string;
  /** Притяжение ботов к лидеру (только карьера). */
  rubberBand?: boolean;
  /** Слот решётки игрока (онлайн — назначает сервер). */
  slot?: number;
  /** Город (трасса проходит по его улицам). */
  cityId?: string;
  weather?: Weather;
}

export const MODES: Record<
  ModeId,
  { title: string; desc: string; track: string; laps: number; bots: boolean }
> = {
  circuit: {
    title: 'Круг',
    desc: 'Кольцо, несколько кругов против ботов',
    track: 'polygon',
    laps: 3,
    bots: true,
  },
  sprint: {
    title: 'Спринт',
    desc: 'Из точки А в точку Б, кто первый',
    track: 'night_sprint',
    laps: 1,
    bots: true,
  },
  drift: {
    title: 'Дрифт',
    desc: 'Очки за угол, скорость и длину цепочки',
    track: 'polygon',
    laps: 2,
    bots: false,
  },
  timeattack: {
    title: 'На время',
    desc: 'Один на трассе против своего призрака',
    track: 'polygon',
    laps: 3,
    bots: false,
  },
  free: {
    title: 'Свободная езда',
    desc: 'Полигон без правил и таймера',
    track: 'polygon',
    laps: 999,
    bots: false,
  },
};

const BOT_NAMES = ['Вега', 'Шторм', 'Кира', 'Марат', 'Нова', 'Рэй', 'Ли', 'Оскар'];

export interface ResultRow {
  id: string;
  name: string;
  position: number;
  time: number;
  bestLap: number;
  finished: boolean;
  isPlayer: boolean;
}

export interface RaceResults {
  setup: RaceSetup;
  rows: ResultRow[];
  driftScore?: number;
  bestDriftChain?: number;
  newBestLap?: boolean;
  bestLap?: number;
}

export class RaceController {
  readonly session: Session;
  readonly tracker: RaceTracker;
  readonly drift: DriftScorer | null;
  readonly bots: { car: SessionCar; bot: Bot; id: string }[] = [];
  readonly ids = new Map<SessionCar, string>();
  readonly names = new Map<string, string>();
  private ghostRec = new GhostRecorder();
  private lapStartFrame = 0;
  private ghostFrames: GhostFrame[] | null = null;
  ghostView: CarView | null = null;
  private ghostStep = 0;
  ghostBestSteps = 0;
  private finishedAt = -1;
  done = false;
  onEvent: (e: RaceEvent) => void = () => {};
  onResults: (r: RaceResults) => void = () => {};
  private newBest = false;
  /** Показывать результаты по локальному трекеру (онлайн — результаты даёт сервер). */
  protected localResults = true;

  constructor(
    R: Rapier,
    readonly setup: RaceSetup,
    quality: Quality,
    container: HTMLElement,
    input: InputManager,
    city: City | null = null,
  ) {
    const track = getTrack(setup.trackId);
    this.session = new Session(R, track, quality, container, input, city, setup.weather ?? 'dry');
    const free = setup.mode === 'free';
    this.tracker = new RaceTracker(track, setup.laps, free ? 0 : undefined);
    this.drift = setup.mode === 'drift' ? new DriftScorer() : null;

    // Игрок — в конце решётки при гонке с ботами (интереснее обгонять)
    const nBots = MODES[setup.mode].bots ? setup.bots : 0;
    const playerSlot = setup.slot ?? (nBots > 0 ? Math.min(nBots, 7) : 0);
    const pc = this.session.addCar(getCar(setup.carId), playerSlot, {
      player: true,
      manual: setup.manual,
      name: setup.playerName,
      color: 0xe8eef7,
    });
    this.register(pc, 'player', setup.playerName);
    // Автопилот игрока после финиша
    const autoBot = new Bot(pc.vehicle, track, { level: 'medium' });
    pc.controller = () => autoBot.think();

    let slot = 0;
    for (let i = 0; i < nBots; i++) {
      if (slot === playerSlot) slot++;
      const carId = CAR_IDS[i % CAR_IDS.length]!;
      const sc = this.session.addCar(getCar(carId), slot, {
        name: BOT_NAMES[i % BOT_NAMES.length],
      });
      const bot = new Bot(sc.vehicle, track, {
        level: setup.botLevel,
        lane: ((i % 3) - 1) * 2.5,
        rubberBand: setup.rubberBand,
      });
      const id = `bot${i}`;
      this.register(sc, id, BOT_NAMES[i % BOT_NAMES.length]!);
      sc.controller = () =>
        this.tracker.phase === 'countdown' ? { ...emptyInput(), handbrake: 1 } : bot.think();
      this.bots.push({ car: sc, bot, id });
      slot++;
    }
    const allVehicles = this.session.cars.map((c) => c.vehicle);
    for (const b of this.bots) b.bot.others = allVehicles;
    autoBot.others = allVehicles;

    if (setup.mode === 'timeattack') this.loadGhost();

    this.session.hooks.afterStep = (step) => this.afterStep(step);
    this.session.playerFrozen = this.tracker.phase === 'countdown';
  }

  private register(c: SessionCar, id: string, name: string): void {
    this.ids.set(c, id);
    this.names.set(id, name);
    const p = c.vehicle.position;
    this.tracker.addRacer(id, p.x, p.z);
  }

  get player(): SessionCar {
    return this.session.player!;
  }

  playerState(): RacerState {
    return this.tracker.racers.get('player')!;
  }

  /** Позиция игрока и число участников (онлайн переопределяет по данным сервера). */
  positionInfo(): { position: number; total: number } {
    return { position: this.playerState().position, total: this.tracker.racers.size };
  }

  /** Доп. точки мини-карты (сетевые машины). */
  extraDots(): { x: number; z: number; color: string }[] {
    return [];
  }

  /** Каждый кадр (онлайн: интерполяция чужих машин). */
  frame(_dt: number, _alpha: number): void {}

  private loadGhost(): void {
    const g = loadGhost(this.setup.trackId, this.setup.carId);
    if (!g) return;
    this.ghostFrames = decodeGhost(g.ghost);
    this.ghostBestSteps = g.lapSteps;
    this.ghostView = new CarView(getCar(this.setup.carId), { color: 0x7fd6ff, ghost: true });
    this.session.gfx.scene.add(this.ghostView.root);
  }

  private afterStep(_step: number): void {
    const t = this.tracker;
    this.session.playerFrozen = t.phase === 'countdown';
    for (const c of this.session.cars) {
      const id = this.ids.get(c)!;
      const p = c.vehicle.position;
      const v = c.vehicle.body.linvel();
      // Сброс выполняет Sim — в последнюю точку, где машина уверенно стояла на трассе
      t.updateRacer(id, p.x, p.z, v.x, v.z);
    }
    t.tick();

    // Дрифт-очки
    if (this.drift && t.phase === 'racing' && !this.playerState().finished) {
      const tel = this.player.vehicle.telemetry();
      this.drift.update(
        FIXED_DT,
        Math.abs(tel.slipAngleDeg),
        tel.speedKmh,
        this.player.vehicle.wallContact,
      );
    }

    // Призрак: запись каждые 3 шага
    if (t.phase !== 'countdown' && t.step % GHOST_EVERY === 0) {
      const pv = this.player.vehicle;
      const p = pv.position;
      const q = pv.rotation;
      this.ghostRec.push({ x: p.x, y: p.y, z: p.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w });
    }
    if (t.phase === 'racing') this.ghostStep++;

    for (const e of t.drain()) this.handleEvent(e);

    if (this.finishedAt >= 0 && !this.done && this.localResults) {
      const allDone = t.phase === 'finished';
      if (
        allDone ||
        t.step - this.finishedAt > 60 * 20 ||
        (this.setup.mode !== 'circuit' && this.setup.mode !== 'sprint')
      ) {
        this.done = true;
        this.onResults(this.results());
      }
    }
  }

  private handleEvent(e: RaceEvent): void {
    if (e.type === 'overtake') {
      const car = [...this.ids.entries()].find(([, id]) => id === e.racer)?.[0];
      if (car) car.vehicle.addNitro(car.vehicle.cfg.nitro.chargePerOvertake);
    }
    if (e.type === 'start') {
      this.ghostRec.reset();
      this.lapStartFrame = 0;
      this.ghostStep = 0;
    }
    if (e.type === 'lap' && e.racer === 'player') {
      // Лучший круг → призрак
      const steps = e.lapSteps!;
      const stored = loadGhost(this.setup.trackId, this.setup.carId);
      const frames = this.ghostRec.length;
      if (!stored || steps < stored.lapSteps) {
        saveGhost(this.setup.trackId, this.setup.carId, {
          ghost: this.ghostRec.slice(this.lapStartFrame, frames),
          lapSteps: steps,
          car: this.setup.carId,
          date: new Date().toISOString(),
        });
        this.newBest = true;
      }
      this.lapStartFrame = frames;
      this.ghostStep = 0;
    }
    if (e.type === 'finish' && e.racer === 'player') {
      this.finishedAt = this.tracker.step;
      this.drift?.bank();
      this.session.autopilot = true;
    }
    this.onEvent(e);
  }

  /** Отрисовка призрака (каждый кадр). */
  updateGhost(alpha: number): void {
    if (!this.ghostFrames || !this.ghostView) return;
    const f = (this.ghostStep + alpha) / GHOST_EVERY;
    const i = Math.floor(f);
    const a = this.ghostFrames[Math.min(i, this.ghostFrames.length - 1)];
    const b = this.ghostFrames[Math.min(i + 1, this.ghostFrames.length - 1)];
    if (!a || !b) return;
    const k = f - i;
    const v = this.ghostView.root;
    v.visible = this.tracker.phase === 'racing';
    v.position.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
    v.quaternion.slerpQuaternions(
      new THREE.Quaternion(a.qx, a.qy, a.qz, a.qw),
      new THREE.Quaternion(b.qx, b.qy, b.qz, b.qw),
      k,
    );
  }

  results(): RaceResults {
    const rows: ResultRow[] = this.tracker.standings().map((r) => ({
      id: r.id,
      name: this.names.get(r.id) ?? r.id,
      position: r.position,
      time: r.finished ? r.finishStep / 60 : 0,
      bestLap: r.bestLapSteps / 60,
      finished: r.finished,
      isPlayer: r.id === 'player',
    }));
    const pl = this.playerState();
    return {
      setup: this.setup,
      rows,
      driftScore: this.drift?.total,
      bestDriftChain: this.drift?.bestChain,
      newBestLap: this.newBest,
      bestLap: pl.bestLapSteps / 60,
    };
  }

  dispose(): void {
    this.session.dispose();
  }
}
