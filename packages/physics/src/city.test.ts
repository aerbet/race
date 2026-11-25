import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { CARS, RaceTracker, buildTrack, parseCity } from '@sr/shared';
import { initPhysics, type Rapier } from './rapier';
import { Sim } from './sim';
import { Bot } from './bot';
import { CityColliders } from './city';

let R: Rapier;
beforeAll(async () => {
  R = await initPhysics();
});

const city = parseCity(
  JSON.parse(
    readFileSync(
      new URL('../../../apps/client/public/cities/moscow_synth/city.json', import.meta.url),
      'utf8',
    ),
  ),
);

describe('city tracks', { timeout: 120_000 }, () => {
  it('has 3 tracks (4.6)', () => {
    expect(city.tracks.map((t) => t.id)).toEqual(['msk_ring', 'msk_sprint', 'msk_drift']);
  });

  it.each(city.tracks.map((t) => [t.id, t] as const))(
    'bot finishes %s among buildings without resets',
    (_id, def) => {
      const track = buildTrack({ ...def, laps: 1 });
      const sim = new Sim(R, track);
      const car = sim.addCar(CARS.era2026_hatch!, 0);
      const cc = new CityColliders(city, sim);
      const race = new RaceTracker(track, 1, 0);
      race.addRacer('b', car.position.x, car.position.z);
      const bot = new Bot(car, track, { level: 'medium' });
      let resets = 0;
      let wallSteps = 0;
      for (let s = 0; s < 60 * 240 && race.phase !== 'finished'; s++) {
        if (s % 10 === 0) cc.update([car.position]);
        if (car.needsReset) resets++;
        sim.tick([bot.think()]);
        if (car.wallContact) wallSteps++;
        const p = car.position;
        const v = car.body.linvel();
        race.updateRacer('b', p.x, p.z, v.x, v.z);
        race.tick();
      }
      const r = race.racers.get('b')!;
      if (process.env.MEASURE)
        console.log(
          def.id,
          r.finishStep / 60,
          'resets',
          resets,
          'wall',
          wallSteps,
          'tiles',
          sim.tileKeys.length,
        );
      sim.dispose();
      expect(r.finished).toBe(true);
      expect(resets).toBe(0);
      expect(wallSteps).toBeLessThan(60);
    },
  );

  it('streaming keeps only nearby tiles loaded', () => {
    const track = buildTrack(city.tracks[0]!);
    const sim = new Sim(R, track);
    const cc = new CityColliders(city, sim);
    cc.update([{ x: 0, z: 0 }]);
    expect(sim.tileKeys.length).toBeLessThanOrEqual(9);
    cc.update([{ x: 600, z: 600 }]);
    expect(sim.tileKeys.every((k) => !['-1_-1', '0_0', '-1_0', '0_-1'].includes(k))).toBe(true);
    sim.dispose();
  });
});

const tokyo = parseCity(
  JSON.parse(
    readFileSync(
      new URL('../../../apps/client/public/cities/tokyo_synth/city.json', import.meta.url),
      'utf8',
    ),
  ),
);

describe('tokyo tracks', { timeout: 120_000 }, () => {
  it.each(tokyo.tracks.map((t) => [t.id, t] as const))(
    'bot finishes %s among buildings',
    (_id, def) => {
      const track = buildTrack({ ...def, laps: 1 });
      const sim = new Sim(R, track);
      const car = sim.addCar(CARS.era2026_hatch!, 0);
      const cc = new CityColliders(tokyo, sim);
      const race = new RaceTracker(track, 1, 0);
      race.addRacer('b', car.position.x, car.position.z);
      const bot = new Bot(car, track, { level: 'medium' });
      let resets = 0;
      let wallSteps = 0;
      for (let s = 0; s < 60 * 240 && race.phase !== 'finished'; s++) {
        if (s % 10 === 0) cc.update([car.position]);
        if (car.needsReset) resets++;
        sim.tick([bot.think()]);
        if (car.wallContact) wallSteps++;
        const p = car.position;
        const v = car.body.linvel();
        race.updateRacer('b', p.x, p.z, v.x, v.z);
        race.tick();
      }
      const r = race.racers.get('b')!;
      if (process.env.MEASURE)
        console.log(
          def.id,
          r.finishStep / 60,
          'resets',
          resets,
          'wall',
          wallSteps,
          'pos',
          car.position,
          'cp',
          r.nextCp,
          'grid',
          track.grid[0],
        );
      sim.dispose();
      expect(r.finished).toBe(true);
      expect(resets).toBe(0);
      expect(wallSteps).toBeLessThan(60);
    },
  );
});
