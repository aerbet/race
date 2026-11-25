import type { CarState } from '@sr/shared';

interface Sample {
  step: number;
  car: CarState;
}

/** Задержка интерполяции чужих машин: 100 мс = 6 шагов. */
export const INTERP_DELAY_STEPS = 6;
/** Экстраполяция при потере пакетов — не дальше 250 мс. */
export const MAX_EXTRAP_STEPS = 15;

/**
 * Буфер снимков одной чужой машины: интерполяция с задержкой 100 мс,
 * экстраполяция по скорости, если новых данных нет.
 */
export class InterpBuffer {
  private buf: Sample[] = [];

  push(step: number, car: CarState): void {
    const last = this.buf[this.buf.length - 1];
    if (last && step <= last.step) return;
    this.buf.push({ step, car });
    if (this.buf.length > 40) this.buf.shift();
  }

  get latest(): Sample | undefined {
    return this.buf[this.buf.length - 1];
  }

  /** Состояние на (дробный) серверный шаг. */
  sample(step: number): CarState | null {
    const b = this.buf;
    if (b.length === 0) return null;
    if (step <= b[0]!.step) return b[0]!.car;
    for (let i = b.length - 1; i > 0; i--) {
      const a = b[i - 1]!,
        c = b[i]!;
      if (step >= a.step && step <= c.step)
        return lerpCar(a.car, c.car, (step - a.step) / (c.step - a.step));
    }
    // Новее последнего снимка — экстраполяция
    const last = b[b.length - 1]!;
    const ds = Math.min(step - last.step, MAX_EXTRAP_STEPS) / 60;
    return {
      ...last.car,
      x: last.car.x + last.car.vx * ds,
      y: last.car.y + last.car.vy * ds,
      z: last.car.z + last.car.vz * ds,
    };
  }
}

function nlerp(a: CarState, b: CarState, t: number): [number, number, number, number] {
  // Кратчайший путь
  const d = a.qx * b.qx + a.qy * b.qy + a.qz * b.qz + a.qw * b.qw;
  const s = d < 0 ? -1 : 1;
  const x = a.qx + (b.qx * s - a.qx) * t;
  const y = a.qy + (b.qy * s - a.qy) * t;
  const z = a.qz + (b.qz * s - a.qz) * t;
  const w = a.qw + (b.qw * s - a.qw) * t;
  const l = Math.hypot(x, y, z, w) || 1;
  return [x / l, y / l, z / l, w / l];
}

export function lerpCar(a: CarState, b: CarState, t: number): CarState {
  const l = (p: number, q: number) => p + (q - p) * t;
  const [qx, qy, qz, qw] = nlerp(a, b, t);
  return {
    x: l(a.x, b.x),
    y: l(a.y, b.y),
    z: l(a.z, b.z),
    qx,
    qy,
    qz,
    qw,
    vx: l(a.vx, b.vx),
    vy: l(a.vy, b.vy),
    vz: l(a.vz, b.vz),
    steer: l(a.steer, b.steer),
    rpm: l(a.rpm, b.rpm),
    flags: t < 0.5 ? a.flags : b.flags,
  };
}

/**
 * Оценка серверного шага по времени клиента: сглаженное смещение
 * «шаг из снимка − локальное время». Не убегает назад.
 */
export class ServerClock {
  private offset = NaN;
  private lastEstimate = 0;

  onSnapshot(serverStep: number, nowMs: number): void {
    const o = serverStep - (nowMs / 1000) * 60;
    if (Number.isNaN(this.offset)) this.offset = o;
    // Быстро догоняем вперёд, медленно — назад (джиттер)
    else if (o > this.offset) this.offset += (o - this.offset) * 0.2;
    else this.offset += (o - this.offset) * 0.02;
  }

  get ready(): boolean {
    return !Number.isNaN(this.offset);
  }

  step(nowMs: number): number {
    const e = (nowMs / 1000) * 60 + this.offset;
    this.lastEstimate = Math.max(this.lastEstimate, e);
    return this.lastEstimate;
  }
}
