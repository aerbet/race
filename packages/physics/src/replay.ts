import {
  COUNTDOWN_STEPS,
  InputRecorder,
  RaceTracker,
  type BuiltTrack,
  type CarConfig,
  type City,
} from '@sr/shared';
import type { Rapier } from './rapier';
import { Sim } from './sim';
import { CityColliders } from './city';

export interface RunSpec {
  track: BuiltTrack;
  car: CarConfig;
  /** Запись ввода игрока по шагам, начиная с первого шага сессии (включая отсчёт). */
  inputs: Uint8Array;
  laps: number;
  slot?: number;
  manual?: boolean;
  /** Множитель сцепления погоды. */
  surfaceGrip?: number;
  city?: City | null;
  countdownSteps?: number;
}

export interface RunResult {
  finished: boolean;
  /** Время финиша от старта, шагов. */
  finishSteps: number;
  lapSteps: number[];
  bestLapSteps: number;
  steps: number;
}

/**
 * Детерминированный повтор заезда «на время» — ровно в том порядке, что и клиентская
 * сессия: [город: коллайдеры раз в 10 шагов] → шаг физики → гоночная логика.
 * Используется сервером для проверки рекордов (5.4).
 */
export function replayRun(R: Rapier, spec: RunSpec): RunResult {
  const sim = new Sim(R, spec.track);
  try {
    const car = sim.addCar(spec.car, spec.slot ?? 0, { manualGearbox: !!spec.manual });
    car.surfaceGrip = spec.surfaceGrip ?? 1;
    const cc = spec.city ? new CityColliders(spec.city, sim) : null;
    const race = new RaceTracker(spec.track, spec.laps, spec.countdownSteps ?? COUNTDOWN_STEPS);
    const p0 = car.position;
    race.addRacer('p', p0.x, p0.z);
    const n = InputRecorder.frameCount(spec.inputs);
    let step = 0;
    for (; step < n; step++) {
      if (cc && step % 10 === 0) cc.update([car.position]);
      sim.tick([InputRecorder.frameAt(spec.inputs, step)]);
      const p = car.position;
      const v = car.body.linvel();
      race.updateRacer('p', p.x, p.z, v.x, v.z);
      race.tick();
      if (race.racers.get('p')!.finished) {
        step++;
        break;
      }
    }
    const r = race.racers.get('p')!;
    return {
      finished: r.finished,
      finishSteps: r.finishStep,
      lapSteps: r.lapSteps,
      bestLapSteps: r.bestLapSteps,
      steps: step,
    };
  } finally {
    sim.dispose();
  }
}
