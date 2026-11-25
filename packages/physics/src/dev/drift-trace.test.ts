import { it } from 'vitest';
import { CARS, buildTrack, emptyInput, parseTrackDef } from '@sr/shared';
import { initPhysics } from '../rapier';
import { Sim } from '../sim';
import { driftBot } from './drift-bot';

it.skipIf(!process.env.MEASURE)('drift trace', async () => {
  const R = await initPhysics();
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
  const sim = new Sim(R, pad);
  const car = sim.addCar(CARS[process.env.CAR ?? 'era2000_coupe']!, 0);
  for (let i = 0; i < 60; i++) sim.tick([emptyInput()]);
  const rows: string[] = [];
  for (let i = 0; i < 60 * 10; i++) {
    const inp = driftBot(i);
    sim.tick([inp]);
    if (i % 12 === 0 && i > 230) {
      const t = car.telemetry();
      const w = car.body.angvel().y;
      rows.push(
        `${(i / 60).toFixed(1)} v=${t.speedKmh.toFixed(0)} beta=${t.slipAngleDeg.toFixed(1)} df=${t.driftFactor.toFixed(2)} g=${t.gear} yawR=${w.toFixed(2)} gr=${t.grounded} st=${inp.steer}`,
      );
    }
  }
  console.log(rows.join('\n'));
});
