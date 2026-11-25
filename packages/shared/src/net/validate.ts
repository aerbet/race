import type { CarConfig } from '../cars/schema';
import { CarFlags, type CarState } from './protocol';
import { trackCoords, type BuiltTrack } from '../tracks/build';
import { PHYSICS_HZ } from '../constants';

export type Verdict = { ok: true } | { ok: false; reason: string };

/** Допуск по максимальной скорости с учётом нитро и спуска с трамплина. */
export function maxPlausibleSpeed(cfg: CarConfig): number {
  return (cfg.specs.topSpeedKmh / 3.6) * (1 + cfg.nitro.boost) * 1.15;
}

/** Минимальное теоретическое время между двумя точками трассы (шаги). */
export function minSectorSteps(distance: number, cfg: CarConfig): number {
  return (distance / maxPlausibleSpeed(cfg)) * PHYSICS_HZ;
}

export interface PlayerTrack {
  last: CarState | null;
  lastStep: number;
  /** Нарушения подряд. */
  strikes: number;
  /** Шаг сервера, когда пройден предыдущий чекпоинт, и его дистанция. */
  cpStep: number;
  cpS: number;
}

export const newPlayerTrack = (): PlayerTrack => ({
  last: null,
  lastStep: 0,
  strikes: 0,
  cpStep: 0,
  cpS: 0,
});

/**
 * Проверки правдоподобия пакета состояния:
 *  — скорость ≤ максимума машины;
 *  — реальное перемещение между пакетами (без телепортов, кроме сброса на трассу);
 *  — шаги клиента идут вперёд и не опережают время.
 */
export function checkState(
  pt: PlayerTrack,
  s: CarState,
  step: number,
  cfg: CarConfig,
  track: BuiltTrack,
): Verdict {
  const vals = [s.x, s.y, s.z, s.vx, s.vy, s.vz, s.qx, s.qy, s.qz, s.qw];
  if (!vals.every(Number.isFinite)) return { ok: false, reason: 'nan' };
  const half = track.def.groundSize / 2 + 50;
  if (Math.abs(s.x) > half || Math.abs(s.z) > half || s.y < -30 || s.y > 80)
    return { ok: false, reason: 'out-of-world' };
  const vmax = maxPlausibleSpeed(cfg);
  const speed = Math.hypot(s.vx, s.vy, s.vz);
  if (speed > vmax) return { ok: false, reason: 'speed' };
  if (pt.last) {
    const dSteps = step - pt.lastStep;
    if (dSteps <= 0) return { ok: false, reason: 'step-order' };
    const dt = dSteps / PHYSICS_HZ;
    const dist = Math.hypot(s.x - pt.last.x, s.z - pt.last.z);
    const allowed = vmax * dt * 1.25 + 1.5;
    if (dist > allowed) {
      // Сброс на трассу — допустимый «телепорт», если точка лежит на дороге
      if (s.flags & CarFlags.Reset) {
        const c = trackCoords(track, s.x, s.z);
        const sm = track.samples[c.i]!;
        if (Math.abs(c.lateral) > sm.width / 2 + 2) return { ok: false, reason: 'reset-off-track' };
      } else {
        return { ok: false, reason: 'teleport' };
      }
    }
  }
  return { ok: true };
}

/** Время участка между чекпоинтами не меньше теоретического минимума. */
export function checkSector(
  fromS: number,
  toS: number,
  steps: number,
  cfg: CarConfig,
  track: BuiltTrack,
): Verdict {
  let d = toS - fromS;
  if (track.def.closed && d < 0) d += track.length;
  // Срезка дороги может сократить путь — даём запас 25 %
  const min = minSectorSteps(d * 0.75, cfg);
  if (steps < min) return { ok: false, reason: 'sector-too-fast' };
  return { ok: true };
}
