import {
  BLOCK_SIZE,
  OSM_ATTRIBUTION,
  ROAD_WIDTH,
  buildTrack,
  type TrackDef,
  type City,
  type CityRoad,
  type CityTile,
} from '@sr/shared';
import { centroid, orientedBox, polygonArea, simplify, triangulate, type P } from './geom';
import { writeGlb, type Primitive } from './glb';
import type { RawBuilding, RawRoad } from './osm';
import {
  placeLandmarks,
  placeModules,
  placeProps,
  type Instance,
  type ModuleCatalog,
} from './modules';

export interface BuildOptions {
  id: string;
  name: string;
  /** Половина стороны обрабатываемого квадрата, м (всё дальше отрезается). */
  half: number;
  origin: { lat: number; lon: number };
  attribution?: string;
  blockSize?: number;
  tracks?: TrackDef[];
  /** Стиль застройки: палитра фасадов и плотность неона в клиенте. */
  style?: 'moscow' | 'tokyo';
  /** Библиотека модулей зданий из Блендера (10.1); без неё — здания-коробки. */
  modules?: ModuleCatalog;
}

export interface BuildResult {
  city: City;
  /** Имя файла → содержимое .glb */
  files: Map<string, Uint8Array>;
}

const ROAD_RANK: Record<string, number> = {
  motorway: 8,
  trunk: 7,
  primary: 6,
  secondary: 5,
  tertiary: 4,
  link: 3,
  residential: 2,
  unclassified: 2,
  living_street: 1,
};

/** Палитра фасадов «по мотивам Москвы»: охра, беж, серый панельный, кирпич, белый. */
/** Палитра «по мотивам Токио»: светлый бетон, стекло, тёмная плитка. */
const FACADES_TOKYO: [number, number, number][] = [
  [0.82, 0.83, 0.86],
  [0.55, 0.6, 0.68],
  [0.38, 0.42, 0.5],
  [0.9, 0.9, 0.88],
  [0.62, 0.58, 0.55],
  [0.3, 0.33, 0.38],
];
const FACADES_MOSCOW: [number, number, number][] = [
  [0.78, 0.66, 0.48],
  [0.86, 0.8, 0.68],
  [0.62, 0.63, 0.66],
  [0.66, 0.38, 0.3],
  [0.9, 0.88, 0.84],
  [0.72, 0.58, 0.5],
];

function hash(n: number): number {
  n = n ^ 61 ^ (n >>> 16);
  n = (n + (n << 3)) | 0;
  n ^= n >>> 4;
  n = Math.imul(n, 0x27d4eb2d);
  return ((n ^ (n >>> 15)) >>> 0) / 2 ** 32;
}

/** Отрезать ломаную по квадрату [-half, half]² — оставляем участки внутри. */
function clipPolyline(pts: P[], half: number): P[][] {
  const inside = (p: P) => Math.abs(p[0]) <= half && Math.abs(p[1]) <= half;
  const out: P[][] = [];
  let cur: P[] = [];
  for (const p of pts) {
    if (inside(p)) cur.push(p);
    else if (cur.length) {
      cur.push(p);
      if (cur.length >= 2) out.push(cur);
      cur = [];
    }
  }
  if (cur.length >= 2) out.push(cur);
  return out;
}

class MeshBuilder {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];
  uvs: number[] = [];
  indices: number[] = [];
  vertex(
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    c: [number, number, number],
    u = 0,
    v = 0,
  ) {
    this.positions.push(x, y, z);
    this.normals.push(nx, ny, nz);
    this.colors.push(...c);
    this.uvs.push(u, v);
    return this.positions.length / 3 - 1;
  }
}

/** Лента дороги вдоль ломаной. */
function addRoad(
  mb: MeshBuilder,
  pts: P[],
  width: number,
  y: number,
  color: [number, number, number],
) {
  let dist = 0;
  let prevL = -1,
    prevR = -1;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const a = pts[Math.max(0, i - 1)]!,
      b = pts[Math.min(pts.length - 1, i + 1)]!;
    let tx = b[0] - a[0],
      tz = b[1] - a[1];
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    if (i > 0) dist += Math.hypot(p[0] - pts[i - 1]![0], p[1] - pts[i - 1]![1]);
    const rx = -tz,
      rz = tx;
    const hw = width / 2;
    const L = mb.vertex(p[0] - rx * hw, y, p[1] - rz * hw, 0, 1, 0, color, 0, dist / 10);
    const R = mb.vertex(p[0] + rx * hw, y, p[1] + rz * hw, 0, 1, 0, color, 1, dist / 10);
    if (prevL >= 0) mb.indices.push(prevL, L, prevR, prevR, L, R);
    prevL = L;
    prevR = R;
  }
  // «Пятак» на концах — закрывает щели на перекрёстках
  for (const p of [pts[0]!, pts[pts.length - 1]!]) {
    const c = mb.vertex(p[0], y - 0.001, p[1], 0, 1, 0, color, 0.5, 0);
    const n = 10;
    const first = mb.positions.length / 3;
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * Math.PI * 2;
      mb.vertex(
        p[0] + (Math.cos(a) * width) / 2,
        y - 0.001,
        p[1] + (Math.sin(a) * width) / 2,
        0,
        1,
        0,
        color,
        0.5,
        0,
      );
    }
    for (let k = 0; k < n; k++) mb.indices.push(c, first + k + 1, first + k);
  }
}

/** Здание: стены с UV под сетку окон (u — метры/4, v — этажи) и плоская крыша. */
/** Коробка (6 граней) в меш — надстройки на крышах. */
function addBox(
  mb: MeshBuilder,
  cx: number,
  y0: number,
  cz: number,
  sx: number,
  sy: number,
  sz: number,
  col: [number, number, number],
) {
  const x0 = cx - sx / 2,
    x1 = cx + sx / 2,
    z0 = cz - sz / 2,
    z1 = cz + sz / 2,
    y1 = y0 + sy;
  const quad = (p: number[][], n: [number, number, number]) => {
    const i = p.map(([x, y, z]) => mb.vertex(x!, y!, z!, n[0], n[1], n[2], col));
    mb.indices.push(i[0]!, i[1]!, i[2]!, i[0]!, i[2]!, i[3]!);
  };
  quad(
    [
      [x0, y1, z0],
      [x0, y1, z1],
      [x1, y1, z1],
      [x1, y1, z0],
    ],
    [0, 1, 0],
  );
  quad(
    [
      [x0, y0, z1],
      [x1, y0, z1],
      [x1, y1, z1],
      [x0, y1, z1],
    ],
    [0, 0, 1],
  );
  quad(
    [
      [x1, y0, z0],
      [x0, y0, z0],
      [x0, y1, z0],
      [x1, y1, z0],
    ],
    [0, 0, -1],
  );
  quad(
    [
      [x1, y0, z1],
      [x1, y0, z0],
      [x1, y1, z0],
      [x1, y1, z1],
    ],
    [1, 0, 0],
  );
  quad(
    [
      [x0, y0, z0],
      [x0, y0, z1],
      [x0, y1, z1],
      [x0, y1, z0],
    ],
    [-1, 0, 0],
  );
}

/** Стены многоугольника от y0 до y1 (UV: u — метры/4, v — этажи от земли). */
function addWalls(
  walls: MeshBuilder,
  pts: P[],
  y0: number,
  y1: number,
  col: [number, number, number],
) {
  let u = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i]!,
      [x2, z2] = pts[(i + 1) % pts.length]!;
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 0.01) continue;
    // Наружная нормаль для обхода против часовой: (dz, -dx)
    const nx = (z2 - z1) / len,
      nz = -(x2 - x1) / len;
    const u2 = u + len / 4;
    const a = walls.vertex(x1, y0, z1, nx, 0, nz, col, u, y0 / 3.2);
    const b = walls.vertex(x2, y0, z2, nx, 0, nz, col, u2, y0 / 3.2);
    const c = walls.vertex(x2, y1, z2, nx, 0, nz, col, u2, y1 / 3.2);
    const d = walls.vertex(x1, y1, z1, nx, 0, nz, col, u, y1 / 3.2);
    walls.indices.push(a, c, b, a, d, c);
    u = u2;
  }
}

function addRoof(roofs: MeshBuilder, pts: P[], h: number, col: [number, number, number]) {
  const tri = triangulate(pts);
  const start = roofs.positions.length / 3;
  for (const [x, z] of pts) roofs.vertex(x, h, z, 0, 1, 0, col);
  for (let i = 0; i < tri.length; i += 3)
    roofs.indices.push(start + tri[i]!, start + tri[i + 2]!, start + tri[i + 1]!);
}

/** Цвета подсветки витрин (тёплый свет, неон). */
const SHOP_TINTS: [number, number, number][] = [
  [1, 0.85, 0.6],
  [1, 0.95, 0.85],
  [0.6, 0.9, 1],
  [1, 0.5, 0.8],
  [0.7, 1, 0.6],
  [1, 0.75, 0.4],
];

/**
 * Здание: стены с UV под сетку окон, плоская крыша; у высоток — ступенчатая верхушка,
 * на крышах — технические надстройки, на первом этаже — светящиеся витрины.
 */
function addBuilding(
  walls: MeshBuilder,
  roofs: MeshBuilder,
  shops: MeshBuilder,
  fp: P[],
  h: number,
  seed: number,
  style: 'moscow' | 'tokyo' = 'moscow',
) {
  const pts = polygonArea(fp) < 0 ? fp.slice().reverse() : fp; // против часовой (в плоскости x,z)
  const pal = style === 'tokyo' ? FACADES_TOKYO : FACADES_MOSCOW;
  const base = pal[Math.floor(hash(seed) * pal.length)]!;
  const shade = 0.85 + hash(seed + 7) * 0.2;
  const col: [number, number, number] = [base[0] * shade, base[1] * shade, base[2] * shade];
  const roofCol: [number, number, number] = [0.22, 0.23, 0.26];
  const [cx, cz] = centroid(pts);
  // Ступенчатая верхушка: верхние 20 % — уменьшенный контур
  const tiered = h > 36 && hash(seed + 3) < 0.5;
  const hBase = tiered ? Math.round((h * 0.8) / 3.2) * 3.2 : h;
  addWalls(walls, pts, 0, hBase, col);
  addRoof(roofs, pts, hBase, roofCol);
  let topPts = pts;
  let hTop = hBase;
  if (tiered) {
    const k = 0.72;
    topPts = pts.map(([x, z]) => [cx + (x - cx) * k, cz + (z - cz) * k] as P);
    addWalls(walls, topPts, hBase, h, col);
    addRoof(roofs, topPts, h, roofCol);
    hTop = h;
  }
  // Надстройки на крыше (вентиляция, лифтовые)
  const box = orientedBox(topPts);
  const units = 1 + Math.floor(hash(seed + 11) * 3);
  for (let n = 0; n < units; n++) {
    const ox = (hash(seed + 20 + n) - 0.5) * box.hx * 0.8;
    const oz = (hash(seed + 30 + n) - 0.5) * box.hz * 0.8;
    const c = Math.cos(box.yaw),
      sn = Math.sin(box.yaw);
    const sz = 2 + hash(seed + 40 + n) * 3;
    addBox(
      roofs,
      box.cx + ox * c + oz * sn,
      hTop,
      box.cz - ox * sn + oz * c,
      sz,
      1.2 + hash(seed + 50 + n) * 2.2,
      sz * 0.8,
      [0.3, 0.31, 0.34],
    );
  }
  // Витрины первого этажа на длинных фасадах
  if (h > 6) {
    for (let i = 0; i < pts.length; i++) {
      const [x1, z1] = pts[i]!,
        [x2, z2] = pts[(i + 1) % pts.length]!;
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 5 || hash(seed + 60 + i) < 0.35) continue;
      const nx = (z2 - z1) / len,
        nz = -(x2 - x1) / len;
      const o = 0.08;
      const tint = SHOP_TINTS[Math.floor(hash(seed + 70 + i) * SHOP_TINTS.length)]!;
      const a = shops.vertex(x1 + nx * o, 0.3, z1 + nz * o, nx, 0, nz, tint, 0, 0);
      const b = shops.vertex(x2 + nx * o, 0.3, z2 + nz * o, nx, 0, nz, tint, len / 6, 0);
      const c = shops.vertex(x2 + nx * o, 3.6, z2 + nz * o, nx, 0, nz, tint, len / 6, 1);
      const d = shops.vertex(x1 + nx * o, 3.6, z1 + nz * o, nx, 0, nz, tint, 0, 1);
      shops.indices.push(a, c, b, a, d, c);
    }
  }
}

/** Коллайдеры здания: почти прямоугольное → один ориентированный бокс, иначе — стенки по рёбрам. */
export function buildingColliders(fp: P[], h: number): CityTile['colliders'] {
  const box = orientedBox(fp);
  const area = Math.abs(polygonArea(fp));
  if (area / (4 * box.hx * box.hz) > 0.85) return [[box.cx, box.cz, box.hx, box.hz, box.yaw, h]];
  const out: CityTile['colliders'] = [];
  for (let i = 0; i < fp.length; i++) {
    const [x1, z1] = fp[i]!,
      [x2, z2] = fp[(i + 1) % fp.length]!;
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 0.5) continue;
    out.push([(x1 + x2) / 2, (z1 + z2) / 2, 0.5, len / 2, Math.atan2(x2 - x1, z2 - z1), h]);
  }
  return out;
}

export function buildCity(
  rawRoads: RawRoad[],
  rawBuildings: RawBuilding[],
  opt: BuildOptions,
): BuildResult {
  const size = opt.blockSize ?? BLOCK_SIZE;
  const half = opt.half;
  const roads: CityRoad[] = [];
  for (const r of rawRoads) {
    const width = r.lanes > 0 ? Math.max(6, r.lanes * 3.3) : (ROAD_WIDTH[r.cls] ?? 8);
    for (const part of clipPolyline(r.points, half)) {
      const pts = simplify(part, 1.2).map(
        ([x, z]) => [Math.round(x * 100) / 100, Math.round(z * 100) / 100] as P,
      );
      if (pts.length >= 2)
        roads.push({ id: r.id, cls: r.cls, name: r.name, width, oneway: r.oneway, points: pts });
    }
  }
  // Коридоры трасс: здания, залезающие на трассу (сплайн срезает углы), убираем
  const corridor: { x: number; z: number; r: number }[] = [];
  for (const t of opt.tracks ?? []) {
    const bt = buildTrack(t);
    for (let i = 0; i < bt.samples.length; i += 2) {
      const sm = bt.samples[i]!;
      corridor.push({ x: sm.x, z: sm.z, r: sm.width / 2 + 3 });
    }
  }
  const onTrack = (fp: P[]) =>
    corridor.some((c) => {
      for (const [x, z] of fp) if (Math.hypot(x - c.x, z - c.z) < c.r) return true;
      const [cx, cz] = centroid(fp);
      return Math.hypot(cx - c.x, cz - c.z) < c.r;
    });
  // Ориентиры: место на карте и зона, свободная от домов
  const landmarks = opt.modules ? placeLandmarks(opt.modules, opt.id, roads) : [];
  const inClear = (fp: P[]) =>
    landmarks.some(({ clear: q }) => {
      const c = Math.cos(q.yaw),
        s = Math.sin(q.yaw);
      return fp.some(([x, z]) => {
        const u = (x - q.x) * c - (z - q.z) * s,
          v = (x - q.x) * s + (z - q.z) * c;
        return Math.abs(u) < q.hx && Math.abs(v) < q.hz;
      });
    });
  const buildings = rawBuildings.filter((b) => {
    const c = centroid(b.footprint);
    return (
      !inClear(b.footprint) &&
      Math.abs(c[0]) <= half &&
      Math.abs(c[1]) <= half &&
      Math.abs(polygonArea(b.footprint)) > 12 &&
      !onTrack(b.footprint)
    );
  });

  // Раскладка по блокам 256×256 м
  type Tile = {
    walls: MeshBuilder;
    roofs: MeshBuilder;
    roads: MeshBuilder;
    shops: MeshBuilder;
    colliders: CityTile['colliders'];
    buildings: number;
    instances: Instance[];
  };
  const tiles = new Map<string, Tile & { i: number; j: number }>();
  const tileAt = (x: number, z: number) => {
    const i = Math.floor(x / size),
      j = Math.floor(z / size);
    const k = `${i}_${j}`;
    let t = tiles.get(k);
    if (!t) {
      t = {
        i,
        j,
        walls: new MeshBuilder(),
        shops: new MeshBuilder(),
        roofs: new MeshBuilder(),
        roads: new MeshBuilder(),
        colliders: [],
        buildings: 0,
        instances: [],
      };
      tiles.set(k, t);
    }
    return t;
  };
  const roadColor: [number, number, number] = [0.16, 0.165, 0.18];
  for (const r of roads) {
    // Сегменты в блок по середине ломаной-участка; длинные дороги режем по блокам
    let cur: P[] = [r.points[0]!];
    let curTile = tileAt(r.points[0]![0], r.points[0]![1]);
    for (let k = 1; k < r.points.length; k++) {
      const p = r.points[k]!;
      cur.push(p);
      const t = tileAt(p[0], p[1]);
      if (t !== curTile || k === r.points.length - 1) {
        addRoad(curTile.roads, cur, r.width, 0.03 + (ROAD_RANK[r.cls] ?? 1) * 0.003, roadColor);
        cur = [p];
        curTile = t;
      }
    }
  }
  for (const b of buildings) {
    const c = centroid(b.footprint);
    const t = tileAt(c[0], c[1]);
    const inst = opt.modules ? placeModules(b.footprint, b.height, b.id, opt.modules) : [];
    if (inst.length) t.instances.push(...inst);
    else addBuilding(t.walls, t.roofs, t.shops, b.footprint, b.height, b.id, opt.style);
    t.colliders.push(...buildingColliders(b.footprint, b.height));
    t.buildings++;
  }

  for (const l of landmarks) tileAt(l.x, l.z).colliders.push(...l.colliders);
  // Реквизит вдоль улиц — экземпляры тех же модулей (без коллайдеров: стоит на тротуаре)
  if (opt.modules)
    for (const p of placeProps(opt.modules, roads)) tileAt(p[1], p[2]).instances.push(p);

  const files = new Map<string, Uint8Array>();
  const cityTiles: CityTile[] = [];
  const round = (v: number) => Math.round(v * 100) / 100;
  for (const t of tiles.values()) {
    const prims: Primitive[] = [
      { ...t.roads, material: { name: 'road', color: [1, 1, 1, 1], roughness: 0.85 } },
      { ...t.walls, material: { name: 'facade', color: [1, 1, 1, 1], roughness: 0.9 } },
      { ...t.roofs, material: { name: 'roof', color: [1, 1, 1, 1], roughness: 0.95 } },
      {
        ...t.shops,
        material: { name: 'shop', color: [1, 1, 1, 1], emissive: [1, 1, 1], roughness: 0.5 },
      },
    ];
    const file = `tiles/${t.i}_${t.j}.glb`;
    files.set(file, writeGlb(prims));
    cityTiles.push({
      i: t.i,
      j: t.j,
      file,
      buildings: t.buildings,
      colliders: t.colliders.map((c) => c.map(round) as CityTile['colliders'][number]),
      instances: t.instances,
    });
  }
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const r of roads)
    for (const [x, z] of r.points) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
  const city: City = {
    id: opt.id,
    name: opt.name,
    attribution: opt.attribution ?? OSM_ATTRIBUTION,
    origin: opt.origin,
    bounds: { minX, maxX, minZ, maxZ },
    blockSize: size,
    roads,
    tiles: cityTiles.sort((a, b) => a.j - b.j || a.i - b.i),
    tracks: opt.tracks ?? [],
    style: opt.style ?? 'moscow',
    ...(opt.modules ? { kit: opt.modules.kit } : {}),
    modules: opt.modules ? opt.modules.modules.map((m) => m.id) : [],
    landmarks: landmarks.map(({ id, x, z, yaw }) => ({
      id,
      x: Math.round(x * 100) / 100,
      z: Math.round(z * 100) / 100,
      yaw: Math.round(yaw * 1000) / 1000,
    })),
  };
  return { city, files };
}
