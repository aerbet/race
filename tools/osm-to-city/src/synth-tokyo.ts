import type { TrackDef } from '@sr/shared';
import type { OverpassJson } from './osm';
import type { P } from './geom';

/** Сетка: проспекты каждые 320 м, улицы каждые 80 м. */
const AVE = 320;
const STREET = 80;

/**
 * Процедурный неоновый квартал «по мотивам Токио» (вымышленный, собственные данные):
 * плотная сетка проспектов и узких улиц, высокие узкие здания.
 */
export function synthTokyo(seed = 7, half = 760, lat0 = 35.68, lon0 = 139.76): OverpassJson {
  let s = seed >>> 0 || 1;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const R = 6378137;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const toLL = ([x, z]: P) => ({
    lat: lat0 - ((z / R) * 180) / Math.PI,
    lon: lon0 + ((x / (R * k)) * 180) / Math.PI,
  });
  const elements: OverpassJson['elements'] = [];
  let nid = 1;
  let wid = 1;
  const addWay = (pts: P[], tags: Record<string, string>) => {
    const ids: number[] = [];
    for (const p of pts) {
      const ll = toLL(p);
      elements.push({ type: 'node', id: nid, lat: ll.lat, lon: ll.lon });
      ids.push(nid++);
    }
    elements.push({ type: 'way', id: wid++, nodes: ids, tags });
  };
  const lines: { x?: number; z?: number; w: number }[] = [];
  const n = Math.floor(half / STREET);
  for (let i = -n; i <= n; i++) {
    const c = i * STREET;
    const ave = i % (AVE / STREET) === 0;
    const w = ave ? 18 : 7;
    const cls = ave ? 'primary' : 'residential';
    addWay(
      [
        [c, -half],
        [c, half],
      ],
      {
        highway: cls,
        name: ave ? `${i / 4 + 5}-й проспект` : `Переулок ${i + n + 1}`,
        ...(ave ? { lanes: '5' } : {}),
      },
    );
    addWay(
      [
        [-half, c],
        [half, c],
      ],
      {
        highway: cls,
        name: ave ? `Улица ${i / 4 + 5}` : `Проезд ${i + n + 1}`,
        ...(ave ? { lanes: '5' } : {}),
      },
    );
    lines.push({ x: c, w }, { z: c, w });
  }
  const halfW = (c: number, axis: 'x' | 'z') => {
    const l = lines.find((q) => q[axis] === c);
    return (l?.w ?? 7) / 2;
  };
  // Застройка: в каждом квартале 80×80 — здания по периметру, двор в центре
  for (let i = -n; i < n; i++) {
    for (let j = -n; j < n; j++) {
      const x0 = i * STREET + halfW(i * STREET, 'x') + 4;
      const x1 = (i + 1) * STREET - halfW((i + 1) * STREET, 'x') - 4;
      const z0 = j * STREET + halfW(j * STREET, 'z') + 4;
      const z1 = (j + 1) * STREET - halfW((j + 1) * STREET, 'z') - 4;
      if (x1 - x0 < 12 || z1 - z0 < 12) continue;
      const nearAve =
        [x0, x1].some((x) => Math.abs(x) % AVE < 30) ||
        [z0, z1].some((z) => Math.abs(z) % AVE < 30);
      // Северная и южная стороны — нарезка по 10–22 м
      for (const side of [0, 1]) {
        let x = x0;
        while (x < x1 - 8) {
          const w = Math.min(x1 - x, 10 + rnd() * 12);
          const d = 12 + rnd() * 10;
          const zA = side === 0 ? z0 : z1 - d;
          const floors = nearAve ? 10 + Math.floor(rnd() * 22) : 5 + Math.floor(rnd() * 10);
          if (rnd() > 0.08) {
            const pts: P[] = [
              [x, zA],
              [x + w, zA],
              [x + w, zA + d],
              [x, zA + d],
            ];
            addWay([...pts, pts[0]!], { building: 'yes', 'building:levels': String(floors) });
          }
          x += w + 1.5 + rnd() * 2;
        }
      }
      // Восточная и западная — между ними
      for (const side of [0, 1]) {
        let z = z0 + 24;
        while (z < z1 - 30) {
          const w = Math.min(z1 - 24 - z, 10 + rnd() * 10);
          const d = 12 + rnd() * 8;
          const xA = side === 0 ? x0 : x1 - d;
          if (w > 6) {
            const pts: P[] = [
              [xA, z],
              [xA + d, z],
              [xA + d, z + w],
              [xA, z + w],
            ];
            addWay([...pts, pts[0]!], {
              building: 'yes',
              'building:levels': String(6 + Math.floor(rnd() * 14)),
            });
          }
          z += w + 2;
        }
      }
    }
  }
  return { elements };
}

/**
 * Ломаная по проспектам → точки сплайна со скруглёнными углами (дуга радиуса r, 4 точки),
 * чтобы повороты 90° были проходимы и ботом, и человеком.
 */
function rounded(
  corners: [number, number][],
  r: number,
  w: number,
  closed: boolean,
): [number, number, number][] {
  const out: [number, number, number][] = [];
  const n = corners.length;
  for (let c = 0; c < n; c++) {
    const cur = corners[c]!;
    const isEnd = !closed && (c === 0 || c === n - 1);
    if (isEnd) {
      out.push([cur[0], cur[1], w]);
      continue;
    }
    const prev = corners[(c - 1 + n) % n]!;
    const next = corners[(c + 1) % n]!;
    const ax = cur[0] - prev[0],
      az = cur[1] - prev[1];
    const bx = next[0] - cur[0],
      bz = next[1] - cur[1];
    const la = Math.hypot(ax, az),
      lb = Math.hypot(bx, bz);
    const ux = ax / la,
      uz = az / la,
      vx = bx / lb,
      vz = bz / lb;
    // Середина предыдущего отрезка — опорная точка прямой
    out.push([prev[0] + ax * 0.5, prev[1] + az * 0.5, w]);
    // Квадратичная Безье от (cur − u·r) через угол к (cur + v·r)
    const p0x = cur[0] - ux * r,
      p0z = cur[1] - uz * r;
    const p2x = cur[0] + vx * r,
      p2z = cur[1] + vz * r;
    for (const t of [0, 0.33, 0.67, 1]) {
      const a = (1 - t) * (1 - t),
        b = 2 * (1 - t) * t,
        d = t * t;
      out.push([a * p0x + b * cur[0] + d * p2x, a * p0z + b * cur[1] + d * p2z, w + 2]);
    }
  }
  if (!closed) {
    // Опорная точка перед концом
    const last = corners[n - 1]!,
      pre = corners[n - 2]!;
    out.splice(out.length - 1, 0, [(last[0] + pre[0]) / 2, (last[1] + pre[1]) / 2, w]);
  }
  return out;
}

export function tokyoTracks(half = 760): TrackDef[] {
  const base = { walls: false, wallOffset: 0, ramps: [], groundSize: half * 2.4 };
  const sprint = rounded(
    [
      [-half + 60, AVE * 2],
      [-AVE, AVE * 2],
      [-AVE, 0],
      [AVE, 0],
      [AVE, -AVE * 2],
      [half - 30, -AVE * 2],
    ],
    55,
    16,
    false,
  );
  const ring = rounded(
    [
      [-AVE, -AVE],
      [AVE, -AVE],
      [AVE, AVE],
      [-AVE, AVE],
    ],
    55,
    16,
    true,
  );
  const drift = rounded(
    [
      [0, 0],
      [AVE, 0],
      [AVE, AVE],
      [0, AVE],
    ],
    45,
    16,
    true,
  );
  return [
    {
      ...base,
      id: 'tyo_ring',
      name: 'Кольцо проспектов',
      type: 'circuit',
      laps: 2,
      closed: true,
      points: ring,
      defaultWidth: 16,
      checkpointSpacing: 100,
      startS: 0,
    },
    {
      ...base,
      id: 'tyo_sprint',
      name: 'Неоновый зигзаг',
      type: 'sprint',
      laps: 1,
      closed: false,
      points: sprint,
      defaultWidth: 16,
      checkpointSpacing: 110,
      startS: 60,
    },
    {
      ...base,
      id: 'tyo_drift',
      name: 'Квадрат у станции',
      type: 'drift',
      laps: 3,
      closed: true,
      points: drift,
      defaultWidth: 16,
      checkpointSpacing: 80,
      startS: 0,
    },
  ];
}
