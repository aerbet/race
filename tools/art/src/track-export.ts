/**
 * pnpm track:export <id|all> — сплайн трассы для Блендера (BLENDER_PLAN 7.2):
 * art/specs/track/<id>.json — сэмплы оси через 4 м [x, y, z, ширина], габариты, чекпоинты.
 * Трассы городов берутся из apps/client/public/cities/*\/city.json (там же — улицы для карты меню).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TRACKS, buildTrack, parseCity, type TrackDef } from '@sr/shared';

export interface TrackExport {
  id: string;
  name: string;
  type: string;
  closed: boolean;
  elevated: boolean;
  groundSize: number;
  length: number;
  /** [x, y, z, ширина] через ~4 м; координаты сцены (X — восток, Z — юг, Y — вверх). */
  samples: [number, number, number, number][];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Улицы района (только у городских трасс): ломаные [x, z] и ширина. */
  roads?: { width: number; points: [number, number][] }[];
  city?: string;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function exportTrack(
  def: TrackDef,
  city?: { id: string; roads: TrackExport['roads'] },
): TrackExport {
  const t = buildTrack(def);
  return {
    id: def.id,
    name: def.name,
    type: def.type,
    closed: def.closed,
    elevated: t.elevated,
    groundSize: def.groundSize,
    length: r2(t.length),
    samples: t.samples
      .filter((_, i) => i % 2 === 0)
      .map((s) => [r2(s.x), r2(s.y), r2(s.z), r2(s.width)]),
    bounds: t.bounds,
    ...(city ? { city: city.id, roads: city.roads } : {}),
  };
}

/** Все трассы: встроенные + городские (из опубликованных city.json). */
export function allTracks(
  root: string,
): { def: TrackDef; city?: { id: string; roads: TrackExport['roads'] } }[] {
  const out: { def: TrackDef; city?: { id: string; roads: TrackExport['roads'] } }[] =
    Object.values(TRACKS).map((def) => ({ def }));
  const dir = join(root, 'apps/client/public/cities');
  if (existsSync(dir))
    for (const id of readdirSync(dir)) {
      const f = join(dir, id, 'city.json');
      if (!existsSync(f)) continue;
      const c = parseCity(JSON.parse(readFileSync(f, 'utf8')));
      const roads = c.roads.map((r) => ({
        width: r.width,
        points: r.points as [number, number][],
      }));
      for (const def of c.tracks) out.push({ def, city: { id: c.id, roads } });
    }
  return out;
}

export function writeExports(root: string, only?: string): string[] {
  const dir = join(root, 'art/specs/track');
  mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  for (const { def, city } of allTracks(root)) {
    if (only && only !== 'all' && def.id !== only) continue;
    const f = join(dir, `${def.id}.json`);
    writeFileSync(f, JSON.stringify(exportTrack(def, city)) + '\n');
    files.push(f);
  }
  return files;
}
