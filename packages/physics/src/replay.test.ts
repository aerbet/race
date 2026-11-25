import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CARS,
  COUNTDOWN_STEPS,
  FixedStepLoop,
  InputRecorder,
  RaceTracker,
  WEATHER_GRIP,
  applyTuning,
  buildTrack,
  emptyInput,
  getTrack,
  parseCity,
  type BuiltTrack,
  type CarConfig,
  type City,
} from '@sr/shared';
import { initPhysics, type Rapier } from './rapier';
import { Sim } from './sim';
import { Bot } from './bot';
import { CityColliders } from './city';
import { replayRun } from './replay';

let R: Rapier;
beforeAll(async () => {
  R = await initPhysics();
});

/** Клиентская сессия «на время» в том же порядке, что apps/client Session + RaceController. */
function clientRun(
  track: BuiltTrack,
  car: CarConfig,
  laps: number,
  grip: number,
  city: City | null,
  fps: number,
) {
  const sim = new Sim(R, track);
  const v = sim.addCar(car, 0);
  v.surfaceGrip = grip;
  const cc = city ? new CityColliders(city, sim) : null;
  const race = new RaceTracker(track, laps);
  race.addRacer('p', v.position.x, v.position.z);
  const bot = new Bot(v, track, { level: 'hard' });
  const rec = new InputRecorder();
  const loop = new FixedStepLoop((_dt, step) => {
    const inp = race.phase === 'countdown' ? { ...emptyInput(), handbrake: 1 } : bot.think();
    rec.push(inp);
    if (cc && step % 10 === 0) cc.update([v.position]);
    sim.tick([inp]);
    const p = v.position;
    const lv = v.body.linvel();
    race.updateRacer('p', p.x, p.z, lv.x, lv.z);
    race.tick();
  });
  for (let f = 0; f < fps * 300 && !race.racers.get('p')!.finished; f++) loop.advance(1 / fps);
  const r = race.racers.get('p')!;
  sim.dispose();
  return { inputs: rec.toBytes(), finishSteps: r.finishStep, best: r.bestLapSteps };
}

describe('replay verification', { timeout: 120_000 }, () => {
  it('polygon: replay of a client recording gives the same time', () => {
    const track = getTrack('polygon');
    const c = clientRun(track, CARS.era2000_coupe!, 1, 1, null, 75);
    expect(c.finishSteps).toBeGreaterThan(COUNTDOWN_STEPS);
    const r = replayRun(R, { track, car: CARS.era2000_coupe!, inputs: c.inputs, laps: 1 });
    expect(r.finished).toBe(true);
    expect(r.finishSteps).toBe(c.finishSteps);
    expect(r.bestLapSteps).toBe(c.best);
  });

  it('city track with tuning and snow: identical time', () => {
    const city = parseCity(
      JSON.parse(
        readFileSync(
          new URL('../../../apps/client/public/cities/moscow_synth/city.json', import.meta.url),
          'utf8',
        ),
      ),
    );
    const track = buildTrack(city.tracks.find((t) => t.id === 'msk_ring')!);
    const car = applyTuning(CARS.era2026_hatch!, { engine: 3, tires: 2 });
    const c = clientRun(track, car, 1, WEATHER_GRIP.snow, city, 60);
    const r = replayRun(R, {
      track,
      car,
      inputs: c.inputs,
      laps: 1,
      surfaceGrip: WEATHER_GRIP.snow,
      city,
    });
    expect(r.finishSteps).toBe(c.finishSteps);
  });

  it('a forged claim does not reproduce: other car or truncated input', () => {
    const track = getTrack('polygon');
    const c = clientRun(track, CARS.era2000_coupe!, 1, 1, null, 60);
    // Та же запись на другой машине — другое время
    const other = replayRun(R, {
      track,
      car: applyTuning(CARS.era2000_coupe!, { engine: 4, turbo: 4 }),
      inputs: c.inputs,
      laps: 1,
    });
    expect(other.finishSteps).not.toBe(c.finishSteps);
    // Обрезанная запись — финиша нет
    const cut = replayRun(R, {
      track,
      car: CARS.era2000_coupe!,
      inputs: c.inputs.slice(0, c.inputs.length / 2),
      laps: 1,
    });
    expect(cut.finished).toBe(false);
  });
});
