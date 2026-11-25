import type { TrackDef } from './schema';

export interface TrackSample {
  x: number;
  z: number;
  /** Касательная (единичная). */
  tx: number;
  tz: number;
  width: number;
  /** Дистанция от начала, м. */
  s: number;
  /** Кривизна, 1/м (знак: + поворот вправо). */
  k: number;
}

export interface Checkpoint {
  index: number;
  x: number;
  z: number;
  tx: number;
  tz: number;
  halfWidth: number;
  s: number;
}

export interface GridSlot {
  x: number;
  z: number;
  /** Угол рыскания: машина смотрит вдоль −Z локально; yaw — поворот вокруг Y. */
  yaw: number;
}

export interface BuiltTrack {
  def: TrackDef;
  samples: TrackSample[];
  length: number;
  checkpoints: Checkpoint[];
  grid: GridSlot[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

const STEP = 2;

type P = [number, number, number];

function catmull(p0: P, p1: P, p2: P, p3: P, t: number): P {
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return [
    f(p0[0], p1[0], p2[0], p3[0]),
    f(p0[1], p1[1], p2[1], p3[1]),
    f(p0[2], p1[2], p2[2], p3[2]),
  ];
}

/** Строит дискретную осевую линию с шагом ~2 м, чекпоинты и стартовую решётку. */
export function buildTrack(def: TrackDef): BuiltTrack {
  const pts: P[] = def.points.map((p) => [p[0], p[1], p[2] ?? def.defaultWidth]);
  const n = pts.length;
  const get = (i: number): P => {
    if (def.closed) return pts[((i % n) + n) % n]!;
    if (i < 0) {
      const a = pts[0]!,
        b = pts[1]!;
      return [2 * a[0] - b[0], 2 * a[1] - b[1], a[2]];
    }
    if (i >= n) {
      const a = pts[n - 1]!,
        b = pts[n - 2]!;
      return [2 * a[0] - b[0], 2 * a[1] - b[1], a[2]];
    }
    return pts[i]!;
  };
  // Плотная выборка сплайна
  const dense: P[] = [];
  const segs = def.closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1),
      p1 = get(i),
      p2 = get(i + 1),
      p3 = get(i + 2);
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const m = Math.max(4, Math.ceil(len / 0.5));
    for (let j = 0; j < m; j++) dense.push(catmull(p0, p1, p2, p3, j / m));
  }
  if (!def.closed) dense.push(get(n - 1));
  else dense.push(dense[0]!);

  // Пересэмплирование по длине дуги
  const out: { x: number; z: number; w: number; s: number }[] = [];
  let acc = 0;
  let nextS = 0;
  for (let i = 0; i < dense.length - 1; i++) {
    const a = dense[i]!,
      b = dense[i + 1]!;
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (nextS <= acc + d) {
      const t = d > 0 ? (nextS - acc) / d : 0;
      out.push({
        x: a[0] + (b[0] - a[0]) * t,
        z: a[1] + (b[1] - a[1]) * t,
        w: a[2] + (b[2] - a[2]) * t,
        s: nextS,
      });
      nextS += STEP;
    }
    acc += d;
  }
  const length = acc;
  if (def.closed && length - out[out.length - 1]!.s < STEP * 0.5) out.pop();

  const N = out.length;
  const samples: TrackSample[] = out.map((p, i) => {
    const prev = out[def.closed ? (i - 1 + N) % N : Math.max(0, i - 1)]!;
    const next = out[def.closed ? (i + 1) % N : Math.min(N - 1, i + 1)]!;
    const dx = next.x - prev.x,
      dz = next.z - prev.z;
    const l = Math.hypot(dx, dz) || 1;
    return { x: p.x, z: p.z, tx: dx / l, tz: dz / l, width: p.w, s: p.s, k: 0 };
  });
  for (let i = 0; i < N; i++) {
    const a = samples[def.closed ? (i - 2 + N) % N : Math.max(0, i - 2)]!;
    const b = samples[def.closed ? (i + 2) % N : Math.min(N - 1, i + 2)]!;
    const cross = a.tx * b.tz - a.tz * b.tx;
    const dot = a.tx * b.tx + a.tz * b.tz;
    const ang = Math.atan2(cross, dot);
    samples[i]!.k = ang / (STEP * 4);
  }

  // Чекпоинты: равномерно, последний — финиш (s = startS)
  const startIdx = Math.round(def.startS / STEP) % N;
  const usable = def.closed ? length : length - def.startS;
  const count = Math.max(2, Math.round(usable / def.checkpointSpacing));
  const checkpoints: Checkpoint[] = [];
  for (let c = 1; c <= count; c++) {
    const idx = def.closed
      ? (startIdx + Math.round(((c / count) * length) / STEP)) % N
      : Math.min(N - 1, startIdx + Math.round(((c / count) * usable) / STEP));
    const sm = samples[idx]!;
    checkpoints.push({
      index: c - 1,
      x: sm.x,
      z: sm.z,
      tx: sm.tx,
      tz: sm.tz,
      halfWidth: sm.width / 2 + def.wallOffset + 2,
      s: sm.s,
    });
  }

  // Стартовая решётка: 2 в ряд, ряды по 8 м назад от старта
  const grid: GridSlot[] = [];
  for (let i = 0; i < 8; i++) {
    const back = 10 + Math.floor(i / 2) * 9 + (i % 2) * 3;
    const si = def.closed
      ? (startIdx - Math.round(back / STEP) + N * 4) % N
      : Math.max(0, startIdx - Math.round(back / STEP));
    const sm = samples[si]!;
    const side = i % 2 === 0 ? -1 : 1;
    const nx = -sm.tz,
      nz = sm.tx; // нормаль вправо
    const off = side * sm.width * 0.22;
    grid.push({ x: sm.x + nx * off, z: sm.z + nz * off, yaw: Math.atan2(-sm.tx, -sm.tz) });
  }

  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const s of samples) {
    minX = Math.min(minX, s.x);
    maxX = Math.max(maxX, s.x);
    minZ = Math.min(minZ, s.z);
    maxZ = Math.max(maxZ, s.z);
  }

  return { def, samples, length, checkpoints, grid, bounds: { minX, maxX, minZ, maxZ } };
}

/** Ближайший сэмпл; hint — индекс с прошлого шага (локальный поиск). */
export function nearestSample(t: BuiltTrack, x: number, z: number, hint = -1): number {
  const N = t.samples.length;
  let best = -1;
  let bestD = Infinity;
  if (hint >= 0) {
    for (let d = -25; d <= 25; d++) {
      const i = t.def.closed ? (hint + d + N) % N : Math.min(N - 1, Math.max(0, hint + d));
      const s = t.samples[i]!;
      const dd = (s.x - x) ** 2 + (s.z - z) ** 2;
      if (dd < bestD) {
        bestD = dd;
        best = i;
      }
    }
    const s = t.samples[best]!;
    if (bestD < (s.width * 1.5) ** 2) return best;
  }
  for (let i = 0; i < N; i++) {
    const s = t.samples[i]!;
    const dd = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (dd < bestD) {
      bestD = dd;
      best = i;
    }
  }
  return best;
}

/** Боковое смещение точки от осевой (+ вправо) и продольная дистанция трассы. */
export function trackCoords(
  t: BuiltTrack,
  x: number,
  z: number,
  hint = -1,
): { i: number; lateral: number; s: number } {
  const i = nearestSample(t, x, z, hint);
  const sm = t.samples[i]!;
  const dx = x - sm.x,
    dz = z - sm.z;
  const along = dx * sm.tx + dz * sm.tz;
  const lateral = dx * -sm.tz + dz * sm.tx;
  let s = sm.s + along;
  if (t.def.closed) s = ((s % t.length) + t.length) % t.length;
  return { i, lateral, s };
}

/** Точка на осевой по дистанции. */
export function sampleAt(t: BuiltTrack, s: number): TrackSample {
  const N = t.samples.length;
  const ss = t.def.closed
    ? ((s % t.length) + t.length) % t.length
    : Math.min(Math.max(0, s), t.length);
  const i = Math.min(N - 1, Math.floor(ss / STEP));
  return t.samples[i]!;
}

export const TRACK_SAMPLE_STEP = STEP;
