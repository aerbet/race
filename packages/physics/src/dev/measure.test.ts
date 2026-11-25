import { it } from 'vitest';
import { CARS, emptyInput, parseTrackDef, buildTrack } from '@sr/shared';
import { initPhysics } from '../rapier';
import { Sim } from '../sim';

/** Замер характеристик машин: MEASURE=1 pnpm vitest run packages/physics/src/dev */
const strip = buildTrack(
  parseTrackDef({
    id: 'strip',
    name: 's',
    type: 'sprint',
    laps: 1,
    closed: false,
    defaultWidth: 30,
    checkpointSpacing: 200,
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

it.skipIf(!process.env.MEASURE)('measure', async () => {
  const R = await initPhysics();
  for (const cfg of Object.values(CARS)) {
    const sim = new Sim(R, strip);
    const car = sim.addCar(cfg);
    for (let i = 0; i < 90; i++) sim.tick([emptyInput()]);
    let t = 0;
    let t100 = 0;
    let top = 0;
    for (let i = 0; i < 60 * 60; i++) {
      sim.tick([{ ...emptyInput(), throttle: 1 }]);
      t += 1 / 60;
      const k = car.telemetry().speedKmh;
      if (!t100 && k >= 100) t100 = t;
      top = Math.max(top, k);
      if (car.position.z < -2400) break;
    }
    console.log(cfg.id, '0-100', t100.toFixed(2), 'top', top.toFixed(0), 'gear', car.gear);
    sim.dispose();
  }
});
