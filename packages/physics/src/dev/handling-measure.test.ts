/**
 * Замеры управляемости (MEASURE=1): торможение тормозом и ручником, вход в поворот с клавиатуры,
 * «змейка». Только печатает цифры — для анализа, ничего не проверяет.
 */
import { beforeAll, describe, it } from 'vitest';
import { CARS, type CarConfig } from '@sr/shared';
import { initPhysics, type Rapier } from '../rapier';
import { run as runWith, sum, type Step } from './handling-run';

const run = (...a: Parameters<typeof runWith> extends [Rapier, ...infer T] ? T : never) =>
  runWith(R, ...a);

let R: Rapier;
beforeAll(async () => {
  R = await initPhysics();
});

describe.skipIf(!process.env.MEASURE)('что вызывает занос в обычном повороте', () => {
  it('kaizen_rx34: поворот 1 с на 100 км/ч с газом', () => {
    const base = CARS.kaizen_rx34!;
    const variants: [string, (c: CarConfig) => void][] = [
      ['как есть', () => {}],
      ['без turnAssist', (c) => (c.assists.turnAssist.enabled = false)],
      ['без автосрыва (driftInit)', (c) => (c.assists.driftInit.enabled = false)],
      [
        'без обоих',
        (c) => {
          c.assists.turnAssist.enabled = false;
          c.assists.driftInit.enabled = false;
        },
      ],
    ];
    for (const [name, f] of variants) {
      const c = structuredClone(base);
      f(c);
      const log = run(c, 100, (t) => ({ throttle: 1, key: t < 1 ? 1 : 0 }), 4);
      const tl = [0.25, 0.5, 0.75, 1, 1.5, 2, 3].map((t) =>
        Math.round(log[Math.round(t * 60) - 1]!.slip),
      );
      console.log(
        'TURN',
        name,
        JSON.stringify({ ...sum(log), slipAt_0_25_0_5_0_75_1_1_5_2_3: tl }),
      );
    }
  });
});

describe.skipIf(!process.env.MEASURE)('выход из дрифта', () => {
  it('ручник+руль 0,6 с, держим занос до 2 с, затем руль прямо и газ', () => {
    for (const id of ['era2000_coupe', 'kaizen_rx34', 'voss_kleiner', 'falkner_heck']) {
      const log = run(
        CARS[id]!,
        100,
        (t) => ({ handbrake: t < 0.6 ? 1 : 0, throttle: t < 0.6 ? 0 : 0.8, key: t < 2 ? 1 : 0 }),
        5,
      );
      const peak = Math.max(...log.filter((l) => l.t < 2).map((l) => Math.abs(l.slip)));
      const out = log.find((l) => l.t > 2 && Math.abs(l.slip) < 5 && l.drift < 0.2);
      console.log(
        'EXIT',
        id,
        JSON.stringify({
          driftPeak: +peak.toFixed(0),
          exitS: out ? +(out.t - 2).toFixed(2) : null,
        }),
      );
    }
  });
});

describe.skipIf(!process.env.MEASURE)('манёвр на скорости', () => {
  it('поворот за 1 с полного руля', () => {
    for (const id of ['era2000_coupe', 'kaizen_rx34', 'voss_imperator', 'ferro_cuneo']) {
      const out: Record<string, unknown> = {};
      for (const v of [60, 100, 150, 200]) {
        const s = sum(run(CARS[id]!, v, (t) => ({ throttle: 1, key: t < 1.2 ? 1 : 0 }), 3));
        out[v] = `кузов ${s.turned1s}° путь ${s.path1s}° слип ${s.peakSlip}°`;
      }
      console.log('AGILITY', id, JSON.stringify(out));
    }
  });
});

describe.skipIf(!process.env.MEASURE)('замеры управляемости', () => {
  for (const id of ['era2000_coupe', 'kaizen_rx34', 'voss_kleiner', 'falkner_heck']) {
    it(id, () => {
      const cfg = CARS[id]!;
      const stop = (log: Step[]) => log.find((l) => l.kmh < 2)?.t ?? Infinity;
      const brake = run(cfg, 100, () => ({ brake: 1 }), 8);
      const hb = run(cfg, 100, () => ({ handbrake: 1 }), 12);
      const hbTurn = run(cfg, 100, (t) => ({ handbrake: 1, key: t < 0.6 ? 1 : 0 }), 12);
      // Поворот на газу: вправо 1 с, потом отпустить
      const turn = run(cfg, 100, (t) => ({ throttle: 1, key: t < 1 ? 1 : 0 }), 4);
      // Тот же поворот без газа
      const turnLift = run(cfg, 100, (t) => ({ throttle: t < 0.3 ? 1 : 0, key: t < 1 ? 1 : 0 }), 4);
      // Змейка: 0,5 с вправо, 0,5 влево, 0,5 вправо, газ
      const slalom = run(
        cfg,
        120,
        (t) => ({ throttle: 1, key: t < 0.5 ? 1 : t < 1 ? -1 : t < 1.5 ? 1 : 0 }),
        4,
      );
      // Резкий поворот на 150 км/ч
      const fast = run(cfg, 150, (t) => ({ throttle: 1, key: t < 0.8 ? 1 : 0 }), 4);
      console.log(
        id,
        JSON.stringify({
          brake100: { stopS: +stop(brake).toFixed(2) },
          handbrake100: { stopS: +stop(hb).toFixed(2), ...sum(hb) },
          handbrakeWithSteer: { stopS: +stop(hbTurn).toFixed(2), ...sum(hbTurn) },
          turnOnThrottle: sum(turn),
          turnLift: sum(turnLift),
          slalom120: sum(slalom),
          turn150: sum(fast),
        }),
      );
    });
  }
});
