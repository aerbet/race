import { beforeAll, describe, expect, it } from 'vitest';
import {
  CARS,
  FixedStepLoop,
  computePI,
  piClass,
  InputPlayer,
  InputRecorder,
  RaceTracker,
  emptyInput,
  getTrack,
  quantizeInput,
  type InputFrame,
} from '@sr/shared';
import { initPhysics, type Rapier } from './rapier';
import { Sim } from './sim';
import { Bot, type BotLevel } from './bot';

let R: Rapier;
beforeAll(async () => {
  R = await initPhysics();
});

const track = getTrack('polygon');

interface LapResult {
  lapSteps: number;
  inputs: Uint8Array;
  final: { x: number; z: number };
  resets: number;
}

/**
 * Один круг полигона. driver — бот или воспроизведение; fps — частота «рендера»,
 * которая гоняет FixedStepLoop. Физика всегда 60 Гц.
 */
function lap(
  driver: 'bot' | Uint8Array,
  fps: number,
  level: BotLevel = 'hard',
  cfg = CARS.era2000_coupe!,
): LapResult {
  const sim = new Sim(R, track);
  const car = sim.addCar(cfg, 0);
  const race = new RaceTracker(track, 1, 0);
  const p0 = car.position;
  race.addRacer('p', p0.x, p0.z);
  const bot = new Bot(car, track, { level });
  const player = driver === 'bot' ? null : new InputPlayer(driver);
  const rec = new InputRecorder();
  let resets = 0;
  const loop = new FixedStepLoop(() => {
    const inp: InputFrame = quantizeInput(player ? player.next() : bot.think());
    rec.push(inp);
    if (car.needsReset) resets++;
    sim.tick([inp]);
    const p = car.position;
    const v = car.body.linvel();
    race.updateRacer('p', p.x, p.z, v.x, v.z);
    race.tick();
  });
  const maxFrames = fps * 240;
  for (let f = 0; f < maxFrames && race.phase !== 'finished'; f++) loop.advance(1 / fps);
  const r = race.racers.get('p')!;
  const p = car.position;
  sim.dispose();
  return {
    lapSteps: r.finished ? r.finishStep : -1,
    inputs: rec.toBytes(),
    final: { x: p.x, z: p.z },
    resets,
  };
}

describe('bot on polygon', { timeout: 60_000 }, () => {
  it('completes a lap without resets', () => {
    const r = lap('bot', 60);
    if (process.env.MEASURE) console.log('lap', r.lapSteps / 60, 'resets', r.resets);
    expect(r.lapSteps).toBeGreaterThan(0);
    expect(r.lapSteps / 60).toBeLessThan(150);
    expect(r.resets).toBe(0);
  });

  it('harder bots are faster', () => {
    const easy = lap('bot', 60, 'easy').lapSteps;
    const hard = lap('bot', 60, 'hard').lapSteps;
    expect(easy).toBeGreaterThan(0);
    expect(hard).toBeLessThan(easy);
  });
});

describe('balance by class (9.6)', { timeout: 300_000 }, () => {
  // По тесту на машину: длинный синхронный прогон всех машин подряд блокировал воркер
  // Vitest дольше минуты (на медленном CI — «Timeout calling onTaskUpdate»)
  const times = new Map<string, number[]>();
  it.each(Object.values(CARS).map((c) => [c.id, c] as const))(
    '%s: bot laps the polygon without resets',
    (_id, cfg) => {
      const r = lap('bot', 60, 'hard', cfg);
      const cls = piClass(computePI(cfg));
      if (process.env.MEASURE) console.log(cfg.id, cls, r.lapSteps / 60, 'resets', r.resets);
      expect(r.lapSteps, cfg.id).toBeGreaterThan(0);
      expect(r.resets, cfg.id).toBe(0);
      times.set(cls, [...(times.get(cls) ?? []), r.lapSteps / 60]);
    },
  );

  it('lap time drops with every class D → S', () => {
    const mean = (c: string) => times.get(c)!.reduce((a, b) => a + b, 0) / times.get(c)!.length;
    // Средний круг строго быстрее с каждым классом: D > C > B > A > S
    const order = ['D', 'C', 'B', 'A', 'S'].map(mean);
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeLessThan(order[i - 1]!);
  });
});

describe('determinism (1.7)', { timeout: 60_000 }, () => {
  it('same lap time at 30 / 60 / 144 render fps', () => {
    const a = lap('bot', 30);
    const b = lap('bot', 60);
    const c = lap('bot', 144);
    expect(a.lapSteps).toBeGreaterThan(0);
    // Требование плана — расхождение < 1 %; фиксированный шаг даёт точное совпадение
    expect(Math.abs(a.lapSteps - b.lapSteps) / b.lapSteps).toBeLessThan(0.01);
    expect(Math.abs(c.lapSteps - b.lapSteps) / b.lapSteps).toBeLessThan(0.01);
    expect(a.lapSteps).toBe(b.lapSteps);
    expect(c.lapSteps).toBe(b.lapSteps);
  });

  it('recorded input replays to the same finish', () => {
    const live = lap('bot', 60);
    const replay = lap(live.inputs, 144);
    expect(replay.lapSteps).toBe(live.lapSteps);
    expect(replay.final.x).toBeCloseTo(live.final.x, 6);
    expect(replay.final.z).toBeCloseTo(live.final.z, 6);
  });
});

describe('race tracker', { timeout: 60_000 }, () => {
  it('positions follow progress and 3 bots all finish', () => {
    const sim = new Sim(R, track);
    const race = new RaceTracker(track, 1, 0);
    const levels: BotLevel[] = ['hard', 'medium', 'easy'];
    const bots = levels.map((lv, i) => {
      const car = sim.addCar(CARS.era2026_hatch!, i);
      race.addRacer(lv, car.position.x, car.position.z);
      return new Bot(car, track, { level: lv, lane: (i % 2 ? 1 : -1) * 2 });
    });
    for (const b of bots) b.others = sim.cars;
    for (let s = 0; s < 60 * 300 && race.phase !== 'finished'; s++) {
      sim.tick(bots.map((b) => b.think()));
      bots.forEach((b, i) => {
        const p = b.car.position;
        const v = b.car.body.linvel();
        race.updateRacer(levels[i]!, p.x, p.z, v.x, v.z);
      });
      race.tick();
    }
    const st = race.standings();
    sim.dispose();
    expect(race.phase).toBe('finished');
    expect(st.every((r) => r.finished)).toBe(true);
    expect(new Set(st.map((r) => r.position)).size).toBe(3);
  });

  it('wrong way is detected when driving backwards', () => {
    const sim = new Sim(R, track);
    const car = sim.addCar(CARS.era2000_coupe!, 0);
    const race = new RaceTracker(track, 1, 0);
    race.addRacer('p', car.position.x, car.position.z);
    // Разворот на месте телепортом и разгон назад по трассе
    car.teleport({ x: car.position.x, y: 1, z: car.position.z }, car.yaw + Math.PI);
    let ww = false;
    for (let s = 0; s < 60 * 5; s++) {
      sim.tick([{ ...emptyInput(), throttle: 1 }]);
      const p = car.position;
      const v = car.body.linvel();
      race.updateRacer('p', p.x, p.z, v.x, v.z);
      race.tick();
      ww ||= race.racers.get('p')!.wrongWay;
    }
    sim.dispose();
    expect(ww).toBe(true);
  });
});

describe('sprint track', { timeout: 60_000 }, () => {
  it('bot finishes night_sprint without resets', () => {
    const t = getTrack('night_sprint');
    const sim = new Sim(R, t);
    const car = sim.addCar(CARS.era2026_hatch!, 0);
    const race = new RaceTracker(t, 1, 0);
    race.addRacer('p', car.position.x, car.position.z);
    const bot = new Bot(car, t, { level: 'medium' });
    let resets = 0;
    for (let s = 0; s < 60 * 200 && race.phase !== 'finished'; s++) {
      if (car.needsReset) resets++;
      sim.tick([bot.think()]);
      const p = car.position;
      const v = car.body.linvel();
      race.updateRacer('p', p.x, p.z, v.x, v.z);
      race.tick();
    }
    const r = race.racers.get('p')!;
    if (process.env.MEASURE)
      console.log(
        'sprint',
        r.finishStep / 60,
        'resets',
        resets,
        'cp',
        r.nextCp,
        '/',
        t.checkpoints.length,
        'pos',
        car.position,
        'progress',
        r.progress,
        'len',
        t.length,
      );
    sim.dispose();
    expect(r.finished).toBe(true);
    expect(resets).toBe(0);
  });
});

describe('mountain pass (elevation)', { timeout: 120_000 }, () => {
  it('bot climbs jp_touge to the finish without resets', () => {
    const t = getTrack('jp_touge');
    const sim = new Sim(R, t);
    const car = sim.addCar(CARS.era2000_coupe!, 0);
    const race = new RaceTracker(t, 1, 0);
    race.addRacer('p', car.position.x, car.position.z);
    const bot = new Bot(car, t, { level: 'medium' });
    let resets = 0;
    let maxY = -Infinity;
    for (let s = 0; s < 60 * 300 && race.phase !== 'finished'; s++) {
      if (car.needsReset) resets++;
      sim.tick([bot.think()]);
      const p = car.position;
      maxY = Math.max(maxY, p.y);
      const v = car.body.linvel();
      race.updateRacer('p', p.x, p.z, v.x, v.z);
      race.tick();
    }
    const r = race.racers.get('p')!;
    if (process.env.MEASURE)
      console.log(
        'touge',
        r.finishStep / 60,
        'resets',
        resets,
        'maxY',
        maxY,
        'cp',
        r.nextCp,
        t.checkpoints.length,
      );
    sim.dispose();
    expect(r.finished).toBe(true);
    expect(resets).toBe(0);
    expect(maxY).toBeGreaterThan(t.maxY - 10);
  });
});
