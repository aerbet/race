import * as THREE from 'three';
import {
  t,
  FixedStepLoop,
  FIXED_DT,
  InputRecorder,
  emptyInput,
  type BuiltTrack,
  type CarConfig,
  type InputFrame,
} from '@sr/shared';
import { CityColliders, Sim, type Rapier, type Vehicle } from '@sr/physics';
import { CityView } from '../city/city-view';
import { SMOKE_COLORS, WEATHER_GRIP, type City, type Weather } from '@sr/shared';
import { SceneRenderer } from '../render/scene';
import { LevelView } from '../render/level';
import { CarView } from '../render/car';
import { CameraRig } from '../render/camera';
import { SkidMarks, Smoke, SpeedLines } from '../render/effects';
import type { Quality } from '../render/quality';
import type { InputManager } from '../input/input';

interface Pose {
  p: THREE.Vector3;
  q: THREE.Quaternion;
}

/** Машина в сессии: физика + отображение + интерполяция. */
export class SessionCar {
  prev: Pose = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  curr: Pose = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  input: InputFrame = emptyInput();
  /** Источник ввода для этой машины на шаг; null — ввод задаётся снаружи. */
  controller: ((step: number) => InputFrame) | null = null;
  name = '';

  /** Цветной дым из ателье; без него — серый. */
  smokeColor?: THREE.Color;

  constructor(
    readonly vehicle: Vehicle,
    readonly view: CarView,
    readonly index: number,
  ) {
    this.capture();
    this.prev.p.copy(this.curr.p);
    this.prev.q.copy(this.curr.q);
  }

  capture(): void {
    const t = this.vehicle.body.translation();
    const r = this.vehicle.body.rotation();
    this.curr.p.set(t.x, t.y, t.z);
    this.curr.q.set(r.x, r.y, r.z, r.w);
  }
}

export interface SessionHooks {
  /** После каждого шага физики. */
  afterStep?: (step: number) => void;
  /** Каждый кадр (после интерполяции, до рендера). */
  frame?: (dt: number, alpha: number) => void;
}

const CAR_COLORS = [0xe8eef7, 0xd8262f, 0x2f7de1, 0xf2b31b, 0x22c06e, 0x9b40e0, 0xff7a1a, 0x3dd6d0];
const NEON_COLORS = [0x29e0ff, 0xff2bd6, 0x8cff3a, 0xffb02b];

export class Session {
  readonly sim: Sim;
  readonly gfx: SceneRenderer;
  readonly level: LevelView;
  readonly rig: CameraRig;
  readonly cars: SessionCar[] = [];
  readonly loop: FixedStepLoop;
  readonly skid: SkidMarks;
  readonly smoke: Smoke;
  readonly speedLines: SpeedLines | null;
  readonly recorder = new InputRecorder();
  player: SessionCar | null = null;
  /** Ввод игрока заморожен (обратный отсчёт, финиш). */
  playerFrozen = false;
  /** После финиша машиной игрока управляет бот. */
  autopilot = false;
  hooks: SessionHooks = {};
  private raf = 0;
  private lastT = 0;
  private running = false;
  private time = 0;
  readonly extraObjects = new THREE.Group();
  cityView: CityView | null = null;
  cityColliders: CityColliders | null = null;

  constructor(
    R: Rapier,
    readonly track: BuiltTrack,
    readonly quality: Quality,
    readonly container: HTMLElement,
    readonly input: InputManager,
    readonly city: City | null = null,
    readonly weather: Weather = 'dry',
  ) {
    this.sim = new Sim(R, track);
    this.gfx = new SceneRenderer(container, quality);
    this.level = new LevelView(track, this.sim.level.geometry, quality, !!city);
    this.gfx.scene.add(this.level.group, this.extraObjects);
    if (city) {
      this.cityView = new CityView(city, quality, weather);
      this.gfx.scene.add(this.cityView.group);
      this.cityColliders = new CityColliders(city, this.sim);
      if (weather !== 'dry') {
        const fog = this.gfx.scene.fog as THREE.Fog;
        fog.color.set(weather === 'snow' ? 0x2a2f3c : 0x10141f);
        fog.far = Math.min(fog.far, weather === 'snow' ? 260 : 380);
        this.gfx.scene.background = fog.color.clone();
      }
    }
    this.rig = new CameraRig(this.gfx.camera);
    this.skid = new SkidMarks(quality.skidMarks);
    this.smoke = new Smoke(quality.smokeParticles);
    this.gfx.scene.add(this.skid.mesh, this.smoke.points);
    this.speedLines = quality.speedLines ? new SpeedLines(container) : null;
    this.loop = new FixedStepLoop((dt, step) => this.step(dt, step));
    document.addEventListener('visibilitychange', () => {
      this.loop.paused = document.hidden || this.userPaused;
      this.lastT = performance.now();
    });
  }

  userPaused = false;
  /** Камеру ведёт фоторежим, а не CameraRig. */
  freeCamera = false;

  setPaused(p: boolean): void {
    this.userPaused = p;
    this.loop.paused = p || document.hidden;
  }

  addCar(
    cfg: CarConfig,
    slot: number,
    opts: {
      player?: boolean;
      color?: number;
      neon?: number | null;
      /** Премиум-внешний вид: краска, эффект неона, винил, диски, антикрыло, кузовной кит. */
      look?: {
        paint?: string;
        neonFx?: string;
        vinyl?: string;
        rims?: string;
        spoiler?: string;
        kit?: string;
        paint2?: string;
        /** Цвет дыма из-под колёс (id из SMOKE_COLORS). */
        smoke?: string;
      };
      name?: string;
      manual?: boolean;
      /** Дрифт-гонка: срыв в занос и без ручника (сброс газа, скольжение на газу). */
      driftMode?: boolean;
    } = {},
  ): SessionCar {
    const v = this.sim.addCar(cfg, slot, { manualGearbox: opts.manual, driftMode: opts.driftMode });
    const view = new CarView(cfg, {
      color: opts.color ?? CAR_COLORS[slot % CAR_COLORS.length]!,
      neon: opts.neon === null ? undefined : (opts.neon ?? NEON_COLORS[slot % NEON_COLORS.length]),
      ...opts.look,
    });
    this.gfx.scene.add(view.root);
    v.surfaceGrip = WEATHER_GRIP[this.weather];
    const c = new SessionCar(v, view, this.cars.length);
    const smoke = opts.look?.smoke ? SMOKE_COLORS[opts.look.smoke] : undefined;
    if (smoke) c.smokeColor = new THREE.Color(smoke);
    c.name = opts.name ?? t('net.carSlot', { n: slot + 1 });
    this.cars.push(c);
    if (opts.player) {
      this.player = c;
      this.input.steerRate = cfg.steering.keyboardRate;
      this.input.steerReturn = cfg.steering.keyboardReturnRate;
      this.rig.snap();
    }
    return c;
  }

  private step(_dt: number, step: number): void {
    for (const c of this.cars) {
      if (c === this.player && this.autopilot && c.controller) {
        this.input.sample(FIXED_DT);
        c.input = c.controller(step);
      } else if (c === this.player) {
        const inp = this.input.sample(FIXED_DT);
        // Во время отсчёта машина стоит на ручнике
        c.input = this.playerFrozen ? { ...emptyInput(), handbrake: 1 } : inp;
        this.recorder.push(c.input);
      } else if (c.controller) {
        c.input = c.controller(step);
      }
    }
    for (const c of this.cars) {
      c.prev.p.copy(c.curr.p);
      c.prev.q.copy(c.curr.q);
    }
    if (this.cityColliders && step % 10 === 0) {
      this.cityColliders.update(this.cars.map((c) => c.vehicle.position));
    }
    this.sim.tick(this.cars.map((c) => c.input));
    for (const c of this.cars) {
      const before = c.curr.p.clone();
      c.capture();
      // Телепорт (сброс) — без интерполяции
      if (before.distanceToSquared(c.curr.p) > 25) {
        c.prev.p.copy(c.curr.p);
        c.prev.q.copy(c.curr.q);
        if (c === this.player) this.rig.snap();
      }
    }
    this.hooks.afterStep?.(step);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastT = performance.now();
    const frame = (t: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (t - this.lastT) / 1000);
      this.lastT = t;
      this.frame(dt);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private tmpP = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();

  frame(dt: number): void {
    this.time += dt;
    this.loop.advance(dt);
    const a = this.loop.alpha;
    for (const c of this.cars) this.updateCarView(c, a, dt);
    const pl = this.player;
    if (pl) {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(pl.view.root.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(pl.view.root.quaternion);
      const lv = pl.vehicle.body.linvel();
      const vel = new THREE.Vector3(lv.x, lv.y, lv.z);
      // Фоторежим ведёт камеру сам
      if (!this.freeCamera)
        this.rig.update(dt, pl.view.root.position, fwd, vel, pl.vehicle.nitroActive, up);
      this.gfx.followShadow(pl.view.root.position.x, pl.view.root.position.z);
      const speed = vel.length();
      const intensity =
        Math.max(0, Math.min(1, (speed - 35) / 35)) * 0.6 + (pl.vehicle.nitroActive ? 0.5 : 0);
      this.speedLines?.update(dt, intensity);
      this.gfx.setBlur(intensity * 0.06);
    }
    this.smoke.update(dt);
    if (this.cityView) {
      const cp = this.gfx.camera.position;
      this.cityView.update(cp.x, cp.z, dt);
    }
    this.hooks.frame?.(dt, a);
    this.gfx.render();
  }

  private updateCarView(c: SessionCar, alpha: number, _dt: number): void {
    this.tmpP.lerpVectors(c.prev.p, c.curr.p, alpha);
    this.tmpQ.slerpQuaternions(c.prev.q, c.curr.q, alpha);
    const root = c.view.root;
    root.position.copy(this.tmpP);
    root.quaternion.copy(this.tmpQ);
    const v = c.vehicle;
    const lv = v.body.linvel();
    for (let i = 0; i < 4; i++) {
      const w = v.wheels[i]!;
      c.view.setWheel(
        i,
        new THREE.Vector3(w.mount.x, w.mount.y, w.mount.z),
        w.suspensionLength,
        w.front ? v.steerAngle : 0,
        w.spin,
        w.left,
      );
      // Следы и дым
      if (w.contact && w.slip > 0.25) {
        const cp = w.contactPoint;
        this.skid.add(
          c.index * 4 + i,
          cp.x,
          cp.z,
          lv.x,
          lv.z,
          v.cfg.wheels.width,
          Math.min(1, w.slip),
        );
        if (!w.front && Math.random() < Math.min(1, w.slip) * 0.6)
          this.smoke.emit(cp.x, cp.y + 0.2, cp.z, lv.x, lv.z, c.smokeColor);
      } else {
        this.skid.add(c.index * 4 + i, 0, 0, 0, 0, 0, 0);
      }
    }
    c.view.setBraking(c.input.brake > 0.1 || c.input.handbrake > 0.1);
    c.view.setNitro(v.nitroActive, this.time);
  }

  dispose(): void {
    this.stop();
    this.sim.dispose();
    this.gfx.renderer.dispose();
    this.gfx.renderer.domElement.remove();
    this.speedLines?.canvas.remove();
  }
}
