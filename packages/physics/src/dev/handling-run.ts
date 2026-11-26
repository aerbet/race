/**
 * Тестовые заезды для управляемости: разгон по прямой, затем сценарий ввода (руль — как с
 * клавиатуры, со скоростью набора из конфига). Используют handling.test.ts и замеры MEASURE=1.
 */
import { buildTrack, emptyInput, parseTrackDef, type CarConfig, type InputFrame } from '@sr/shared';
import type { Rapier } from '../rapier';
import { Sim } from '../sim';
import type { VehicleOptions } from '../vehicle';

export type Step = {
  t: number;
  kmh: number;
  slip: number;
  yaw: number;
  x: number;
  head: number;
  /** Направление скорости (траектории), °. */
  path: number;
  drift: number;
};

const pad = buildTrack(
  parseTrackDef({
    id: 'pad',
    name: 'pad',
    type: 'sprint',
    laps: 1,
    closed: false,
    defaultWidth: 60,
    checkpointSpacing: 300,
    walls: false,
    wallOffset: 0,
    ramps: [],
    groundSize: 6000,
    startS: 50,
    points: [
      [0, 2500],
      [0, 0],
      [0, -2500],
    ],
  }),
);

/** Клавиатура как в клиенте: руль доводится со скоростью rate, возврат — returnRate. */
export function keyboardSteer(cfg: CarConfig) {
  let s = 0;
  return (target: number, dt: number) => {
    const rate =
      target !== 0 && Math.sign(target) === Math.sign(s || target)
        ? cfg.steering.keyboardRate
        : cfg.steering.keyboardReturnRate;
    s += Math.sign(target - s) * Math.min(Math.abs(target - s), rate * dt);
    return s;
  };
}

export function run(
  R: Rapier,
  cfg: CarConfig,
  toKmh: number,
  script: (t: number) => Partial<InputFrame> & { key?: number },
  seconds: number,
  opts: VehicleOptions = {},
): Step[] {
  const sim = new Sim(R, pad);
  const car = sim.addCar(cfg, 0, opts);
  for (let i = 0; i < 60; i++) sim.tick([emptyInput()]);
  while (car.telemetry().speedKmh < toKmh) sim.tick([{ ...emptyInput(), throttle: 1 }]);
  const steer = keyboardSteer(cfg);
  const log: Step[] = [];
  for (let i = 0; i < seconds * 60; i++) {
    const t = i / 60;
    const s = script(t);
    const inp = { ...emptyInput(), ...s, steer: steer(s.key ?? 0, 1 / 60) };
    sim.tick([inp]);
    const tel = car.telemetry();
    log.push({
      t,
      kmh: tel.speedKmh,
      slip: tel.slipAngleDeg,
      yaw: car.body.angvel().y,
      x: car.position.x,
      head: (car.yaw * 180) / Math.PI,
      path: (Math.atan2(-car.body.linvel().x, -car.body.linvel().z) * 180) / Math.PI,
      drift: tel.driftFactor,
    });
  }
  sim.dispose();
  return log;
}

const wrap = (d: number) => (d > 180 ? d - 360 : d < -180 ? d + 360 : d);

export const sum = (log: Step[]) => {
  const peak = Math.max(...log.map((l) => Math.abs(l.slip)));
  let flips = 0;
  for (let i = 1; i < log.length; i++)
    if (Math.abs(log[i]!.slip) > 3 && Math.sign(log[i]!.slip) !== Math.sign(log[i - 1]!.slip))
      flips++;
  const settle = [...log].reverse().find((l) => Math.abs(l.slip) > 4)?.t ?? 0;
  // Поворот за первую секунду (°) и среднее боковое ускорение (g) — отзывчивость
  let d = log[59]!.head - log[0]!.head;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  const v = (log[0]!.kmh + log[59]!.kmh) / 2 / 3.6;
  const latG = (Math.abs((d * Math.PI) / 180) * v) / 9.81;
  return {
    peakSlip: +peak.toFixed(1),
    slipFlips: flips,
    slipSettledAt: +settle.toFixed(2),
    turned1s: +Math.abs(d).toFixed(0),
    /** Поворот траектории за 1 с, °. */
    path1s: +Math.abs(wrap(log[59]!.path - log[0]!.path)).toFixed(0),
    latG: +latG.toFixed(2),
  };
};
