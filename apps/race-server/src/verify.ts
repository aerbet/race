import {
  CAR_IDS,
  PART_CATEGORIES,
  WEATHER_GRIP,
  applyTuning,
  fromBase64,
  getCar,
  getTrack,
  type City,
  type PartLevels,
  type Weather,
} from '@sr/shared';
import { replayRun, type Rapier } from '@sr/physics';

export interface VerifyRequest {
  trackId: string;
  carId: string;
  parts?: PartLevels;
  manual?: boolean;
  weather?: Weather;
  laps: number;
  /** base64 записи ввода (6 байт на шаг). */
  inputs: string;
}

export interface VerifyResponse {
  ok: boolean;
  finished: boolean;
  finishSteps: number;
  bestLapSteps: number;
  lapSteps: number[];
  error?: string;
}

/** Не больше 15 минут заезда — защита от «бомб» на сервере. */
const MAX_STEPS = 60 * 60 * 15;

/** Детерминированный повтор заезда для проверки рекорда (вызывает API). */
export function verifyRun(
  R: Rapier,
  cities: Map<string, City>,
  req: VerifyRequest,
): VerifyResponse {
  const fail = (error: string): VerifyResponse => ({
    ok: false,
    finished: false,
    finishSteps: 0,
    bestLapSteps: 0,
    lapSteps: [],
    error,
  });
  if (!CAR_IDS.includes(req.carId)) return fail('unknown_car');
  let track;
  try {
    track = getTrack(req.trackId);
  } catch {
    return fail('unknown_track');
  }
  if (!Number.isInteger(req.laps) || req.laps < 1 || req.laps > 10) return fail('bad_laps');
  const parts: PartLevels = {};
  for (const [k, v] of Object.entries(req.parts ?? {})) {
    if (
      !(PART_CATEGORIES as readonly string[]).includes(k) ||
      !Number.isInteger(v) ||
      v < 0 ||
      v > 4
    )
      return fail('bad_parts');
    parts[k as keyof PartLevels] = v;
  }
  const inputs = fromBase64(req.inputs ?? '');
  if (inputs.length === 0 || inputs.length % 6 !== 0 || inputs.length / 6 > MAX_STEPS)
    return fail('bad_inputs');
  const city = [...cities.values()].find((c) => c.tracks.some((t) => t.id === req.trackId)) ?? null;
  const r = replayRun(R, {
    track,
    car: applyTuning(getCar(req.carId), parts),
    inputs,
    laps: req.laps,
    manual: !!req.manual,
    surfaceGrip: WEATHER_GRIP[req.weather ?? 'dry'] ?? 1,
    city,
  });
  return {
    ok: true,
    finished: r.finished,
    finishSteps: r.finishSteps,
    bestLapSteps: r.bestLapSteps,
    lapSteps: r.lapSteps,
  };
}
