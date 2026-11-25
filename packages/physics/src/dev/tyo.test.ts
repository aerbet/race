import { readFileSync } from 'node:fs';
import { it } from 'vitest';
import { CARS, RaceTracker, buildTrack, parseCity } from '@sr/shared';
import { initPhysics } from '../rapier';
import { Sim } from '../sim';
import { Bot } from '../bot';
import { CityColliders } from '../city';

it.skipIf(!process.env.MEASURE)('trace tyo_sprint', async () => {
  const R = await initPhysics();
  const city = parseCity(
    JSON.parse(
      readFileSync(
        new URL('../../../../apps/client/public/cities/tokyo_synth/city.json', import.meta.url),
        'utf8',
      ),
    ),
  );
  const def = city.tracks.find((t) => t.id === 'tyo_sprint')!;
  const track = buildTrack(def);
  console.log(
    'points',
    JSON.stringify(def.points),
    'len',
    track.length,
    'cps',
    track.checkpoints.length,
  );
  const sim = new Sim(R, track);
  const car = sim.addCar(CARS.era2026_hatch!, 0);
  const cc = new CityColliders(city, sim);
  const race = new RaceTracker(track, 1, 0);
  race.addRacer('b', car.position.x, car.position.z);
  const bot = new Bot(car, track, { level: 'medium' });
  for (let s = 0; s < 60 * 60; s++) {
    if (s % 10 === 0) cc.update([car.position]);
    sim.tick([bot.think()]);
    const p = car.position;
    const v = car.body.linvel();
    race.updateRacer('b', p.x, p.z, v.x, v.z);
    race.tick();
    if (s % 120 === 0)
      console.log(
        (s / 60).toFixed(0),
        p.x.toFixed(0),
        p.z.toFixed(0),
        'v',
        car.telemetry().speedKmh.toFixed(0),
        'cp',
        race.racers.get('b')!.nextCp,
        'wall',
        car.wallContact,
      );
  }
});
