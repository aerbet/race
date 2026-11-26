import { z } from 'zod';

const curve = z
  .array(z.tuple([z.number(), z.number()]))
  .min(2, 'кривая должна содержать минимум 2 точки')
  .refine((pts) => pts.every((p, i) => i === 0 || p[0] > pts[i - 1]![0]), {
    message: 'точки кривой должны идти по возрастанию X',
  });

const pos = z.number().positive();
const nonneg = z.number().nonnegative();
const unit = z.number().min(0).max(1);

export const AssistsSchema = z.object({
  speedSteer: z.object({
    enabled: z.boolean(),
    /** Угол руля (°) на скорости speedRefKmh и выше. */
    minAngleDeg: pos,
    speedRefKmh: pos,
  }),
  turnAssist: z.object({
    enabled: z.boolean(),
    /** Дополнительное угловое ускорение рыскания, рад/с² на полный руль. */
    yawAccel: nonneg,
  }),
  /** Руль по сцеплению: на скорости угол колёс не больше того, что держат шины. */
  gripSteer: z
    .object({
      enabled: z.boolean(),
      /** Запас по боковому ускорению относительно сцепления шин (1 — ровно предел). */
      latG: pos,
      /** Добавка к кинематическому углу (°) — шине нужен угол увода, чтобы тянуть. */
      extraDeg: nonneg,
    })
    .default({ enabled: true, latG: 2.0, extraDeg: 2.5 }),
  /** Стабилизация вне дрифта (как ESP): рыскание к ожидаемому по рулю, предел скольжения. */
  stability: z
    .object({
      enabled: z.boolean(),
      /** Доводка скорости рыскания к ожидаемой, 1/с. */
      yawGain: nonneg,
      /** Предел угла скольжения вне дрифта, °. */
      maxSlipDeg: pos,
      /** Как быстро гасится лишняя боковая скорость, 1/с. */
      slipRate: nonneg,
      /**
       * Аркадное сцепление: траектория подтягивается к направлению кузова, 1/с
       * (машина едет туда, куда смотрит нос, а не уползает боком).
       */
      gripRate: nonneg.default(3),
    })
    .default({ enabled: true, yawGain: 7, maxSlipDeg: 9, slipRate: 5, gripRate: 3 }),
  /** Ручник: без руля — тормоз по прямой, с рулём — занос с пределом угла. */
  handbrake: z
    .object({
      enabled: z.boolean(),
      /** Доля рабочего тормоза, добавляемая ручником при руле прямо. */
      straightBrake: unit,
      /** То же при повёрнутом руле (занос). */
      turnBrake: unit,
      /** На сколько градусов ручником можно перекрутить предел угла дрифта. */
      extraAngleDeg: nonneg,
      /**
       * Срыв в занос ручником — только с зажатым газом (газ + пробел + руль) или в дрифт-гонке;
       * без газа пробел — просто сильный тормоз.
       */
      driftNeedsThrottle: z.boolean().default(true),
    })
    .default({
      enabled: true,
      straightBrake: 1,
      turnBrake: 1,
      extraAngleDeg: 8,
      driftNeedsThrottle: true,
    }),
  /** Аркадное усиление торможения: дополнительное замедление на полном тормозе, g. */
  brakeAssist: z
    .object({ enabled: z.boolean(), extraG: nonneg })
    .default({ enabled: true, extraG: 0.6 }),
  driftInit: z.object({
    enabled: z.boolean(),
    /**
     * Срыв без ручника — от сброса газа и от скольжения на газу. Вне дрифт-гонки выключен:
     * обычный поворот не должен превращаться в занос.
     */
    autoTriggers: z.boolean().default(false),
    /** Множитель бокового сцепления задней оси в полном дрифте. */
    rearGripScale: z.number().min(0.1).max(1),
    /** Минимальная скорость входа в дрифт, км/ч. */
    minSpeedKmh: nonneg,
    /** Скорость набора «дрифт-фактора», 1/с. */
    attackRate: pos,
  }),
  driftHold: z.object({
    enabled: z.boolean(),
    minAngleDeg: nonneg,
    maxAngleDeg: pos,
    /** Сила автоконтрруления (угловое ускорение рыскания, рад/с² на рад ошибки). */
    strength: nonneg,
    /** Доля сохранения скорости вдоль траектории в дрифте, 0..1. */
    speedKeep: unit,
  }),
  driftExit: z.object({
    enabled: z.boolean(),
    /** Скорость возврата сцепления, 1/с. */
    recoverRate: pos,
    /** Гашение рыскания при выходе, 1/с. */
    yawDamp: nonneg,
  }),
  airStabilize: z.object({
    enabled: z.boolean(),
    /** Жёсткость выравнивания, рад/с² на рад. */
    strength: nonneg,
    damping: nonneg,
  }),
  softWalls: z.object({
    enabled: z.boolean(),
    friction: z.number().min(0).max(2),
    restitution: unit,
  }),
  autoReset: z.object({
    enabled: z.boolean(),
    seconds: pos,
  }),
});

export const CarConfigSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/, 'id — только a-z, 0-9 и _'),
  /** Вымышленное название (никаких реальных марок). */
  name: z.string().min(1),
  era: z.enum(['2000', '2026']),
  /** glTF-модель из Блендера: apps/client/public/cars/<model>/base.glb (нет — процедурный кузов). */
  model: z
    .string()
    .regex(/^[a-z0-9_]+$/)
    .optional(),
  /** Кузовные киты модели: cars/<model>/kit_<id>.glb; названия и цены — в shop.json (слот kit). */
  kits: z.array(z.string().regex(/^[a-z0-9_]+$/)).optional(),
  drive: z.enum(['rwd', 'fwd', 'awd']),
  /** Доля момента на заднюю ось для awd. */
  awdRearShare: unit.default(0.6),
  mass: z.number().min(500).max(4000),
  /** Размер кузова (м): ширина, высота, длина. */
  body: z.object({ width: pos, height: pos, length: pos }),
  /** Центр масс относительно геометрического центра кузова (м). */
  centerOfMass: z.object({ y: z.number(), z: z.number() }),
  inertiaScale: pos.default(1),
  wheels: z.object({
    radius: pos,
    width: pos,
    wheelbase: pos,
    track: pos,
    /** Высота точки крепления подвески относительно центра кузова. */
    mountY: z.number(),
  }),
  suspension: z.object({
    restLength: pos,
    travel: pos,
    /** Жёсткость пружины, Н/м. */
    stiffness: pos,
    /** Демпфер, Н·с/м. */
    damping: pos,
    /** Стабилизатор, Н/м разницы сжатия. */
    antiRoll: nonneg,
  }),
  engine: z.object({
    idleRpm: pos,
    redlineRpm: pos,
    /** Крутящий момент (Н·м) по оборотам. */
    torqueCurve: curve,
    /** Момент торможения двигателем на сброшенном газе, Н·м. */
    engineBrake: nonneg,
    sound: z.enum(['i4', 'v6', 'v8', 'rotary', 'electric']),
  }),
  gearbox: z.object({
    ratios: z.array(pos).min(1),
    reverse: pos,
    final: pos,
    shiftTime: nonneg,
    autoUpRpm: pos,
    autoDownRpm: pos,
  }),
  tires: z.object({
    /** μ по коэффициенту проскальзывания (0..1). */
    longitudinal: curve,
    /** μ по углу увода (°). */
    lateral: curve,
    frontGrip: pos,
    rearGrip: pos,
    rollingResistance: nonneg,
  }),
  brakes: z.object({
    /** Максимальная тормозная сила на всю машину, Н. */
    maxForce: pos,
    frontBias: unit,
    handbrakeForce: nonneg,
  }),
  aero: z.object({ drag: nonneg, downforce: nonneg }),
  steering: z.object({
    maxAngleDeg: pos,
    /** Скорость поворота руля для клавиатуры, 1/с. */
    keyboardRate: pos,
    keyboardReturnRate: pos,
  }),
  assists: AssistsSchema,
  nitro: z.object({
    /** Ёмкость в секундах полного впрыска. */
    capacity: z.number().min(2).max(4),
    /** Прирост тяги (0.25..0.4). */
    boost: z.number().min(0.25).max(0.4),
    chargePerDriftSecond: nonneg,
    chargePerAirSecond: nonneg,
    chargePerOvertake: nonneg,
  }),
  /** Заявленные характеристики — для тестов и витрины. */
  specs: z.object({ zeroTo100: pos, topSpeedKmh: pos }),
});

export type CarConfig = z.infer<typeof CarConfigSchema>;
export type CarAssists = z.infer<typeof AssistsSchema>;

export class CarConfigError extends Error {}

/** Проверяет конфиг; при ошибке — понятное сообщение с путём до поля. */
export function parseCarConfig(raw: unknown, source = 'car config'): CarConfig {
  const r = CarConfigSchema.safeParse(raw);
  if (!r.success) {
    const lines = r.error.issues.map((i) => `  • ${i.path.join('.') || '(корень)'}: ${i.message}`);
    throw new CarConfigError(`Невалидный конфиг машины (${source}):\n${lines.join('\n')}`);
  }
  const c = r.data;
  if (c.engine.redlineRpm <= c.engine.idleRpm)
    throw new CarConfigError(
      `Невалидный конфиг машины (${source}):\n  • engine.redlineRpm: должен быть больше idleRpm`,
    );
  if (c.gearbox.autoDownRpm >= c.gearbox.autoUpRpm)
    throw new CarConfigError(
      `Невалидный конфиг машины (${source}):\n  • gearbox.autoDownRpm: должен быть меньше autoUpRpm`,
    );
  return c;
}

/** Линейная интерполяция по кривой с зажимом по краям. */
export function sampleCurve(pts: readonly (readonly [number, number])[], x: number): number {
  const first = pts[0]!;
  if (x <= first[0]) return first[1];
  for (let i = 1; i < pts.length; i++) {
    const b = pts[i]!;
    if (x <= b[0]) {
      const a = pts[i - 1]!;
      return a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
    }
  }
  return pts[pts.length - 1]![1];
}
