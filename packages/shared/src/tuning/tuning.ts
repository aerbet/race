import parts from './parts.json';
import type { CarConfig } from '../cars/schema';
import { cloneCar } from '../cars/index';

export const PART_CATEGORIES = [
  'engine',
  'turbo',
  'transmission',
  'suspension',
  'tires',
  'brakes',
  'nitro',
  'weight',
] as const;
export type PartCategory = (typeof PART_CATEGORIES)[number];
/** Уровни деталей 0..4 по категориям. */
export type PartLevels = Partial<Record<PartCategory, number>>;
export type CarClass = 'D' | 'C' | 'B' | 'A' | 'S';

export const TUNING = parts as {
  levels: number;
  eraHeadroom: Record<string, number>;
  categories: Record<
    PartCategory,
    { name: string; price: number[] } & Record<string, number[] | string>
  >;
  classes: { id: CarClass; min: number }[];
  carPrices: Record<string, number>;
};

const eff = (cat: PartCategory, key: string, level: number, headroom: number): number => {
  const arr = TUNING.categories[cat][key] as number[] | undefined;
  return (arr?.[Math.max(0, Math.min(TUNING.levels, level))] ?? 0) * headroom;
};

const round = (v: number, d = 4) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * Применить детали к конфигу машины. Эффекты задаются в общей таблице parts.json
 * (её же читает Java-API), «нулевые» получают полный эффект, «2026» — 60 %.
 */
export function applyTuning(base: CarConfig, levels: PartLevels): CarConfig {
  const c = cloneCar(base);
  const h = TUNING.eraHeadroom[c.era] ?? 1;
  const lv = (k: PartCategory) => levels[k] ?? 0;
  const torque =
    1 + eff('engine', 'torque', lv('engine'), h) + eff('turbo', 'torque', lv('turbo'), h);
  c.engine.torqueCurve = c.engine.torqueCurve.map(([r, t]) => [r, round(t * torque, 2)]);
  c.gearbox.shiftTime = round(
    c.gearbox.shiftTime * (1 + eff('transmission', 'shiftTime', lv('transmission'), h)),
  );
  const st = 1 + eff('suspension', 'stiffness', lv('suspension'), h);
  c.suspension.stiffness = round(c.suspension.stiffness * st, 1);
  c.suspension.antiRoll = round(c.suspension.antiRoll * st, 1);
  const grip = 1 + eff('tires', 'grip', lv('tires'), h);
  c.tires.frontGrip = round(c.tires.frontGrip * grip);
  c.tires.rearGrip = round(c.tires.rearGrip * grip);
  c.brakes.maxForce = round(
    c.brakes.maxForce * (1 + eff('brakes', 'brakeForce', lv('brakes'), h)),
    1,
  );
  c.nitro.capacity = round(
    Math.min(4, c.nitro.capacity + eff('nitro', 'capacity', lv('nitro'), h)),
  );
  c.nitro.boost = round(Math.min(0.4, c.nitro.boost + eff('nitro', 'boost', lv('nitro'), h)));
  c.mass = round(c.mass * (1 + eff('weight', 'mass', lv('weight'), h)), 1);
  return c;
}

/** Индекс мощности PI 100–999 (та же формула в Java: PiCalculator). */
export function computePI(c: CarConfig): number {
  let peakKw = 0;
  for (const [rpm, nm] of c.engine.torqueCurve) peakKw = Math.max(peakKw, (nm * rpm) / 9549);
  const kwPerTon = peakKw / (c.mass / 1000);
  const grip = (c.tires.frontGrip + c.tires.rearGrip) / 2;
  const brakeDecel = c.brakes.maxForce / c.mass;
  const pi = 50 + 2.0 * kwPerTon + 400 * (grip - 1) + 8 * (brakeDecel - 10) + 150 * c.nitro.boost;
  return Math.max(100, Math.min(999, Math.round(pi)));
}

export function piClass(pi: number): CarClass {
  let cls: CarClass = 'D';
  for (const k of TUNING.classes) if (pi >= k.min) cls = k.id;
  return cls;
}

export function partPrice(cat: PartCategory, level: number): number {
  return TUNING.categories[cat].price[level] ?? Infinity;
}
