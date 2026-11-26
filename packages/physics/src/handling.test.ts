/**
 * Нормы управляемости (аркадная модель): обычный поворот — без заноса, занос — только по
 * желанию, ручник тормозит и не разворачивает машину поперёк. Для всех машин.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { CARS, emptyInput, getTrack, trackCoords } from '@sr/shared';
import { initPhysics, type Rapier } from './rapier';
import { run, sum } from './dev/handling-run';
import { Sim } from './sim';

let R: Rapier;
beforeAll(async () => {
  R = await initPhysics();
});

const stopAt = (log: { t: number; kmh: number }[]) => log.find((l) => l.kmh < 2)?.t ?? Infinity;

describe.each(Object.values(CARS))('управляемость $id', (cfg) => {
  it('поворот на 100 км/ч с газом: скольжение до 13°, выравнивание за 0,8 с, машина поворачивает', () => {
    const log = run(R, cfg, 100, (t) => ({ throttle: 1, key: t < 1 ? 1 : 0 }), 3);
    const s = sum(log);
    expect(s.peakSlip).toBeLessThanOrEqual(13);
    expect(s.slipSettledAt).toBeLessThanOrEqual(1.8);
    // Манёвр: траектория (а не только кузов) поворачивает быстро
    expect(s.path1s).toBeGreaterThanOrEqual(36);
    expect(Math.max(...log.map((l) => l.drift))).toBeLessThan(0.3); // не дрифт
  });

  it('манёвр на 180 км/ч: траектория за 1 с поворачивает ≥ 26°, без заноса', () => {
    const s = sum(run(R, cfg, 180, (t) => ({ throttle: 1, key: t < 1.2 ? 1 : 0 }), 2.5));
    expect(s.path1s).toBeGreaterThanOrEqual(26);
    expect(s.peakSlip).toBeLessThanOrEqual(13);
  });

  it('«змейка» на 120 км/ч без заноса', () => {
    const log = run(
      R,
      cfg,
      120,
      (t) => ({ throttle: 1, key: t < 0.5 ? 1 : t < 1 ? -1 : t < 1.5 ? 1 : 0 }),
      3.5,
    );
    expect(sum(log).peakSlip).toBeLessThanOrEqual(12);
  });

  it('сброс газа в повороте не срывает в занос (кроме дрифт-гонки)', () => {
    const lift = (t: number) => ({ throttle: t < 0.3 ? 1 : 0, key: t < 1.2 ? 1 : 0 });
    const normal = run(R, cfg, 90, lift, 2);
    expect(Math.max(...normal.map((l) => l.drift))).toBeLessThan(0.3);
    const drift = run(R, cfg, 90, lift, 2, { driftMode: true });
    expect(Math.max(...drift.map((l) => l.drift))).toBeGreaterThan(0.5);
  });

  it('выход из дрифта: руль прямо и газ — машина выравнивается за 0,9 с', () => {
    const log = run(
      R,
      cfg,
      100,
      (t) => ({ handbrake: t < 0.6 ? 1 : 0, throttle: t < 0.6 ? 0 : 0.8, key: t < 2 ? 1 : 0 }),
      4,
    );
    expect(Math.max(...log.filter((l) => l.t < 2).map((l) => Math.abs(l.slip)))).toBeGreaterThan(
      25,
    );
    const out = log.find((l) => l.t > 2 && Math.abs(l.slip) < 5 && l.drift < 0.2);
    expect(out && out.t - 2).toBeLessThanOrEqual(0.9);
  });

  it('ручник без руля: остановка со 100 км/ч до 3,2 с, по прямой', () => {
    const log = run(R, cfg, 100, () => ({ handbrake: 1 }), 6);
    expect(stopAt(log)).toBeLessThanOrEqual(3.2);
    expect(sum(log).peakSlip).toBeLessThanOrEqual(5);
  });

  it('ручник с рулём: занос до 55°, без разворота поперёк', () => {
    const log = run(R, cfg, 100, (t) => ({ handbrake: t < 1.5 ? 1 : 0, key: t < 0.8 ? 1 : 0 }), 4);
    const s = sum(log);
    expect(s.peakSlip).toBeGreaterThan(20); // занос есть
    expect(s.peakSlip).toBeLessThanOrEqual(55);
  });
});

describe('серпантин: с трассы не падают', { timeout: 120_000 }, () => {
  it('полный газ в отбойники (без руля и с рулём) — машина остаётся на дороге', () => {
    const t = getTrack('jp_touge');
    for (const steer of [0, 0.35, -0.35]) {
      const sim = new Sim(R, t);
      const car = sim.addCar(CARS.kaizen_rx34!, 0);
      for (let i = 0; i < 60 * 20; i++) {
        sim.tick([{ ...emptyInput(), throttle: 1, steer: i > 120 ? steer : 0 }]);
        const p = car.position;
        const c = trackCoords(t, p.x, p.z);
        const sm = t.samples[c.i]!;
        expect(p.y, `steer ${steer}, t ${i / 60}`).toBeGreaterThan(sm.y - 3);
      }
      sim.dispose();
    }
  });
});
