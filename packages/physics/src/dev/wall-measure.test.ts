/** Замер (MEASURE=1): удерживают ли отбойники серпантина машину при ударе. */
import { beforeAll, describe, it } from 'vitest';
import { CARS, emptyInput, getTrack, trackCoords } from '@sr/shared';
import { initPhysics, type Rapier } from '../rapier';
import { Sim } from '../sim';

let R: Rapier;
beforeAll(async () => {
  R = await initPhysics();
});

describe.skipIf(!process.env.MEASURE)('отбойники серпантина', () => {
  it('удар в отбойник на скорости', { timeout: 120_000 }, () => {
    const t = getTrack('jp_touge');
    for (const steer of [0, 0.3, -0.3]) {
      const sim = new Sim(R, t);
      const car = sim.addCar(CARS.kaizen_rx34!, 0);
      let fell = -1;
      let maxOff = 0;
      for (let i = 0; i < 60 * 25; i++) {
        sim.tick([{ ...emptyInput(), throttle: 1, steer: i > 120 ? steer : 0 }]);
        const p = car.position;
        const c = trackCoords(t, p.x, p.z);
        const S = t.samples[Math.min(t.samples.length - 1, Math.max(0, Math.round(c.s / 2)))]!;
        const off = Math.abs(c.lateral) - S.width / 2;
        if (off > 2.6 && maxOff <= 2.6)
          console.log(
            'CROSS',
            JSON.stringify({
              steer,
              t: +(i / 60).toFixed(2),
              s: Math.round(c.s),
              off: +off.toFixed(1),
              y: +p.y.toFixed(2),
              roadY: +S.y.toFixed(2),
              kmh: Math.round(car.telemetry().speedKmh),
              k: +S.k.toFixed(3),
            }),
          );
        maxOff = Math.max(maxOff, off);
        if (p.y < S.y - 4 && fell < 0) {
          fell = i / 60;
          console.log(
            'FALL',
            JSON.stringify({
              steer,
              t: fell,
              s: Math.round(c.s),
              lateral: +c.lateral.toFixed(1),
              halfW: S.width / 2,
              y: +p.y.toFixed(1),
              roadY: +S.y.toFixed(1),
              kmh: Math.round(car.telemetry().speedKmh),
              upY: +car.telemetry().speedKmh.toFixed(0),
            }),
          );
        }
      }
      console.log(
        'WALL',
        JSON.stringify({ steer, fellAt: fell, maxOutsideRoad: +maxOff.toFixed(1) }),
      );
      sim.dispose();
    }
  });
});
