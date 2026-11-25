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
