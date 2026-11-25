import { emptyInput, trackCoords, sampleAt, type BuiltTrack, type InputFrame } from '@sr/shared';
import type { Vehicle } from './vehicle';

export type BotLevel = 'easy' | 'medium' | 'hard';

const LEVELS: Record<BotLevel, { corner: number; brake: number; lookMul: number; nitro: boolean }> =
  {
    easy: { corner: 0.78, brake: 0.75, lookMul: 1.15, nitro: false },
    medium: { corner: 0.9, brake: 0.88, lookMul: 1.0, nitro: true },
    hard: { corner: 1.0, brake: 1.0, lookMul: 0.95, nitro: true },
  };

export interface BotOptions {
  level: BotLevel;
  /** Боковое смещение «своей» линии (м), чтобы боты не ехали гуськом. */
  lane?: number;
  /** Притяжение к лидеру — только для карьеры. */
  rubberBand?: boolean;
}

const G = 9.81;

/**
 * Бот: едет по гоночной линии из сплайна, тормозит перед поворотами по кривизне.
 * Детерминирован — зависит только от состояния машины и трассы.
 */
export class Bot {
  private hint = -1;
  private stuck = 0;
  private reverseT = 0;
  lane: number;
  readonly level: BotLevel;
  rubberBand: boolean;
  /** Отставание от лидера в метрах (заполняет гоночная логика, если rubberBand). */
  gapToLeader = 0;
  /** Другие машины — для объезда. */
  others: Vehicle[] = [];

  constructor(
    readonly car: Vehicle,
    readonly track: BuiltTrack,
    opts: BotOptions,
  ) {
    this.level = opts.level;
    this.lane = opts.lane ?? 0;
    this.rubberBand = !!opts.rubberBand;
  }

  /** Целевая скорость поворота для кривизны k. */
  private cornerSpeed(k: number, grip: number): number {
    const ak = Math.max(Math.abs(k), 1e-4);
    return Math.sqrt((grip * G) / ak);
  }

  think(): InputFrame {
    const L = LEVELS[this.level];
    const car = this.car;
    const p = car.position;
    const tel = car.telemetry();
    const v = Math.max(0, tel.forwardSpeed);
    const c = trackCoords(this.track, p.x, p.z, this.hint);
    this.hint = c.i;
    const f = emptyInput();

    // Выезд задом, если упёрлись
    if (this.reverseT > 0) {
      this.reverseT -= 1 / 60;
      f.brake = 1;
      const sm = this.track.samples[c.i]!;
      const fw = car.forward();
      const cross = fw.x * sm.tz - fw.z * sm.tx;
      f.steer = cross > 0 ? 1 : -1;
      return f;
    }
    if (v < 1.5) this.stuck += 1 / 60;
    else this.stuck = 0;
    if (this.stuck > 1.5) {
      this.stuck = 0;
      this.reverseT = 1.2;
    }

    // Линия: смещение к внутренней стороне поворотов + своя полоса
    const look = (5 + v * 0.55) * L.lookMul;
    const ahead = sampleAt(this.track, c.s + look);
    const far = sampleAt(this.track, c.s + look + 25);
    const inside = -Math.sign(far.k) * Math.min(1, Math.abs(far.k) * 40) * (ahead.width * 0.22);
    let offset = this.lane + inside;
    // Объезд машины впереди
    for (const o of this.others) {
      if (o === car) continue;
      const op = o.position;
      const oc = trackCoords(this.track, op.x, op.z);
      let ds = oc.s - c.s;
      if (this.track.def.closed) {
        if (ds < -this.track.length / 2) ds += this.track.length;
        if (ds > this.track.length / 2) ds -= this.track.length;
      }
      if (ds > 0 && ds < 14 && Math.abs(oc.lateral - offset) < 2.4) {
        offset = oc.lateral + (oc.lateral > 0 ? -3.2 : 3.2);
      }
    }
    const maxOff = ahead.width / 2 - 1.5;
    offset = Math.max(-maxOff, Math.min(maxOff, offset));
    const tx = ahead.x - ahead.tz * offset;
    const tz = ahead.z + ahead.tx * offset;

    // Руль: угол на цель в системе машины
    const fw = car.forward();
    const dx = tx - p.x,
      dz = tz - p.z;
    const ang = Math.atan2(fw.x * dz - fw.z * dx, fw.x * dx + fw.z * dz);
    // ang > 0 — цель справа (в системе с осью Y вверх и «вперёд» = −Z)
    f.steer = Math.max(-1, Math.min(1, ang * 2.2));

    // Скорость: смотрим вперёд на дистанцию торможения
    const grip = 1.05 * L.corner;
    const decel = 7.5 * L.brake;
    let target = 90;
    const horizon = (v * v) / (2 * decel) + 40;
    for (let d = 0; d < horizon; d += 4) {
      const sm = sampleAt(this.track, c.s + d);
      const vc = this.cornerSpeed(sm.k, grip);
      const allowed = Math.sqrt(vc * vc + 2 * decel * Math.max(0, d - 6));
      if (allowed < target) target = allowed;
    }
    if (this.rubberBand) target *= 1 + Math.max(-0.08, Math.min(0.12, this.gapToLeader / 400));

    const err = target - v;
    if (err > 1) {
      f.throttle = Math.min(1, 0.4 + err * 0.15);
    } else if (err < -2) {
      f.brake = Math.min(1, -err * 0.12);
    } else {
      f.throttle = 0.35;
    }
    // Нитро на прямых
    if (L.nitro && err > 15 && Math.abs(f.steer) < 0.15 && car.nitro > 0.3) f.nitro = 1;
    return f;
  }
}
