import { z } from 'zod';

export const TrackDefSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string(),
  type: z.enum(['sprint', 'circuit', 'drift']),
  laps: z.number().int().min(1),
  closed: z.boolean(),
  /** Контрольные точки сплайна: [x, z, ширина?, высота?]. */
  points: z
    .array(
      z
        .tuple([z.number(), z.number()])
        .or(z.tuple([z.number(), z.number(), z.number()]))
        .or(z.tuple([z.number(), z.number(), z.number(), z.number()])),
    )
    .min(3),
  defaultWidth: z.number().positive(),
  /** Расстояние между чекпоинтами, м. */
  checkpointSpacing: z.number().positive(),
  walls: z.boolean(),
  wallOffset: z.number().nonnegative(),
  ramps: z.array(
    z.object({
      /** Положение по дистанции трассы, м. */
      s: z.number().nonnegative(),
      length: z.number().positive(),
      height: z.number().positive(),
      width: z.number().positive(),
      /** Смещение вбок от осевой, м. */
      offset: z.number().default(0),
    }),
  ),
  /** Размер плоскости земли (м, квадрат). */
  groundSize: z.number().positive(),
  /** На каком расстоянии после старта стоит финишная линия (для кольца — 0). */
  startS: z.number().nonnegative().default(0),
  /** Оформление (BLENDER_PLAN 7.1), см. tracks/dressing.ts; нет — правила по умолчанию. */
  dressing: z
    .array(
      z.object({
        item: z.string().or(z.array(z.string()).min(1)),
        every: z.number().positive().optional(),
        side: z.enum(['left', 'right', 'both', 'outer', 'inner']),
        offset: z.number(),
        from: z.number().optional(),
        to: z.number().optional(),
        minCurve: z.number().optional(),
        at: z.array(z.number()).optional(),
        spanWidth: z.number().positive().optional(),
      }),
    )
    .optional(),
});

export type TrackDef = z.infer<typeof TrackDefSchema>;

export function parseTrackDef(raw: unknown): TrackDef {
  const r = TrackDefSchema.safeParse(raw);
  if (!r.success) {
    throw new Error(
      'Невалидная трасса:\n' +
        r.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n'),
    );
  }
  return r.data;
}
