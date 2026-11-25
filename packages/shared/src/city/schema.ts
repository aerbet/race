import { z } from 'zod';
import { TrackDefSchema } from '../tracks/schema';

/** Классы дорог → ширина проезжей части (м). */
export const ROAD_WIDTH: Record<string, number> = {
  motorway: 22,
  trunk: 20,
  primary: 16,
  secondary: 13,
  tertiary: 11,
  residential: 8,
  unclassified: 8,
  living_street: 6,
  link: 8,
};

export const BLOCK_SIZE = 256;

const pt = z.tuple([z.number(), z.number()]);

export const CityRoadSchema = z.object({
  id: z.number(),
  cls: z.string(),
  name: z.string().default(''),
  width: z.number().positive(),
  oneway: z.boolean().default(false),
  points: z.array(pt).min(2),
});

export const CityBuildingSchema = z.object({
  footprint: z.array(pt).min(3),
  height: z.number().positive(),
});

export const CityTileSchema = z.object({
  /** Индексы блока 256×256 м. */
  i: z.number().int(),
  j: z.number().int(),
  file: z.string(),
  buildings: z.number().int(),
  /** Упрощённые коллайдеры зданий: [cx, cz, hx, hz, yaw, height] — ориентированный прямоугольник. */
  colliders: z.array(
    z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()]),
  ),
});

export const CitySchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Обязательная атрибуция данных. */
  attribution: z.string(),
  /** Центр проекции (WGS84). */
  origin: z.object({ lat: z.number(), lon: z.number() }),
  bounds: z.object({ minX: z.number(), maxX: z.number(), minZ: z.number(), maxZ: z.number() }),
  blockSize: z.number().positive(),
  roads: z.array(CityRoadSchema),
  tiles: z.array(CityTileSchema),
  /** Трассы на улицах города. */
  tracks: z.array(TrackDefSchema).default([]),
});

export type CityRoad = z.infer<typeof CityRoadSchema>;
export type CityBuilding = z.infer<typeof CityBuildingSchema>;
export type CityTile = z.infer<typeof CityTileSchema>;
export type City = z.infer<typeof CitySchema>;

export const OSM_ATTRIBUTION = '© участники OpenStreetMap (ODbL)';

export function parseCity(raw: unknown): City {
  const r = CitySchema.safeParse(raw);
  if (!r.success)
    throw new Error(
      'Невалидный город:\n' +
        r.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n'),
    );
  return r.data;
}

/** Ключ блока для точки. */
export const tileOf = (x: number, z: number, size = BLOCK_SIZE): [number, number] => [
  Math.floor(x / size),
  Math.floor(z / size),
];

/** Погода: влияет на картинку и сцепление. */
export type Weather = 'dry' | 'wet' | 'snow';
export const WEATHER_GRIP: Record<Weather, number> = { dry: 1, wet: 0.86, snow: 0.72 };
export const WEATHER_NAMES: Record<Weather, string> = {
  dry: 'Сухо',
  wet: 'Дождь, мокрый асфальт',
  snow: 'Снег и слякоть',
};

/** Расстояние от точки до ближайшей улицы минус половина её ширины (≤ 0 — на проезжей части). */
export function distanceToRoad(city: City, x: number, z: number): number {
  let best = Infinity;
  for (const r of city.roads) {
    for (let i = 1; i < r.points.length; i++) {
      const [ax, az] = r.points[i - 1]!,
        [bx, bz] = r.points[i]!;
      const dx = bx - ax,
        dz = bz - az;
      const k = Math.max(
        0,
        Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)),
      );
      const d = Math.hypot(x - ax - dx * k, z - az - dz * k) - r.width / 2;
      if (d < best) best = d;
    }
  }
  return best;
}

/** Ближайшая точка на улицах и направление улицы в ней (для сброса машины в свободной езде). */
export function nearestRoadPoint(
  city: City,
  x: number,
  z: number,
): { x: number; z: number; yaw: number } {
  let best = Infinity;
  let out = { x, z, yaw: 0 };
  for (const r of city.roads) {
    for (let i = 1; i < r.points.length; i++) {
      const [ax, az] = r.points[i - 1]!,
        [bx, bz] = r.points[i]!;
      const dx = bx - ax,
        dz = bz - az;
      const k = Math.max(
        0,
        Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)),
      );
      const px = ax + dx * k,
        pz = az + dz * k;
      const d = Math.hypot(x - px, z - pz);
      if (d < best) {
        best = d;
        const l = Math.hypot(dx, dz) || 1;
        // Правая полоса по направлению сегмента
        const off = r.oneway ? 0 : r.width / 4;
        out = { x: px - (dz / l) * off, z: pz + (dx / l) * off, yaw: Math.atan2(-dx, -dz) };
      }
    }
  }
  return out;
}
