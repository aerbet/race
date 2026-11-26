import { ROAD_WIDTH } from '@sr/shared';
import type { P } from './geom';

/** Формат ответа Overpass API (out body; с узлами). */
export interface OverpassJson {
  elements: (
    | { type: 'node'; id: number; lat: number; lon: number; tags?: Record<string, string> }
    | { type: 'way'; id: number; nodes: number[]; tags?: Record<string, string> }
    | {
        type: 'relation';
        id: number;
        members?: { type: string; ref: number; role: string }[];
        tags?: Record<string, string>;
      }
  )[];
}

export interface RawRoad {
  id: number;
  cls: string;
  name: string;
  oneway: boolean;
  lanes: number;
  points: P[];
}
export interface RawBuilding {
  id: number;
  footprint: P[];
  height: number;
}

const DRIVABLE = new Set(Object.keys(ROAD_WIDTH).filter((k) => k !== 'link'));

/** Локальная проекция: равнопромежуточная вокруг центра, метры; X — восток, Z — юг (как в сцене). */
export function makeProjection(lat0: number, lon0: number) {
  const R = 6378137;
  const k = Math.cos((lat0 * Math.PI) / 180);
  return (lat: number, lon: number): P => [
    (((lon - lon0) * Math.PI) / 180) * R * k,
    (-((lat - lat0) * Math.PI) / 180) * R,
  ];
}

export function roadClass(highway: string): string | null {
  if (highway.endsWith('_link')) return 'link';
  return DRIVABLE.has(highway) ? highway : null;
}

/** Высота здания: height → building:levels × 3,2 м → по умолчанию по типу. */
export function buildingHeight(tags: Record<string, string>): number {
  const h = parseFloat(tags.height ?? '');
  if (Number.isFinite(h) && h > 0) return Math.min(h, 250);
  const lv = parseFloat(tags['building:levels'] ?? '');
  if (Number.isFinite(lv) && lv > 0) return Math.min(lv * 3.2 + 1, 250);
  const t = tags.building ?? 'yes';
  if (t === 'garage' || t === 'garages' || t === 'shed' || t === 'kiosk') return 3;
  if (t === 'church' || t === 'cathedral') return 22;
  return 15;
}

export function parseOverpass(
  data: OverpassJson,
  origin?: { lat: number; lon: number },
): {
  roads: RawRoad[];
  buildings: RawBuilding[];
  lat0: number;
  lon0: number;
} {
  const nodes = new Map<number, { lat: number; lon: number }>();
  let minLat = Infinity,
    maxLat = -Infinity,
    minLon = Infinity,
    maxLon = -Infinity;
  for (const e of data.elements) {
    if (e.type !== 'node') continue;
    nodes.set(e.id, { lat: e.lat, lon: e.lon });
  }
  const ways = data.elements.filter(
    (e): e is Extract<OverpassJson['elements'][number], { type: 'way' }> => e.type === 'way',
  );
  for (const w of ways) {
    for (const id of w.nodes) {
      const n = nodes.get(id);
      if (!n) continue;
      minLat = Math.min(minLat, n.lat);
      maxLat = Math.max(maxLat, n.lat);
      minLon = Math.min(minLon, n.lon);
      maxLon = Math.max(maxLon, n.lon);
    }
  }
  const lat0 = origin?.lat ?? (minLat + maxLat) / 2;
  const lon0 = origin?.lon ?? (minLon + maxLon) / 2;
  const proj = makeProjection(lat0, lon0);
  const roads: RawRoad[] = [];
  const buildings: RawBuilding[] = [];
  for (const w of ways) {
    const tags = w.tags ?? {};
    const pts: P[] = [];
    for (const id of w.nodes) {
      const n = nodes.get(id);
      if (n) pts.push(proj(n.lat, n.lon));
    }
    if (pts.length < 2) continue;
    if (tags.highway) {
      const cls = roadClass(tags.highway);
      if (!cls || tags.area === 'yes' || tags.tunnel === 'yes') continue;
      roads.push({
        id: w.id,
        cls,
        name: tags.name ?? '',
        oneway: tags.oneway === 'yes' || tags.junction === 'roundabout',
        lanes: parseInt(tags.lanes ?? '0', 10) || 0,
        points: pts,
      });
    } else if (tags.building && pts.length >= 4) {
      // Замкнутый контур: последний узел = первый
      const fp = pts.slice(0, -1);
      if (fp.length >= 3) buildings.push({ id: w.id, footprint: fp, height: buildingHeight(tags) });
    }
  }
  // Здания-мультиполигоны (крупные кварталы с дворами): внешние кольца из членов-линий
  const wayNodes = new Map(ways.map((w) => [w.id, w.nodes]));
  for (const r of data.elements) {
    if (r.type !== 'relation' || !r.tags?.building || !r.members) continue;
    for (const ring of joinRings(
      r.members
        .filter((m) => m.type === 'way' && m.role === 'outer')
        .map((m) => wayNodes.get(m.ref) ?? []),
    )) {
      const fp: P[] = [];
      for (const id of ring.slice(0, -1)) {
        const n = nodes.get(id);
        if (n) fp.push(proj(n.lat, n.lon));
      }
      if (fp.length >= 3)
        buildings.push({
          id: r.id * 16 + (buildings.length % 16),
          footprint: fp,
          height: buildingHeight(r.tags),
        });
    }
  }
  return { roads, buildings, lat0, lon0 };
}

/** Склеить линии (списки узлов) в замкнутые кольца по общим концам. */
export function joinRings(parts: number[][]): number[][] {
  const left = parts.filter((p) => p.length >= 2).map((p) => [...p]);
  const rings: number[][] = [];
  while (left.length) {
    let ring = left.shift()!;
    let grown = true;
    while (ring[0] !== ring[ring.length - 1] && grown) {
      grown = false;
      for (let i = 0; i < left.length; i++) {
        const p = left[i]!;
        const end = ring[ring.length - 1];
        if (p[0] === end) ring = [...ring, ...p.slice(1)];
        else if (p[p.length - 1] === end) ring = [...ring, ...p.slice(0, -1).reverse()];
        else continue;
        left.splice(i, 1);
        grown = true;
        break;
      }
    }
    if (ring.length >= 4 && ring[0] === ring[ring.length - 1]) rings.push(ring);
  }
  return rings;
}
