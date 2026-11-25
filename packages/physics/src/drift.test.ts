import { beforeAll, describe, expect, it } from 'vitest';
import {
  CARS,
  buildTrack,
  cloneCar,
  emptyInput,
  parseTrackDef,
  type CarConfig,
  type InputFrame,
} from '@sr/shared';
import { initPhysics, type Rapier } from './rapier';
import { Sim } from './sim';
import { driftBot } from './dev/drift-bot';

let R: Rapier;
beforeAll(async () => {
  R = await initPhysics();
});

// Пустая площадка; машина стартует в (0, 0) носом на −Z.
const pad = buildTrack(
  parseTrackDef({
    id: 'pad',
    name: 'pad',
    type: 'drift',
    laps: 1,
    closed: false,
    defaultWidth: 40,
    checkpointSpacing: 100,
    walls: false,
    wallOffset: 0,
    ramps: [],
    groundSize: 1200,
    startS: 30,
    points: [
      [0, 60],
      [0, 0],
      [0, -60],
    ],
  }),
);

export interface DriftRun {
  /** Углы заноса (°) на участке удержания дрифта. */
  angles: number[];
  spun: boolean;
  minSpeedKmh: number;
  /** Пройденный угол по кругу (рад). */
  swept: number;
}

export function runDrift(cfg: CarConfig, seconds = 18): DriftRun {
  const sim = new Sim(R, pad);
  const car = sim.addCar(cfg, 0);
  for (let i = 0; i < 60; i++) sim.tick([emptyInput()]);
  const angles: number[] = [];
  let spun = false;
  let minSpeed = Infinity;
  let prevYaw = car.yaw;
  let swept = 0;
  for (let i = 0; i < seconds * 60; i++) {
    sim.tick([driftBot(i)]);
    const tel = car.telemetry();
    const t = i / 60;
    if (t > 6) {
      angles.push(Math.abs(tel.slipAngleDeg));
      minSpeed = Math.min(minSpeed, tel.speedKmh);
      // Разворот: скорость направлена назад относительно носа
      if (tel.forwardSpeed < 0 || Math.abs(tel.slipAngleDeg) > 80) spun = true;
      let d = car.yaw - prevYaw;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      swept += d;
    }
    prevYaw = car.yaw;
  }
  sim.dispose();
  return { angles, spun, minSpeedKmh: minSpeed, swept };
}

export function withoutAssists(cfg: CarConfig): CarConfig {
  const c = cloneCar(cfg);
  for (const k of Object.keys(c.assists) as (keyof CarConfig['assists'])[])
    c.assists[k].enabled = false;
  return c;
}

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);

describe.each(Object.values(CARS))('drift circle $id', (cfg) => {
  it('holds a drift at 20–55° without spinning', () => {
    const r = runDrift(cfg);
    const avg = mean(r.angles);
    const sorted = [...r.angles].sort((a, b) => a - b);
    const p10 = sorted[Math.floor(sorted.length * 0.1)]!;
    const p90 = sorted[Math.floor(sorted.length * 0.9)]!;
    if (process.env.MEASURE)
      console.log(cfg.id, {
        avg,
        p10,
        p90,
        spun: r.spun,
        minSpeed: r.minSpeedKmh,
        laps: Math.abs(r.swept) / (2 * Math.PI),
      });
    expect(r.spun).toBe(false);
    expect(p10).toBeGreaterThanOrEqual(20);
    expect(p90).toBeLessThanOrEqual(55);
    // Машина реально едет по кругу, а не стоит боком
    expect(r.minSpeedKmh).toBeGreaterThan(30);
    expect(Math.abs(r.swept)).toBeGreaterThan(Math.PI * 2);
  });

  it('behaves noticeably differently without assists', () => {
    const a = runDrift(cfg);
    const b = runDrift(withoutAssists(cfg));
    if (process.env.MEASURE)
      console.log(cfg.id, 'no assists', {
        avg: mean(b.angles),
        spun: b.spun,
        minSpeed: b.minSpeedKmh,
      });
    const differs = b.spun || Math.abs(mean(a.angles) - mean(b.angles)) > 8;
    expect(differs).toBe(true);
  });
});

describe.each(Object.values(CARS))('drift exit $id', (cfg) => {
  it('recovers smoothly without snapping to the other side', () => {
    const sim = new Sim(R, pad);
    const car = sim.addCar(cfg, 0);
    for (let i = 0; i < 60; i++) sim.tick([emptyInput()]);
    let i = 0;
    for (; i < 60 * 8; i++) sim.tick([driftBot(i)]);
    // Отпускаем руль, газ на половину
    let maxOpposite = 0;
    let settledAt = -1;
    for (let k = 0; k < 60 * 4; k++) {
      sim.tick([{ ...emptyInput(), throttle: 0.5 }]);
      const b = car.telemetry().slipAngleDeg; // дрифт вправо → β < 0
      if (b > maxOpposite) maxOpposite = b;
      if (settledAt < 0 && Math.abs(b) < 5) settledAt = k / 60;
    }
    sim.dispose();
    expect(settledAt).toBeGreaterThanOrEqual(0);
    expect(settledAt).toBeLessThan(2.5);
    expect(maxOpposite).toBeLessThan(10);
  });
});
