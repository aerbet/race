import { describe, expect, it } from 'vitest';
import type { CarState } from '@sr/shared';
import { InterpBuffer, MAX_EXTRAP_STEPS, ServerClock } from './interp';

const car = (z: number, vz = -30): CarState => ({
  x: 0,
  y: 1,
  z,
  qx: 0,
  qy: 0,
  qz: 0,
  qw: 1,
  vx: 0,
  vy: 0,
  vz,
  steer: 0,
  rpm: 0,
  flags: 0,
});

describe('InterpBuffer', () => {
  it('interpolates between snapshots', () => {
    const b = new InterpBuffer();
    b.push(100, car(0));
    b.push(102, car(-1));
    expect(b.sample(101)!.z).toBeCloseTo(-0.5);
  });

  it('extrapolates by velocity, capped at 250 ms', () => {
    const b = new InterpBuffer();
    b.push(100, car(0, -30));
    expect(b.sample(106)!.z).toBeCloseTo(-3);
    expect(b.sample(1000)!.z).toBeCloseTo((-30 * MAX_EXTRAP_STEPS) / 60);
  });

  it('ignores out-of-order snapshots', () => {
    const b = new InterpBuffer();
    b.push(100, car(0));
    b.push(99, car(50));
    expect(b.latest!.step).toBe(100);
  });
});

describe('ServerClock', () => {
  it('tracks server step and never goes backwards under jitter', () => {
    const c = new ServerClock();
    let prev = 0;
    for (let i = 0; i < 300; i++) {
      const now = i * 33.3;
      const jitter = (i % 7) * 10;
      c.onSnapshot(Math.round(((now - 150 - jitter) / 1000) * 60) + 1000, now);
      const s = c.step(now);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
    // ≈ серверный шаг минус задержка
    expect(Math.abs(prev - (1000 + ((299 * 33.3 - 150) / 1000) * 60))).toBeLessThan(6);
  });
});
