import * as THREE from 'three';
import {
  CarFlags,
  Msg,
  RaceEventType,
  getCar,
  type CarState,
  type LobbyPlayer,
  type ServerMsg,
} from '@sr/shared';
import type { ProxyCar, Rapier } from '@sr/physics';
import { RaceController, type RaceResults, type RaceSetup } from '../game/race';
import { CarView } from '../render/car';
import type { Quality } from '../render/quality';
import type { InputManager } from '../input/input';
import type { NetClient } from './client';
import { CarAudio, audio } from '../audio/engine-audio';
import { INTERP_DELAY_STEPS, InterpBuffer, ServerClock } from './interp';

const REMOTE_COLORS = [0xd8262f, 0x2f7de1, 0xf2b31b, 0x22c06e, 0x9b40e0, 0xff7a1a, 0x3dd6d0];

interface Remote {
  id: number;
  name: string;
  bot: boolean;
  view: CarView;
  proxy: ProxyCar;
  buf: InterpBuffer;
  lap: number;
  position: number;
  color: string;
  spin: number;
  audio: CarAudio | null;
}

/**
 * Онлайн-гонка: своя машина считается локально (мгновенный отклик), состояние уходит
 * на сервер 30 Гц; чужие машины — интерполяция с буфером 100 мс и экстраполяция.
 */
export class OnlineRace extends RaceController {
  readonly remotes = new Map<number, Remote>();
  private clock = new ServerClock();
  private seq = 0;
  private lastPos = new THREE.Vector3();
  private resetPending = false;
  private serverPosition = 0;
  private correction: CarState | null = null;
  private correctionSteps = 0;
  private finishedLocal = false;
  private renderStep = 0;
  /** Сколько коррекций прислал сервер (отладка). */
  corrections: string[] = [];

  constructor(
    R: Rapier,
    setup: RaceSetup,
    quality: Quality,
    container: HTMLElement,
    input: InputManager,
    readonly net: NetClient,
    readonly myId: number,
    players: LobbyPlayer[],
  ) {
    super(R, setup, quality, container, input);
    this.localResults = false;
    const p0 = this.player.vehicle.position;
    this.lastPos.set(p0.x, p0.y, p0.z);
    let k = 0;
    players.forEach((p, slot) => {
      if (p.id === myId) return;
      const cfg = getCar(p.carId);
      const color = REMOTE_COLORS[k++ % REMOTE_COLORS.length]!;
      const view = new CarView(cfg, { color, neon: 0xff2bd6 });
      this.session.gfx.scene.add(view.root);
      const g = this.session.track.grid[slot]!;
      view.root.position.set(g.x, 0.8, g.z);
      view.root.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), g.yaw);
      const proxy = this.session.sim.addProxy(cfg, g.x, g.z);
      this.remotes.set(p.id, {
        id: p.id,
        name: p.name,
        bot: p.bot,
        view,
        proxy,
        buf: new InterpBuffer(),
        lap: 0,
        position: 0,
        color: '#' + color.toString(16).padStart(6, '0'),
        spin: 0,
        audio: (() => {
          const a = audio();
          return a ? new CarAudio(a.ctx, cfg.engine.sound, a.master, 0) : null;
        })(),
      });
      this.names.set(String(p.id), p.name);
    });
    const prevAfter = this.session.hooks.afterStep!;
    this.session.hooks.afterStep = (step) => {
      prevAfter(step);
      this.netStep();
    };
  }

  onServer(m: ServerMsg): void {
    switch (m.type) {
      case Msg.Snapshot: {
        this.clock.onSnapshot(m.step, performance.now());
        for (const e of m.entries) {
          if (e.id === this.myId) {
            this.serverPosition = e.position;
            continue;
          }
          const r = this.remotes.get(e.id);
          if (!r) continue;
          r.buf.push(m.step, e.car);
          r.lap = e.lap;
          r.position = e.position;
        }
        break;
      }
      case Msg.Correction:
        // Мягкая коррекция: подтягиваемся к принятому сервером состоянию за ~0,25 с
        this.correction = m.car;
        this.corrections.push(m.reason);
        this.correctionSteps = 15;
        break;
      case Msg.RaceEvent:
        if (m.event === RaceEventType.Overtake && m.playerId === this.myId) {
          const v = this.player.vehicle;
          v.addNitro(v.cfg.nitro.chargePerOvertake);
          this.onEvent({ type: 'overtake', racer: 'player', step: m.step });
        }
        if (m.event === RaceEventType.Dnf && m.playerId === this.myId) {
          this.onEvent({ type: 'finish', racer: 'player', step: m.step });
        }
        break;
      case Msg.Results:
        this.done = true;
        this.onResults(this.toResults(m.rows));
        break;
    }
  }

  private toResults(
    rows: {
      id: number;
      name: string;
      position: number;
      finishSteps: number;
      bestLapSteps: number;
      bot: boolean;
    }[],
  ): RaceResults {
    return {
      setup: this.setup,
      rows: rows.map((r) => ({
        id: String(r.id),
        name: r.bot ? `${r.name} (бот)` : r.name,
        position: r.position,
        time: r.finishSteps / 60,
        bestLap: r.bestLapSteps / 60,
        finished: r.finishSteps > 0,
        isPlayer: r.id === this.myId,
      })),
      bestLap: this.playerState().bestLapSteps / 60,
    };
  }

  /** После каждого шага физики: отправка состояния, тени чужих машин, коррекция. */
  private netStep(): void {
    const v = this.player.vehicle;
    const pos = v.position;
    // Сброс на трассу (локальный) — помечаем, чтобы сервер разрешил «телепорт»
    if (this.lastPos.distanceTo(new THREE.Vector3(pos.x, pos.y, pos.z)) > 5)
      this.resetPending = true;
    this.lastPos.set(pos.x, pos.y, pos.z);

    if (this.correction && this.correctionSteps > 0) {
      const c = this.correction;
      const k = 1 / this.correctionSteps;
      v.body.setTranslation(
        {
          x: pos.x + (c.x - pos.x) * k,
          y: pos.y + (c.y - pos.y) * k,
          z: pos.z + (c.z - pos.z) * k,
        },
        true,
      );
      v.body.setLinvel({ x: c.vx, y: c.vy, z: c.vz }, true);
      this.correctionSteps--;
      if (this.correctionSteps === 0) this.correction = null;
      const np = v.position;
      this.lastPos.set(np.x, np.y, np.z);
    }

    const step = this.tracker.step;
    // Тени чужих машин — по интерполированному состоянию
    if (this.clock.ready) {
      const s = this.clock.step(performance.now()) - INTERP_DELAY_STEPS;
      for (const r of this.remotes.values()) {
        const st = r.buf.sample(s);
        if (st)
          this.session.sim.moveProxy(
            r.proxy,
            { x: st.x, y: st.y, z: st.z },
            { x: st.qx, y: st.qy, z: st.qz, w: st.qw },
          );
      }
    }

    if (step % 2 === 0) {
      const q = v.rotation;
      const lv = v.body.linvel();
      const t = v.telemetry();
      const inp = this.player.input;
      let flags = 0;
      if (inp.brake > 0.1) flags |= CarFlags.Brake;
      if (t.nitroActive) flags |= CarFlags.Nitro;
      if (inp.handbrake > 0.5) flags |= CarFlags.Handbrake;
      if (this.resetPending) flags |= CarFlags.Reset;
      if (this.playerState().finished) flags |= CarFlags.Finished;
      this.resetPending = false;
      this.net.send({
        type: Msg.State,
        step,
        seq: ++this.seq,
        car: {
          x: pos.x,
          y: pos.y,
          z: pos.z,
          qx: q.x,
          qy: q.y,
          qz: q.z,
          qw: q.w,
          vx: lv.x,
          vy: lv.y,
          vz: lv.z,
          steer: inp.steer,
          rpm: t.rpm,
          flags,
        },
      });
    }
    if (this.playerState().finished && !this.finishedLocal) this.finishedLocal = true;
  }

  override frame(dt: number, _alpha: number): void {
    if (!this.clock.ready) return;
    const me = this.player.vehicle.position;
    this.renderStep = this.clock.step(performance.now()) - INTERP_DELAY_STEPS;
    for (const r of this.remotes.values()) {
      const st = r.buf.sample(this.renderStep);
      if (!st) continue;
      r.view.root.position.set(st.x, st.y, st.z);
      r.view.root.quaternion.set(st.qx, st.qy, st.qz, st.qw);
      r.view.setBraking(!!(st.flags & CarFlags.Brake));
      r.view.setNitro(!!(st.flags & CarFlags.Nitro), performance.now() / 1000);
      // Колёса: поворот по рулю, вращение по скорости
      const cfg = r.view.cfg;
      const speed = Math.hypot(st.vx, st.vz);
      const maxSteer = (cfg.steering.maxAngleDeg * Math.PI) / 180;
      r.spin += (speed / cfg.wheels.radius) * dt;
      const spin = r.spin;
      // Звук: громкость по расстоянию до своей машины
      if (r.audio) {
        const d = Math.hypot(st.x - me.x, st.z - me.z);
        r.audio.setVolume(Math.max(0, 1 - d / 80) * 0.4);
        r.audio.update(
          {
            rpm: st.rpm,
            throttle: st.flags & CarFlags.Brake ? 0 : 0.8,
            slip: 0,
            nitro: !!(st.flags & CarFlags.Nitro),
            speedKmh: speed * 3.6,
            wallHit: false,
            grounded: true,
          },
          dt,
        );
      }
      const w = cfg.wheels;
      for (let i = 0; i < 4; i++) {
        const front = i < 2,
          left = i % 2 === 0;
        r.view.setWheel(
          i,
          new THREE.Vector3(
            (left ? -1 : 1) * (w.track / 2),
            w.mountY,
            (front ? -1 : 1) * (w.wheelbase / 2),
          ),
          cfg.suspension.restLength * 0.8,
          front ? st.steer * maxSteer * 0.5 : 0,
          spin,
          left,
        );
      }
    }
  }

  override positionInfo(): { position: number; total: number } {
    const total = this.remotes.size + 1;
    return { position: this.serverPosition || super.positionInfo().position, total };
  }

  override extraDots(): { x: number; z: number; color: string }[] {
    return [...this.remotes.values()].map((r) => ({
      x: r.view.root.position.x,
      z: r.view.root.position.z,
      color: r.color,
    }));
  }

  override dispose(): void {
    if (!this.net.closed) this.net.close();
    for (const r of this.remotes.values()) r.audio?.dispose();
    super.dispose();
  }
}
