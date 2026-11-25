import type { OverpassJson } from './osm';
import type { P } from './geom';
import type { TrackDef } from '@sr/shared';

/**
 * Процедурный вымышленный район «по мотивам Москвы» в формате Overpass:
 * кольцевой бульвар, радиальные проспекты, переулки, периметральная застройка.
 * Это собственные данные (не OSM) — для работы без сети и для тестов.
 */
export function synthDistrict(seed = 1, half = 900, lat0 = 55.75, lon0 = 37.6): OverpassJson {
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

  const roads: { pts: P[]; w: number }[] = [];
  const road = (
    pts: P[],
    highway: string,
    w: number,
    name: string,
    extra: Record<string, string> = {},
  ) => {
    addWay(pts, { highway, name, ...extra });
    roads.push({ pts, w });
  };

  // Кольцевой бульвар
  const ring: P[] = [];
  const RR = half * 0.62;
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const wob = 1 + 0.05 * Math.sin(a * 3 + 1);
    ring.push([Math.cos(a) * RR * wob, Math.sin(a) * RR * wob]);
  }
  road(ring, 'primary', 16, 'Кольцевой бульвар', { lanes: '4' });

  // Радиальные проспекты
  const radials = 7;
  const names = ['Северный', 'Речной', 'Заводской', 'Садовый', 'Южный', 'Парковый', 'Вокзальный'];
  for (let r = 0; r < radials; r++) {
    const a0 = (r / radials) * Math.PI * 2 + 0.2;
    const pts: P[] = [];
    for (let t = 0; t <= 12; t++) {
      const d = 40 + (t / 12) * (half * 1.05);
      const a = a0 + 0.12 * Math.sin(t * 0.7 + r);
      pts.push([Math.cos(a) * d, Math.sin(a) * d]);
    }
    road(pts, r % 2 ? 'secondary' : 'primary', r % 2 ? 13 : 16, `${names[r]} проспект`);
  }

  // Внутреннее малое кольцо (площадь)
  const small: P[] = [];
  for (let i = 0; i <= 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    small.push([Math.cos(a) * 60, Math.sin(a) * 60]);
  }
  road(small, 'tertiary', 11, 'Центральная площадь', { junction: 'roundabout' });

  // Переулки: дуги между проспектами внутри и снаружи кольца
  for (const rr of [0.33, 0.85, 1.12]) {
    for (let r = 0; r < radials; r++) {
      if (rnd() < 0.2) continue;
      const a0 = (r / radials) * Math.PI * 2 + 0.2;
      const a1 = ((r + 1) / radials) * Math.PI * 2 + 0.2;
      const pts: P[] = [];
      for (let t = 0; t <= 8; t++) {
        const a = a0 + ((a1 - a0) * t) / 8;
        const d = half * rr * (1 + 0.04 * Math.sin(t + r));
        pts.push([Math.cos(a) * d, Math.sin(a) * d]);
      }
      road(pts, 'residential', 8, `Переулок ${r + 1}-${Math.round(rr * 10)}`);
    }
  }

  // Застройка вдоль улиц: прямоугольники с отступом от проезжей части
  const distToRoads = (x: number, z: number) => {
    let best = Infinity;
    for (const r of roads) {
      for (let i = 1; i < r.pts.length; i++) {
        const [ax, az] = r.pts[i - 1]!,
          [bx, bz] = r.pts[i]!;
        const dx = bx - ax,
          dz = bz - az;
        const L2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
        const d = Math.hypot(x - ax - dx * t, z - az - dz * t) - r.w / 2;
        if (d < best) best = d;
      }
    }
    return best;
  };
  const placed: { x: number; z: number; r: number }[] = [];
  for (const r of roads) {
    for (let i = 1; i < r.pts.length; i++) {
      const [ax, az] = r.pts[i - 1]!,
        [bx, bz] = r.pts[i]!;
      const len = Math.hypot(bx - ax, bz - az);
      const tx = (bx - ax) / len,
        tz = (bz - az) / len;
      const nx = -tz,
        nz = tx;
      for (let d = 6; d < len - 6; d += 22 + rnd() * 14) {
        for (const side of [-1, 1]) {
          if (rnd() < 0.15) continue;
          const lw = 14 + rnd() * 22; // вдоль улицы
          const dp = 11 + rnd() * 9; // в глубину
          const off = r.w / 2 + 5 + dp / 2;
          const cx = ax + tx * d + nx * off * side;
          const cz = az + tz * d + nz * off * side;
          if (Math.abs(cx) > half - 20 || Math.abs(cz) > half - 20) continue;
          const rad = Math.hypot(lw, dp) / 2;
          if (placed.some((p) => Math.hypot(p.x - cx, p.z - cz) < p.r + rad + 2)) continue;
          // Углы не должны залезать на дороги
          const corners: P[] = [
            [cx - (tx * lw) / 2 - (nx * dp) / 2, cz - (tz * lw) / 2 - (nz * dp) / 2],
            [cx + (tx * lw) / 2 - (nx * dp) / 2, cz + (tz * lw) / 2 - (nz * dp) / 2],
            [cx + (tx * lw) / 2 + (nx * dp) / 2, cz + (tz * lw) / 2 + (nz * dp) / 2],
            [cx - (tx * lw) / 2 + (nx * dp) / 2, cz - (tz * lw) / 2 + (nz * dp) / 2],
          ];
          if (corners.some(([x, z]) => distToRoads(x, z) < 3) || distToRoads(cx, cz) < 4) continue;
          placed.push({ x: cx, z: cz, r: rad });
          const inner = Math.hypot(cx, cz) < RR;
          const floors = inner ? 4 + Math.floor(rnd() * 6) : 5 + Math.floor(rnd() * 12);
          const tower = !inner && rnd() < 0.05;
          addWay([...corners, corners[0]!], {
            building: tower ? 'apartments' : 'yes',
            'building:levels': String(tower ? 22 + Math.floor(rnd() * 10) : floors),
          });
        }
      }
    }
  }
  return { elements };
}

/**
 * Трассы на улицах процедурного района (те же формулы, что у дорог):
 * кольцо по бульвару, спринт «проспект → бульвар → проспект», дрифт-сектор через площадь.
 */
export function synthTracks(half = 900): TrackDef[] {
  const RR = half * 0.62;
  const radials = 7;
  const ringAt = (a: number): [number, number] => {
    const wob = 1 + 0.05 * Math.sin(a * 3 + 1);
    return [Math.cos(a) * RR * wob, Math.sin(a) * RR * wob];
  };
  const radialAt = (r: number, d: number): [number, number] => {
    // Обратная к t: d = 40 + t/12·half·1.05
    const t = ((d - 40) / (half * 1.05)) * 12;
    const a = (r / radials) * Math.PI * 2 + 0.2 + 0.12 * Math.sin(t * 0.7 + r);
    return [Math.cos(a) * d, Math.sin(a) * d];
  };
  const angleOf = (r: number) => (r / radials) * Math.PI * 2 + 0.2;
  const base = { walls: false, wallOffset: 0, ramps: [], groundSize: half * 2.4 };

  const ring: [number, number, number][] = [];
  for (let i = 0; i < 48; i++) {
    const [x, z] = ringAt((i / 48) * Math.PI * 2 + 0.05);
    ring.push([x, z, 15]);
  }

  // Спринт: с окраины по проспекту 0 к бульвару, по бульвару до проспекта 2, по нему наружу
  const sprint: [number, number, number][] = [];
  for (let d = half * 1.0; d > RR + 25; d -= 40) sprint.push([...radialAt(0, d), 15]);
  const a0 = angleOf(0),
    a2 = angleOf(2);
  for (let k = 1; k < 12; k++) sprint.push([...ringAt(a0 + ((a2 - a0) * k) / 12), 15]);
  for (let d = RR + 30; d < half * 1.0; d += 40) sprint.push([...radialAt(2, d), 12]);

  // Дрифт: сектор между проспектами 3 и 4 через центральную площадь
  const drift: [number, number, number][] = [];
  const a3 = angleOf(3),
    a4 = angleOf(4);
  for (let d = RR - 20; d > 90; d -= 45) drift.push([...radialAt(3, d), 15]);
  for (let k = 0; k <= 6; k++) {
    const a = a3 + ((a4 - a3) * k) / 6;
    drift.push([Math.cos(a) * 62, Math.sin(a) * 62, 12]);
  }
  for (let d = 110; d < RR - 25; d += 45) drift.push([...radialAt(4, d), 13]);
  for (let k = 1; k < 8; k++) drift.push([...ringAt(a4 - ((a4 - a3) * k) / 8), 15]);

  return [
    {
      ...base,
      id: 'msk_ring',
      name: 'Кольцевой бульвар',
      type: 'circuit',
      laps: 2,
      closed: true,
      points: ring,
      defaultWidth: 15,
      checkpointSpacing: 90,
      startS: 0,
    },
    {
      ...base,
      id: 'msk_sprint',
      name: 'Проспект — бульвар — проспект',
      type: 'sprint',
      laps: 1,
      closed: false,
      points: sprint,
      defaultWidth: 15,
      checkpointSpacing: 100,
      startS: 60,
    },
    {
      ...base,
      id: 'msk_drift',
      name: 'Сектор через площадь',
      type: 'drift',
      laps: 2,
      closed: true,
      points: drift,
      defaultWidth: 14,
      checkpointSpacing: 80,
      startS: 0,
    },
  ];
}
