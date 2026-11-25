import { beforeAll, describe, expect, it } from 'vitest';
import { CARS, InputRecorder, RaceTracker, emptyInput, getTrack, toBase64 } from '@sr/shared';
import { Bot, Sim, initPhysics, type Rapier } from '@sr/physics';
import { verifyRun } from './verify';

let R: Rapier;
beforeAll(async () => {
  R = await initPhysics();
});

describe('verifyRun', { timeout: 60_000 }, () => {
  it('reproduces an honest run and rejects bad requests', () => {
    const track = getTrack('polygon');
    const sim = new Sim(R, track);
    const car = sim.addCar(CARS.era2000_coupe!, 0);
    const race = new RaceTracker(track, 1);
    race.addRacer('p', car.position.x, car.position.z);
    const bot = new Bot(car, track, { level: 'hard' });
    const rec = new InputRecorder();
    while (!race.racers.get('p')!.finished && race.step < 60 * 200) {
      const inp = race.phase === 'countdown' ? { ...emptyInput(), handbrake: 1 } : bot.think();
      rec.push(inp);
      sim.tick([inp]);
      const p = car.position;
      const v = car.body.linvel();
      race.updateRacer('p', p.x, p.z, v.x, v.z);
      race.tick();
    }
    sim.dispose();
    const best = race.racers.get('p')!.bestLapSteps;
    const ok = verifyRun(R, new Map(), {
      trackId: 'polygon',
      carId: 'era2000_coupe',
      laps: 1,
      inputs: toBase64(rec.toBytes()),
    });
    expect(ok.ok).toBe(true);
    expect(ok.bestLapSteps).toBe(best);
    expect(
      verifyRun(R, new Map(), {
        trackId: 'nope',
        carId: 'era2000_coupe',
        laps: 1,
        inputs: 'AAAAAAAA',
      }).error,
    ).toBe('unknown_track');
    expect(
      verifyRun(R, new Map(), {
        trackId: 'polygon',
        carId: 'era2000_coupe',
        laps: 1,
        inputs: 'AAA',
      }).error,
    ).toBe('bad_inputs');
    expect(
      verifyRun(R, new Map(), {
        trackId: 'polygon',
        carId: 'era2000_coupe',
        laps: 1,
        parts: { engine: 9 },
        inputs: 'AAAAAAAA',
      }).error,
    ).toBe('bad_parts');
  });
});
