export type P = [number, number];

/** Упрощение ломаной (Дуглас–Пекер). */
export function simplify(pts: P[], eps: number): P[] {
  if (pts.length <= 2) return pts.slice();
  // Замкнутая ломаная: концы совпадают — делим на две половины по самой дальней точке
  const f = pts[0]!,
    l = pts[pts.length - 1]!;
  if (Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-6) {
    let far = 1;
    let farD = -1;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.hypot(pts[i]![0] - f[0], pts[i]![1] - f[1]);
      if (d > farD) {
        farD = d;
        far = i;
      }
    }
    if (far <= 0 || far >= pts.length - 1) return pts.slice();
    const a = simplify(pts.slice(0, far + 1), eps);
    const b = simplify(pts.slice(far), eps);
    return [...a, ...b.slice(1)];
  }
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, az] = pts[a]!,
      [bx, bz] = pts[b]!;
    const dx = bx - ax,
      dz = bz - az;
    const L = Math.hypot(dx, dz) || 1;
    let best = -1,
      bestD = eps;
    for (let i = a + 1; i < b; i++) {
      const [px, pz] = pts[i]!;
      const d = Math.abs((px - ax) * dz - (pz - az) * dx) / L;
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

export function polygonArea(pts: P[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i]!,
      [x2, z2] = pts[(i + 1) % pts.length]!;
    s += x1 * z2 - x2 * z1;
  }
  return s / 2;
}

export function centroid(pts: P[]): P {
  let x = 0,
    z = 0;
  for (const p of pts) {
    x += p[0];
    z += p[1];
  }
  return [x / pts.length, z / pts.length];
}

/** Ориентированный прямоугольник минимальной площади (перебор направлений рёбер). */
export function orientedBox(pts: P[]): {
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  yaw: number;
} {
  let best = { area: Infinity, cx: 0, cz: 0, hx: 0, hz: 0, yaw: 0 };
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i]!,
      [x2, z2] = pts[(i + 1) % pts.length]!;
    const a = Math.atan2(x2 - x1, z2 - z1);
    const c = Math.cos(a),
      s = Math.sin(a);
    let minU = Infinity,
      maxU = -Infinity,
      minV = Infinity,
      maxV = -Infinity;
    for (const [x, z] of pts) {
      // u — вдоль локальной X, v — вдоль локальной Z (поворот на yaw = a)
      const u = x * c - z * s;
      const v = x * s + z * c;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < best.area) {
      const u = (minU + maxU) / 2,
        v = (minV + maxV) / 2;
      best = {
        area,
        cx: u * c + v * s,
        cz: -u * s + v * c,
        hx: (maxU - minU) / 2,
        hz: (maxV - minV) / 2,
        yaw: a,
      };
    }
  }
  return { cx: best.cx, cz: best.cz, hx: best.hx, hz: best.hz, yaw: best.yaw };
}

/** Триангуляция простого многоугольника ушной обрезкой (индексы). */
export function triangulate(pts: P[]): number[] {
  const n = pts.length;
  if (n < 3) return [];
  const idx = [...Array(n).keys()];
  if (polygonArea(pts) < 0) idx.reverse();
  const out: number[] = [];
  const cross = (a: P, b: P, c: P) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (p: P, a: P, b: P, c: P) =>
    cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length]!,
        ib = idx[i]!,
        ic = idx[(i + 1) % idx.length]!;
      const a = pts[ia]!,
        b = pts[ib]!,
        c = pts[ic]!;
      if (cross(a, b, c) <= 1e-9) continue;
      let ok = true;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        if (inside(pts[j]!, a, b, c)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      out.push(ia, ib, ic);
      idx.splice(i, 1);
      cut = true;
      break;
    }
    if (!cut) break; // вырожденный многоугольник — остаток отбрасываем
  }
  if (idx.length === 3) out.push(idx[0]!, idx[1]!, idx[2]!);
  return out;
}
