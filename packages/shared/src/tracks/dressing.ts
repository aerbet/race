/**
 * Оформление трасс (BLENDER_PLAN 7.1): правила расстановки элементов библиотеки
 * `apps/client/public/tracks/dressing.glb` вдоль сплайна. Правила можно задать в JSON трассы
 * (`dressing`), иначе берутся правила по умолчанию для типа трассы.
 */
import type { BuiltTrack, TrackSample } from './build';

export interface DressingRule {
  /** id элемента (или несколько — по очереди). */
  item: string | string[];
  /** Шаг вдоль трассы, м (для единичных — не нужен). */
  every?: number;
  /** Сторона: left/right/both, outer/inner — снаружи/внутри поворота. */
  side: 'left' | 'right' | 'both' | 'outer' | 'inner';
  /** Отступ от кромки дороги, м. */
  offset: number;
  /** Участок трассы, м от начала. */
  from?: number;
  to?: number;
  /** Только где |кривизна| ≥ minCurve (1/м): шины на внешней стороне быстрых поворотов. */
  minCurve?: number;
  /** Единичные позиции по дистанции (арка старта, трибуны). */
  at?: number[];
  /** Растянуть элемент по ширине дороги (арка): базовая ширина элемента, м. */
  spanWidth?: number;
}

/** Экземпляр: элемент, позиция, поворот (локальная +Z смотрит на дорогу), масштаб по X. */
export interface DressingInstance {
  item: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  sx: number;
}

const BANNERS = ['banner_a', 'banner_b', 'banner_c', 'banner_d'];

/** Правила по умолчанию: кольцо/спринт на полигоне, улицы города, горный серпантин. */
export function defaultDressing(t: BuiltTrack, inCity: boolean): DressingRule[] {
  const start = t.def.startS;
  const wall = t.def.walls ? t.def.wallOffset : 0;
  // Арка старта (start_arch, spanWidth 24) есть в библиотеке, но по умолчанию не ставится:
  // у старта уже стоит портал LevelView.buildStartLine
  if (t.elevated)
    return [
      { item: 'guardrail', every: 4, side: 'outer', offset: 0.8 },
      { item: 'guardrail', every: 4, side: 'inner', offset: 0.8, minCurve: 1 / 60 },
      { item: BANNERS, every: 160, side: 'inner', offset: 3, from: 40 },
      { item: 'cone', every: 3, side: 'inner', offset: 0.4, minCurve: 1 / 25 },
    ];
  if (inCity)
    return [
      { item: BANNERS, every: 90, side: 'both', offset: 1.2, from: 30 },
      { item: 'tire_wall', every: 4, side: 'outer', offset: 0.6, minCurve: 1 / 40 },
      { item: 'cone', every: 4, side: 'inner', offset: 0.4, minCurve: 1 / 30 },
    ];
  return [
    { item: 'grandstand', side: 'left', offset: wall + 5, at: [start + 30, start + 55] },
    { item: 'light_mast', every: 70, side: 'both', offset: wall + 4 },
    { item: BANNERS, every: 45, side: 'outer', offset: wall + 1.5, from: 20 },
    { item: 'tire_wall', every: 4, side: 'outer', offset: wall + 0.6, minCurve: 1 / 45 },
    { item: 'concrete_block', every: 2, side: 'inner', offset: wall + 0.6, minCurve: 1 / 45 },
    { item: 'cone', every: 5, side: 'inner', offset: 0.4, minCurve: 1 / 30 },
  ];
}

function sampleAt(S: TrackSample[], s: number): TrackSample {
  let lo = 0,
    hi = S.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (S[mid]!.s <= s) lo = mid;
    else hi = mid;
  }
  return S[lo]!;
}

/** Сглаженная кривизна (знак: + поворот вправо) — по соседним сэмплам. */
function curvature(S: TrackSample[], i: number): number {
  let k = 0;
  let n = 0;
  for (let j = Math.max(0, i - 4); j <= Math.min(S.length - 1, i + 4); j++, n++) k += S[j]!.k;
  return k / n;
}

/**
 * Экземпляры по правилам. Правая сторона — справа по ходу (нормаль (−tz, tx) в плоскости x,z).
 */
export function placeDressing(t: BuiltTrack, rules: DressingRule[]): DressingInstance[] {
  const S = t.samples;
  const out: DressingInstance[] = [];
  const round = (v: number) => Math.round(v * 100) / 100;
  for (const r of rules) {
    const items = Array.isArray(r.item) ? r.item : [r.item];
    const positions: number[] = [];
    if (r.at) positions.push(...r.at);
    else if (r.every)
      for (let s = r.from ?? 0; s <= (r.to ?? t.length); s += r.every) positions.push(s);
    positions.forEach((s, n) => {
      if (s < 0 || s > t.length) return;
      const sm = sampleAt(S, s);
      const k = curvature(S, S.indexOf(sm));
      if (r.minCurve && Math.abs(k) < r.minCurve) return;
      const right = k >= 0 ? 1 : -1; // сторона центра поворота: + вправо
      const sides =
        r.side === 'both'
          ? r.spanWidth
            ? [0]
            : [-1, 1]
          : r.side === 'right'
            ? [1]
            : r.side === 'left'
              ? [-1]
              : r.side === 'inner'
                ? [right]
                : [-right];
      for (const side of sides) {
        // нормаль вправо по ходу: (−tz, tx)
        const nx = -sm.tz * side,
          nz = sm.tx * side;
        const off = side === 0 ? 0 : sm.width / 2 + r.offset;
        const x = sm.x + nx * off,
          z = sm.z + nz * off;
        // локальная +Z элемента — к дороге (−n); для арки — вдоль хода (элемент поперёк дороги)
        // (ось X элемента в сцене — (cos yaw, −sin yaw); у арки она поперёк дороги: (−tz, tx))
        const yaw = side === 0 ? Math.atan2(-sm.tx, -sm.tz) : Math.atan2(-nx, -nz);
        out.push({
          item: items[n % items.length]!,
          x: round(x),
          y: round(sm.y),
          z: round(z),
          yaw: Math.round(yaw * 1000) / 1000,
          sx: r.spanWidth ? round((sm.width + 3) / r.spanWidth) : 1,
        });
      }
    });
  }
  return out;
}
