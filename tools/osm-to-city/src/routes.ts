/**
 * Трассы по реальным улицам (PLAN_V2 10.2): кольцо, спринт и дрифт из графа крупных улиц OSM.
 *
 * Граф: узлы — общие точки ломаных (перекрёстки), рёбра — участки улиц primary/secondary/
 * tertiary/trunk; тупики отрезаются. Кольцо и дрифт — грани плоского графа (квартал,
 * обходимый по улицам): обход «всегда самый правый поворот». Спринт — кратчайший путь
 * (Дейкстра) между удалёнными перекрёстками.
 */
import type { TrackDef } from '@sr/shared';
import type { P } from './geom';
import type { RawRoad } from './osm';

const MAJOR = new Set(['trunk', 'primary', 'secondary', 'tertiary']);

interface Graph {
  pts: P[];
  adj: Map<number, Set<number>>;
}

export function buildGraph(roads: RawRoad[], half: number): Graph {
  const key = (p: P) => `${Math.round(p[0] * 2)}_${Math.round(p[1] * 2)}`;
  const ids = new Map<string, number>();
  const pts: P[] = [];
  const adj = new Map<number, Set<number>>();
  const id = (p: P) => {
    const k = key(p);
    let i = ids.get(k);
    if (i === undefined) {
      i = pts.length;
      ids.set(k, i);
      pts.push(p);
      adj.set(i, new Set());
    }
    return i;
  };
  for (const r of roads) {
    if (!MAJOR.has(r.cls)) continue;
    for (let k = 1; k < r.points.length; k++) {
      const a = r.points[k - 1]!,
        b = r.points[k]!;
      if (Math.max(Math.abs(a[0]), Math.abs(a[1]), Math.abs(b[0]), Math.abs(b[1])) > half * 0.92)
        continue;
      const ia = id(a),
        ib = id(b);
      if (ia === ib) continue;
      adj.get(ia)!.add(ib);
      adj.get(ib)!.add(ia);
    }
  }
  // Тупики (и хвосты за краем района) — прочь
  let changed = true;
  while (changed) {
    changed = false;
    for (const [i, n] of adj)
      if (n.size === 1) {
        for (const j of n) adj.get(j)!.delete(i);
        adj.delete(i);
        changed = true;
      } else if (n.size === 0) adj.delete(i);
  }
  return { pts, adj };
}

const len = (pts: P[], closed: boolean) => {
  let s = 0;
  for (let i = 1; i < pts.length; i++)
    s += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  if (closed && pts.length > 1)
    s += Math.hypot(pts[0]![0] - pts[pts.length - 1]![0], pts[0]![1] - pts[pts.length - 1]![1]);
  return s;
};

const area = (pts: P[]) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i]!,
      [x2, z2] = pts[(i + 1) % pts.length]!;
    a += x1 * z2 - x2 * z1;
  }
  return a / 2;
};

/** Грани плоского графа (замкнутые обходы кварталов). */
export function faces(g: Graph): number[][] {
  const used = new Set<string>();
  const out: number[][] = [];
  const angle = (a: number, b: number) =>
    Math.atan2(g.pts[b]![1] - g.pts[a]![1], g.pts[b]![0] - g.pts[a]![0]);
  for (const [u, ns] of g.adj)
    for (const v of ns) {
      if (used.has(`${u}>${v}`)) continue;
      const face: number[] = [];
      let a = u,
        b = v;
      for (let guard = 0; guard < 400; guard++) {
        used.add(`${a}>${b}`);
        face.push(a);
        // следующее ребро из b: ближайшее по часовой от обратного направления (b→a)
        const back = angle(b, a);
        let best = -1,
          bestTurn = Infinity;
        for (const w of g.adj.get(b) ?? []) {
          if (w === a && (g.adj.get(b)?.size ?? 0) > 1) continue;
          let t = angle(b, w) - back;
          while (t <= 0) t += 2 * Math.PI;
          if (t < bestTurn) [best, bestTurn] = [w, t];
        }
        if (best < 0) break;
        a = b;
        b = best;
        if (a === u && b === v) {
          out.push(face);
          break;
        }
      }
    }
  return out;
}

function dijkstra(g: Graph, src: number): Map<number, { d: number; prev: number }> {
  const res = new Map<number, { d: number; prev: number }>([[src, { d: 0, prev: -1 }]]);
  const open = new Set([src]);
  while (open.size) {
    let u = -1,
      du = Infinity;
    for (const i of open) if (res.get(i)!.d < du) [u, du] = [i, res.get(i)!.d];
    open.delete(u);
    for (const v of g.adj.get(u) ?? []) {
      const d = du + Math.hypot(g.pts[v]![0] - g.pts[u]![0], g.pts[v]![1] - g.pts[u]![1]);
      if (d < (res.get(v)?.d ?? Infinity)) {
        res.set(v, { d, prev: u });
        open.add(v);
      }
    }
  }
  return res;
}

/** Ломаная → точки сплайна через ~step м. */
function resample(pts: P[], closed: boolean, step = 14): P[] {
  const src = closed ? [...pts, pts[0]!] : pts;
  const out: P[] = [src[0]!];
  let carry = 0;
  for (let i = 1; i < src.length; i++) {
    const [ax, az] = src[i - 1]!,
      [bx, bz] = src[i]!;
    const l = Math.hypot(bx - ax, bz - az);
    let t = step - carry;
    while (t < l) {
      out.push([ax + ((bx - ax) * t) / l, az + ((bz - az) * t) / l]);
      t += step;
    }
    carry = l - (t - step);
  }
  if (!closed) out.push(src[src.length - 1]!);
  else if (
    Math.hypot(out[out.length - 1]![0] - out[0]![0], out[out.length - 1]![1] - out[0]![1]) <
    step / 2
  )
    out.pop();
  return out;
}

/** Кольцо, спринт и дрифт по улицам района; prefix — msk / tyo. */
export function autoTracks(roads: RawRoad[], half: number, prefix: string, width = 14): TrackDef[] {
  const g = buildGraph(roads, half);
  const loops = faces(g)
    .map((f) => f.map((i) => g.pts[i]!))
    .filter((f) => area(f) < 0 && new Set(f.map(String)).size === f.length) // внутренние грани (в осях x, z обход по часовой — площадь < 0), без возвратов
    .map((f) => {
      const L = len(f, true);
      const [cx, cz] = f.reduce(([a, b], [x, z]) => [a + x / f.length, b + z / f.length], [0, 0]);
      return { f, L, compact: (4 * Math.PI * -area(f)) / (L * L), center: Math.hypot(cx, cz) };
    });
  const pick = (lo: number, hi: number, exclude?: P[]) =>
    loops
      .filter((l) => l.L >= lo && l.L <= hi && l.f !== exclude)
      .sort((a, b) => b.compact - b.center / 4000 - (a.compact - a.center / 4000))[0]?.f;
  const ring = pick(1600, 4500) ?? pick(1000, 6000);
  const drift = pick(600, 1500, ring) ?? pick(400, 2000, ring);
  // Спринт: от узла, дальнего от центра, до самого далёкого по прямой при пути 1,5–3 км
  const nodes = [...g.adj.keys()];
  const far = nodes.sort((a, b) => Math.hypot(...g.pts[b]!) - Math.hypot(...g.pts[a]!))[0];
  let sprint: P[] | undefined;
  if (far !== undefined) {
    const dj = dijkstra(g, far);
    let best = -1,
      bestD = -1;
    for (const [v, { d }] of dj)
      if (d >= 1500 && d <= 3000) {
        const e = Math.hypot(g.pts[v]![0] - g.pts[far]![0], g.pts[v]![1] - g.pts[far]![1]);
        if (e > bestD) [best, bestD] = [v, e];
      }
    if (best >= 0) {
      const path: P[] = [];
      for (let v = best; v >= 0; v = dj.get(v)!.prev) path.push(g.pts[v]!);
      sprint = path.reverse();
    }
  }
  const base = {
    walls: false,
    wallOffset: 0,
    ramps: [],
    groundSize: half * 2.4,
    defaultWidth: width,
  };
  const pts = (p: P[], closed: boolean) =>
    resample(p, closed).map(
      ([x, z]) =>
        [Math.round(x * 10) / 10, Math.round(z * 10) / 10, width] as [number, number, number],
    );
  const out: TrackDef[] = [];
  if (ring)
    out.push({
      ...base,
      id: `${prefix}_ring`,
      name: 'Кольцо по улицам',
      type: 'circuit',
      laps: 3,
      closed: true,
      checkpointSpacing: 120,
      startS: 0,
      points: pts(ring, true),
    });
  if (sprint)
    out.push({
      ...base,
      id: `${prefix}_sprint`,
      name: 'Спринт через район',
      type: 'sprint',
      laps: 1,
      closed: false,
      checkpointSpacing: 150,
      startS: 40,
      points: pts(sprint, false),
    });
  if (drift)
    out.push({
      ...base,
      id: `${prefix}_drift`,
      name: 'Дрифт вокруг квартала',
      type: 'drift',
      laps: 3,
      closed: true,
      checkpointSpacing: 100,
      startS: 0,
      points: pts(drift, true),
    });
  return out;
}
