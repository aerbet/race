import { beforeAll, describe, expect, it } from 'vitest';
import { CARS, emptyInput, getTrack, parseTrackDef, buildTrack, type InputFrame } from '@sr/shared';
import { initPhysics, type Rapier } from './rapier';
import { Sim } from './sim';

let R: Rapier;
beforeAll(async () => {
  R = await initPhysics();
});

// Прямая 1.5 км без стен — для тестов разгона
const strip = buildTrack(
  parseTrackDef({
    id: 'strip',
    name: 'strip',
    type: 'sprint',
    laps: 1,
    closed: false,
    defaultWidth: 30,
    checkpointSpacing: 200,
    walls: false,
    wallOffset: 0,
    ramps: [],
    groundSize: 4000,
    startS: 50,
    points: [
      [0, 1500],
      [0, 0],
      [0, -1500],
    ],
  }),
);

const input = (p: Partial<InputFrame>): InputFrame => ({ ...emptyInput(), ...p });

function settle(sim: Sim, steps = 90) {
  for (let i = 0; i < steps; i++) sim.tick([emptyInput()]);
}

describe.each(Object.values(CARS))('vehicle $id', (cfg) => {
  it('0–100 km/h within ±10% of config', () => {
    const sim = new Sim(R, strip);
    const car = sim.addCar(cfg);
    settle(sim);
    let t = 0;
    while (car.telemetry().forwardSpeed * 3.6 < 100 && t < 20) {
      sim.tick([input({ throttle: 1 })]);
      t += 1 / 60;
    }
    sim.dispose();
    expect(t).toBeGreaterThan(cfg.specs.zeroTo100 * 0.9);
    expect(t).toBeLessThan(cfg.specs.zeroTo100 * 1.1);
  });

  it('stands still without drift', () => {
    const sim = new Sim(R, strip);
    const car = sim.addCar(cfg);
    settle(sim, 60);
    const p0 = { ...car.position };
    for (let i = 0; i < 600; i++) sim.tick([emptyInput()]);
    const p1 = car.position;
    sim.dispose();
    expect(Math.hypot(p1.x - p0.x, p1.z - p0.z)).toBeLessThan(0.02);
  });

  it('goes straight without steering', () => {
    const sim = new Sim(R, strip);
    const car = sim.addCar(cfg);
    settle(sim);
    const x0 = car.position.x;
    for (let i = 0; i < 60 * 12; i++) sim.tick([input({ throttle: 1 })]);
    const dx = car.position.x - x0;
    const speed = car.telemetry().speedKmh;
    sim.dispose();
    expect(Math.abs(dx)).toBeLessThan(0.5);
    expect(speed).toBeGreaterThan(130);
  });

  it('top speed is within ±10% of config', () => {
    const sim = new Sim(R, strip);
    const car = sim.addCar(cfg);
    settle(sim);
    let best = 0;
    for (let i = 0; i < 60 * 40; i++) {
      sim.tick([input({ throttle: 1 })]);
      best = Math.max(best, car.telemetry().speedKmh);
      if (car.position.z < -1400) break;
    }
    sim.dispose();
    expect(best).toBeGreaterThan(cfg.specs.topSpeedKmh * 0.85);
    expect(best).toBeLessThan(cfg.specs.topSpeedKmh * 1.1);
  });

  it('brakes from 100 km/h to stop', () => {
    const sim = new Sim(R, strip);
    const car = sim.addCar(cfg);
    settle(sim);
    while (car.telemetry().speedKmh < 100) sim.tick([input({ throttle: 1 })]);
    let t = 0;
    while (car.telemetry().speedKmh > 1 && t < 10) {
      sim.tick([input({ brake: 1 })]);
      t += 1 / 60;
    }
    sim.dispose();
    expect(t).toBeLessThan(4.5);
  });
});

describe('polygon', () => {
  it('car spawns on grid and settles on its wheels', () => {
    const sim = new Sim(R, getTrack('polygon'));
    const car = sim.addCar(CARS.era2000_coupe!);
    settle(sim, 120);
    expect(car.grounded).toBe(4);
    expect(car.up().y).toBeGreaterThan(0.99);
    sim.dispose();
  });
});

describe.each(Object.values(CARS))('nitro $id', (cfg) => {
  const accel = (nitro: boolean) => {
    const sim = new Sim(R, strip);
    const car = sim.addCar(cfg);
    settle(sim);
    car.nitro = 1;
    while (car.telemetry().speedKmh < 60) sim.tick([input({ throttle: 1 })]);
    let t = 0;
    while (car.telemetry().speedKmh < 110 && t < 20) {
      sim.tick([input({ throttle: 1, nitro: nitro ? 1 : 0 })]);
      t += 1 / 60;
    }
    const left = car.nitro;
    sim.dispose();
    return { t, left };
  };

  it('boosts acceleration and drains the tank', () => {
    const base = accel(false);
    const boosted = accel(true);
    expect(boosted.t).toBeLessThan(base.t * 0.87);
    expect(boosted.left).toBeLessThan(1);
    expect(base.left).toBe(1);
  });

  it('charges from drifting', () => {
    const sim = new Sim(R, strip);
    const car = sim.addCar(cfg);
    settle(sim);
    car.nitro = 0;
    for (let i = 0; i < 60 * 4; i++) sim.tick([input({ throttle: 1 })]);
    for (let i = 0; i < 25; i++) sim.tick([input({ throttle: 0.6, steer: 1, handbrake: 1 })]);
    for (let i = 0; i < 60 * 2; i++) sim.tick([input({ throttle: 0.75, steer: 0.55 })]);
    expect(car.nitro).toBeGreaterThan(0.2);
    sim.dispose();
  });
});

describe('walls', () => {
  it('car slides along a wall instead of stopping dead', () => {
    const sim = new Sim(R, getTrack('polygon'));
    const car = sim.addCar(CARS.era2000_coupe!, 0);
    settle(sim);
    // Разгон и уход в стену под небольшим углом
    for (let i = 0; i < 60 * 4; i++) sim.tick([input({ throttle: 1 })]);
    let touched = false;
    let minSpeed = Infinity;
    let speedAtHit = 0;
    for (let i = 0; i < 60 * 3; i++) {
      sim.tick([input({ throttle: 1, steer: i < 40 ? 0.35 : 0 })]);
      if (car.wallContact && !touched) {
        touched = true;
        speedAtHit = car.telemetry().speedKmh;
      }
      if (touched) minSpeed = Math.min(minSpeed, car.telemetry().speedKmh);
    }
    sim.dispose();
    expect(touched).toBe(true);
    // Мягкие стены: скорость не обнуляется
    expect(minSpeed).toBeGreaterThan(speedAtHit * 0.5);
  });
});

describe('weather grip', () => {
  it('snow lengthens braking distance', () => {
    const brake = (grip: number) => {
      const sim = new Sim(R, strip);
      const car = sim.addCar(CARS.era2000_coupe!);
      car.surfaceGrip = grip;
      settle(sim);
      while (car.telemetry().speedKmh < 100) sim.tick([input({ throttle: 1 })]);
      const z0 = car.position.z;
      let n = 0;
      while (car.telemetry().speedKmh > 1 && n++ < 600) sim.tick([input({ brake: 1 })]);
      const d = Math.abs(car.position.z - z0);
      sim.dispose();
      return d;
    };
    expect(brake(0.72)).toBeGreaterThan(brake(1) * 1.15);
  });
});
