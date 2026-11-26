/**
 * Расстановка модулей зданий из Блендера (BLENDER_PLAN 6, PLAN_V2 10.1).
 *
 * Каталог `modules.json` (art/scripts/city/build_modules.py): модуль — прямоугольный участок
 * w × d м и высота h; начало — центр участка на земле, X — фасад. Контур здания из OSM/синтетики
 * сводится к ориентированному прямоугольнику; под него подбирается модуль по высоте и
 * пропорциям, длинные дома собираются из нескольких одинаковых секций. Масштаб модуля
 * ограничен, чтобы окна не растягивались заметно.
 */
import { orientedBox, type P } from './geom';

export interface ModuleInfo {
  id: string;
  type: string;
  w: number;
  d: number;
  h: number;
}

export interface LandmarkInfo {
  id: string;
  w: number;
  d: number;
  h: number;
  /** plot — на свободном участке; span — поперёк ближайшей улицы (мост). */
  place: 'plot' | 'span';
}

export interface ModuleCatalog {
  kit: string;
  modules: ModuleInfo[];
  landmarks?: LandmarkInfo[];
  /** Желаемые места ориентиров по городам (art/specs/city/<kit>.json). */
  placements?: { id: string; city: string; x: number; z: number }[];
}

/** Ориентир на карте: id, центр, поворот; коллайдеры — как у зданий. */
export interface PlacedLandmark {
  id: string;
  x: number;
  z: number;
  yaw: number;
  colliders: [number, number, number, number, number, number][];
  /** Зона, где не ставятся здания: центр, полуоси, поворот. */
  clear: { x: number; z: number; hx: number; hz: number; yaw: number };
}

type Road = { width: number; points: P[] };

function nearestOnRoads(roads: Road[], x: number, z: number) {
  let best = { d: Infinity, x, z, dx: 1, dz: 0, w: 0 };
  for (const r of roads)
    for (let i = 1; i < r.points.length; i++) {
      const [ax, az] = r.points[i - 1]!,
        [bx, bz] = r.points[i]!;
      const dx = bx - ax,
        dz = bz - az;
      const k = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      const px = ax + dx * k,
        pz = az + dz * k;
      const d = Math.hypot(x - px, z - pz) - r.width / 2;
      if (d < best.d) best = { d, x: px, z: pz, dx, dz, w: r.width };
    }
  return best;
}

/**
 * Места ориентиров: plot — ближайшая к желаемой точка, где участок не задевает улицы;
 * span — поперёк ближайшей улицы, опоры за кромкой проезжей части.
 */
export function placeLandmarks(
  cat: ModuleCatalog,
  cityId: string,
  roads: Road[],
): PlacedLandmark[] {
  const out: PlacedLandmark[] = [];
  for (const p of cat.placements ?? []) {
    if (p.city !== cityId) continue;
    const lm = cat.landmarks?.find((l) => l.id === p.id);
    if (!lm) continue;
    if (lm.place === 'span') {
      const n = nearestOnRoads(roads, p.x, p.z);
      const yaw = Math.atan2(n.dx, n.dz); // ось X моста — поперёк улицы
      const c = Math.cos(yaw),
        s = Math.sin(yaw);
      const pier = lm.w / 2 - 3;
      out.push({
        id: lm.id,
        x: n.x,
        z: n.z,
        yaw,
        colliders: [-1, 1].map(
          (k) =>
            [
              n.x + k * pier * c,
              n.z - k * pier * s,
              3,
              lm.d / 2,
              yaw,
              9,
            ] as PlacedLandmark['colliders'][number],
        ),
        clear: { x: n.x, z: n.z, hx: lm.w / 2 + 4, hz: lm.d / 2 + 6, yaw },
      });
      continue;
    }
    const need = Math.hypot(lm.w, lm.d) / 2 + 4;
    let spot: [number, number] | null = null;
    for (let r = 0; r <= 480 && !spot; r += 8)
      for (let a = 0; a < 16 && !spot; a++) {
        const x = p.x + r * Math.cos((a / 16) * 2 * Math.PI),
          z = p.z + r * Math.sin((a / 16) * 2 * Math.PI);
        if (nearestOnRoads(roads, x, z).d >= need) spot = [x, z];
        if (r === 0) break;
      }
    if (!spot) continue;
    const [x, z] = spot;
    out.push({
      id: lm.id,
      x,
      z,
      yaw: 0,
      colliders: [[x, z, lm.w / 2, lm.d / 2, 0, lm.h]],
      clear: { x, z, hx: lm.w / 2 + 6, hz: lm.d / 2 + 6, yaw: 0 },
    });
  }
  return out;
}

/** Экземпляр: [индекс модуля, x, z, yaw, sx, sy, sz]. */
export type Instance = [number, number, number, number, number, number, number];

/** Типы модулей по высоте здания (м). */
function typesFor(h: number, long: number, short: number): string[] {
  if (long < 12 && h < 6) return ['pavilion'];
  if (h < 8) return long > 30 && short > 20 ? ['mall'] : ['pavilion', 'gas'];
  if (h < 18) return short > 22 ? ['mall'] : ['khrush'];
  if (h < 36) return ['stalinka', 'panel9', 'church'];
  if (h < 60) return ['panel16', 'stalinka'];
  return ['tower'];
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

function hash(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 2 ** 32;
}

/**
 * Экземпляры модулей для контура fp высотой h. Пусто — подходящего модуля нет
 * (вызывающий строит здание по-старому, коробкой).
 */
export function placeModules(fp: P[], h: number, seed: number, cat: ModuleCatalog): Instance[] {
  const box = orientedBox(fp);
  // Модуль ставится X-ом вдоль длинной стороны
  const alongU = box.hx >= box.hz;
  const long = 2 * (alongU ? box.hx : box.hz);
  const short = 2 * (alongU ? box.hz : box.hx);
  const yaw = alongU ? box.yaw : box.yaw - Math.PI / 2;
  const types = typesFor(h, long, short);
  // Церковь — редкость: один из ~25 подходящих домов
  const pool = cat.modules
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => types.includes(m.type) && (m.type !== 'church' || hash(seed + 5) < 0.04));
  if (!pool.length) return [];
  // Оценка: сколько секций и насколько растягивается модуль
  let best: { i: number; n: number; sx: number; sz: number; score: number } | null = null;
  for (const { m, i } of pool) {
    const n = Math.max(1, Math.round(long / m.w));
    const sx = long / (n * m.w);
    const sz = short / m.d;
    const sy = h / m.h;
    const score =
      Math.abs(Math.log(sx)) * 2 +
      Math.abs(Math.log(clamp(sz, 0.2, 5))) +
      Math.abs(Math.log(sy)) * 0.7 +
      hash(seed * 31 + i) * 0.35;
    if (!best || score < best.score) best = { i, n, sx, sz, score };
  }
  const m = cat.modules[best!.i]!;
  const sx = clamp(best!.sx, 0.7, 1.35);
  const sz = clamp(best!.sz, 0.6, 1.6);
  const sy = clamp(h / m.h, 0.8, 1.25);
  const out: Instance[] = [];
  const c = Math.cos(yaw),
    s = Math.sin(yaw);
  const step = m.w * sx;
  for (let k = 0; k < best!.n; k++) {
    const off = (k - (best!.n - 1) / 2) * step;
    // ось X модуля в мире: (cos yaw, −sin yaw)
    const x = box.cx + off * c;
    const z = box.cz - off * s;
    const r = (v: number) => Math.round(v * 100) / 100;
    out.push([best!.i, r(x), r(z), Math.round(yaw * 1000) / 1000, r(sx), r(sy), r(sz)]);
  }
  return out;
}

/**
 * Реквизит (BLENDER_PLAN 6.3) вдоль улиц шириной от 11 м: остановки, щиты, отбойники,
 * сугробы (если они есть в наборе), светофоры на концах улиц. Начало реквизита — кромка
 * тротуара, локальная +Z (в сцене) смотрит на проезжую часть.
 */
export function placeProps(cat: ModuleCatalog, roads: Road[]): Instance[] {
  // по типу: в разных наборах свой реквизит того же назначения (остановка ↔ автоматы, сугроб ↔ фонарик)
  const idx = (type: string) => cat.modules.findIndex((m) => m.type === type);
  const rules: { id: string; every: number; phase: number }[] = [
    { id: 'prop_bus_stop', every: 260, phase: 60 },
    { id: 'prop_billboard', every: 180, phase: 130 },
    { id: 'prop_barrier', every: 220, phase: 20 },
    { id: 'prop_snowbank', every: 70, phase: 35 },
  ].filter((r) => idx(r.id) >= 0);
  const out: Instance[] = [];
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const put = (id: string, x: number, z: number, nx: number, nz: number) => {
    const yaw = Math.atan2(-nx, -nz); // локальная +Z — к дороге (−n)
    out.push([idx(id), r2(x), r2(z), Math.round(yaw * 1000) / 1000, 1, 1, 1]);
  };
  for (const [ri, r] of roads.entries()) {
    if (r.width < 11 || r.points.length < 2) continue;
    let s = 0;
    for (let i = 1; i < r.points.length; i++) {
      const [ax, az] = r.points[i - 1]!,
        [bx, bz] = r.points[i]!;
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1) continue;
      const tx = (bx - ax) / len,
        tz = (bz - az) / len;
      for (const rule of rules) {
        // позиции правила на этом отрезке; стороны чередуются
        let k = Math.ceil((s - rule.phase) / rule.every);
        for (let at = rule.phase + k * rule.every; at < s + len; at += rule.every, k++) {
          if (at < s || at - s < 8 || s + len - at < 8) continue; // не у перекрёстков
          const side = (k + ri) % 2 ? 1 : -1;
          const nx = -tz * side,
            nz = tx * side;
          const off = r.width / 2 + (rule.id === 'prop_snowbank' ? 0.6 : 1.6);
          const px = ax + tx * (at - s) + nx * off,
            pz = az + tz * (at - s) + nz * off;
          put(rule.id, px, pz, nx, nz);
        }
      }
      s += len;
    }
    // светофоры на концах крупных улиц
    if (idx('prop_traffic_light') >= 0 && r.width >= 13) {
      for (const end of [0, r.points.length - 1]) {
        const [x, z] = r.points[end]!;
        const [x2, z2] = r.points[end === 0 ? 1 : end - 1]!;
        const l = Math.hypot(x2 - x, z2 - z) || 1;
        const tx = (x2 - x) / l,
          tz = (z2 - z) / l;
        const nx = -tz,
          nz = tx;
        put(
          'prop_traffic_light',
          x + tx * 10 + nx * (r.width / 2 + 0.8),
          z + tz * 10 + nz * (r.width / 2 + 0.8),
          nx,
          nz,
        );
      }
    }
  }
  return out;
}
