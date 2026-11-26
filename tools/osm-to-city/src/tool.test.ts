import { describe, expect, it } from 'vitest';
import { parseCity } from '@sr/shared';
import { orientedBox, polygonArea, simplify, triangulate, type P } from './geom';
import { buildingHeight, joinRings, makeProjection, parseOverpass, type OverpassJson } from './osm';
import { buildCity, buildingColliders } from './build';
import { synthDistrict, synthTracks } from './synth';
import { buildTrack } from '@sr/shared';
import { writeGlb } from './glb';
import { placeLandmarks, placeModules, type ModuleCatalog } from './modules';
import { autoTracks } from './routes';

describe('geometry', () => {
  it('simplify removes collinear points', () => {
    const pts: P[] = [
      [0, 0],
      [1, 0.01],
      [2, 0],
      [3, 0.02],
      [10, 0],
    ];
    expect(simplify(pts, 0.5)).toEqual([
      [0, 0],
      [10, 0],
    ]);
  });

  it('simplify keeps closed rings', () => {
    const ring: P[] = [];
    for (let i = 0; i <= 32; i++)
      ring.push([Math.cos((i / 32) * Math.PI * 2) * 100, Math.sin((i / 32) * Math.PI * 2) * 100]);
    const s = simplify(ring, 1);
    expect(s.length).toBeGreaterThan(10);
    expect(s[0]![0]).toBeCloseTo(s[s.length - 1]![0]);
    expect(s[0]![1]).toBeCloseTo(s[s.length - 1]![1]);
  });

  it('triangulates an L-shape into 4 triangles of correct area', () => {
    const L: P[] = [
      [0, 0],
      [10, 0],
      [10, 4],
      [4, 4],
      [4, 10],
      [0, 10],
    ];
    const tri = triangulate(L);
    expect(tri.length).toBe(12);
    let area = 0;
    for (let i = 0; i < tri.length; i += 3)
      area += Math.abs(polygonArea([L[tri[i]!]!, L[tri[i + 1]!]!, L[tri[i + 2]!]!]));
    expect(area).toBeCloseTo(Math.abs(polygonArea(L)));
  });

  it('oriented box of a rotated rectangle', () => {
    const a = 0.5;
    const rect: P[] = [
      [-5, -2],
      [5, -2],
      [5, 2],
      [-5, 2],
    ].map(
      ([x, z]) =>
        [x! * Math.cos(a) + z! * Math.sin(a) + 100, -x! * Math.sin(a) + z! * Math.cos(a) + 50] as P,
    );
    const b = orientedBox(rect);
    expect(b.cx).toBeCloseTo(100);
    expect(b.cz).toBeCloseTo(50);
    expect(Math.max(b.hx, b.hz)).toBeCloseTo(5);
    expect(Math.min(b.hx, b.hz)).toBeCloseTo(2);
  });

  it('L-shaped building gets wall colliders, rectangle gets one box', () => {
    expect(
      buildingColliders(
        [
          [0, 0],
          [10, 0],
          [10, 6],
          [0, 6],
        ],
        12,
      ).length,
    ).toBe(1);
    expect(
      buildingColliders(
        [
          [0, 0],
          [10, 0],
          [10, 4],
          [4, 4],
          [4, 10],
          [0, 10],
        ],
        12,
      ).length,
    ).toBe(6);
  });
});

describe('osm parsing', () => {
  it('projects ~111 km per degree of latitude, north is −Z', () => {
    const p = makeProjection(55.75, 37.6);
    const [x, z] = p(55.76, 37.6);
    expect(x).toBeCloseTo(0);
    expect(z).toBeCloseTo(-1113, -1);
  });

  it('building heights', () => {
    expect(buildingHeight({ building: 'yes', height: '42' })).toBe(42);
    expect(buildingHeight({ building: 'yes', 'building:levels': '9' })).toBeCloseTo(29.8);
    expect(buildingHeight({ building: 'garage' })).toBe(3);
  });

  it('keeps drivable roads and buildings, skips footways', () => {
    const data: OverpassJson = {
      elements: [
        { type: 'node', id: 1, lat: 55.75, lon: 37.6 },
        { type: 'node', id: 2, lat: 55.751, lon: 37.6 },
        { type: 'node', id: 3, lat: 55.751, lon: 37.601 },
        { type: 'node', id: 4, lat: 55.75, lon: 37.601 },
        { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'primary', name: 'Тверская' } },
        { type: 'way', id: 11, nodes: [2, 3], tags: { highway: 'footway' } },
        {
          type: 'way',
          id: 12,
          nodes: [1, 2, 3, 4, 1],
          tags: { building: 'yes', 'building:levels': '5' },
        },
      ],
    };
    const r = parseOverpass(data);
    expect(r.roads.map((x) => x.cls)).toEqual(['primary']);
    expect(r.buildings.length).toBe(1);
    expect(r.buildings[0]!.footprint.length).toBe(4);
  });
});

describe('city build', () => {
  const data = synthDistrict(3, 700);
  const parsed = parseOverpass(data, { lat: 55.75, lon: 37.6 });
  const { city, files } = buildCity(parsed.roads, parsed.buildings, {
    id: 't',
    name: 'T',
    half: 800,
    origin: { lat: parsed.lat0, lon: parsed.lon0 },
    tracks: synthTracks(700),
  });

  it('produces a valid city with attribution', () => {
    expect(() => parseCity(JSON.parse(JSON.stringify(city)))).not.toThrow();
    expect(city.attribution).toMatch(/OpenStreetMap/);
    expect(city.roads.length).toBeGreaterThan(10);
  });

  it('tiles are 256 m blocks with valid GLB files', () => {
    for (const t of city.tiles) {
      const b = files.get(t.file)!;
      const dv = new DataView(b.buffer, b.byteOffset);
      expect(dv.getUint32(0, true)).toBe(0x46546c67);
      expect(dv.getUint32(8, true)).toBe(b.length);
      const jsonLen = dv.getUint32(12, true);
      const json = JSON.parse(new TextDecoder().decode(b.subarray(20, 20 + jsonLen)));
      expect(json.asset.version).toBe('2.0');
    }
    expect(city.blockSize).toBe(256);
  });

  it('tracks run along streets', () => {
    expect(city.tracks.length).toBe(3);
    for (const def of city.tracks) {
      const t = buildTrack(def);
      let sum = 0;
      for (const sm of t.samples) {
        let best = Infinity;
        for (const r of city.roads)
          for (let i = 1; i < r.points.length; i++) {
            const [ax, az] = r.points[i - 1]!,
              [bx, bz] = r.points[i]!;
            const dx = bx - ax,
              dz = bz - az;
            const k = Math.max(
              0,
              Math.min(1, ((sm.x - ax) * dx + (sm.z - az) * dz) / (dx * dx + dz * dz || 1)),
            );
            best = Math.min(best, Math.hypot(sm.x - ax - dx * k, sm.z - az - dz * k));
          }
        sum += best;
      }
      expect(sum / t.samples.length, def.id).toBeLessThan(4);
    }
  });

  it('buildings do not sit on roads (colliders keep clear of road axes)', () => {
    let bad = 0;
    for (const t of city.tiles)
      for (const [cx, cz] of t.colliders)
        for (const r of city.roads)
          for (const [x, z] of r.points) if (Math.hypot(x - cx, z - cz) < r.width / 2) bad++;
    expect(bad).toBe(0);
  });

  it('empty mesh list still writes a valid glb', () => {
    expect(writeGlb([]).length).toBeGreaterThan(20);
  });
});

describe('модули зданий (10.1) и ориентиры (10.3)', () => {
  const cat: ModuleCatalog = {
    kit: 't',
    modules: [
      { id: 'khrush_a', type: 'khrush', w: 40, d: 12, h: 13.5 },
      { id: 'stalinka_a', type: 'stalinka', w: 36, d: 16, h: 24.8 },
      { id: 'tower_a', type: 'tower', w: 30, d: 30, h: 90 },
      { id: 'pavilion_a', type: 'pavilion', w: 6, d: 4, h: 3.3 },
    ],
    landmarks: [
      { id: 'tower', w: 30, d: 30, h: 200, place: 'plot' },
      { id: 'bridge', w: 60, d: 14, h: 23, place: 'span' },
    ],
    placements: [
      { id: 'tower', city: 'c', x: 0, z: 0 },
      { id: 'bridge', city: 'c', x: 5, z: 40 },
    ],
  };
  const rect = (cx: number, cz: number, w: number, d: number, yaw = 0): P[] => {
    const c = Math.cos(yaw),
      s = Math.sin(yaw);
    return [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [-w / 2, d / 2],
    ].map(([u, v]) => [cx + u! * c + v! * s, cz - u! * s + v! * c] as P);
  };

  it('подбирает тип по высоте и ставит модуль вдоль длинной стороны', () => {
    const inst = placeModules(rect(100, 50, 12, 40), 14, 1, cat);
    expect(inst).toHaveLength(1);
    const [mi, x, z, yaw, sx, , sz] = inst[0]!;
    expect(cat.modules[mi]!.type).toBe('khrush');
    expect(x).toBeCloseTo(100, 1);
    expect(z).toBeCloseTo(50, 1);
    // Длинная сторона — вдоль Z: ось X модуля повёрнута на ±90°
    expect(Math.abs(Math.cos(yaw))).toBeLessThan(0.01);
    expect(sx).toBeCloseTo(1, 1);
    expect(sz).toBeCloseTo(1, 1);
    expect(cat.modules[placeModules(rect(0, 0, 30, 30), 95, 2, cat)[0]![0]]!.type).toBe('tower');
  });

  it('квартал 100×80 м — секции вдоль всех сторон, фасадом на улицу', () => {
    const inst = placeModules(rect(0, 0, 100, 80), 25, 4, cat);
    expect(inst.length).toBeGreaterThanOrEqual(8);
    // все секции у периметра, а не в середине двора
    for (const [, x, z] of inst)
      expect(Math.max(Math.abs(x) / 50, Math.abs(z) / 40)).toBeGreaterThan(0.6);
  });

  it('длинный дом собирается из нескольких секций без растяжения больше 35 %', () => {
    const inst = placeModules(rect(0, 0, 150, 16), 25, 3, cat);
    expect(inst.length).toBeGreaterThanOrEqual(3);
    for (const i of inst) expect(i[4]).toBeLessThanOrEqual(1.35);
    const xs = inst.map((i) => i[1]).sort((a, b) => a - b);
    expect(xs[xs.length - 1]! - xs[0]!).toBeGreaterThan(90);
  });

  it('ориентир-участок уходит с дороги, мост встаёт поперёк улицы', () => {
    const roads = [
      {
        width: 20,
        points: [
          [-200, 40],
          [200, 40],
        ] as P[],
      },
    ];
    const out = placeLandmarks(cat, 'c', roads);
    const tower = out.find((l) => l.id === 'tower')!;
    expect(Math.abs(tower.z - 40)).toBeGreaterThan(10 + 21);
    const bridge = out.find((l) => l.id === 'bridge')!;
    expect(bridge.z).toBeCloseTo(40);
    // ось X моста (cos yaw, −sin yaw) — поперёк улицы, идущей по X
    expect(Math.abs(Math.cos(bridge.yaw))).toBeLessThan(0.01);
    expect(bridge.colliders).toHaveLength(2);
    for (const c of bridge.colliders) expect(Math.abs(c[1] - 40)).toBeGreaterThan(10);
    expect(placeLandmarks(cat, 'other', roads)).toEqual([]);
  });

  it('город с набором: экземпляры вместо геометрии зданий, ориентиры не под домами', () => {
    const { city } = buildCity(
      [
        {
          id: 1,
          cls: 'primary',
          name: '',
          lanes: 0,
          oneway: false,
          points: [
            [-300, 40],
            [300, 40],
          ],
        },
      ],
      [
        { id: 1, footprint: rect(100, 0, 40, 12), height: 14 },
        { id: 2, footprint: rect(0, 0, 10, 10), height: 20 },
      ],
      { id: 'c', name: 'c', half: 400, origin: { lat: 0, lon: 0 }, modules: cat },
    );
    expect(parseCity(city).modules).toEqual(cat.modules.map((m) => m.id));
    const n = city.tiles.reduce((a, t) => a + t.instances.length, 0);
    expect(n).toBe(1); // второй дом попал в зону башни-ориентира
    expect(city.landmarks.map((l) => l.id).sort()).toEqual(['bridge', 'tower']);
  });
});

describe('мультиполигоны и трассы по улицам (10.2)', () => {
  it('внешнее кольцо здания собирается из нескольких линий в любом направлении', () => {
    expect(
      joinRings([
        [1, 2, 3],
        [5, 4, 3],
        [5, 1],
      ]),
    ).toEqual([[1, 2, 3, 4, 5, 1]]);
    expect(
      joinRings([
        [1, 2],
        [3, 4],
      ]),
    ).toEqual([]);
  });

  it('кольцо, спринт и дрифт по сетке крупных улиц', () => {
    const roads = [] as Parameters<typeof autoTracks>[0];
    let id = 1;
    // сетка 4×4 квартала по 400 м
    for (let k = 0; k <= 4; k++) {
      const c = -800 + k * 400;
      roads.push({
        id: id++,
        cls: 'secondary',
        name: '',
        oneway: false,
        lanes: 0,
        points: [
          [-800, c],
          [-400, c],
          [0, c],
          [400, c],
          [800, c],
        ],
      });
      roads.push({
        id: id++,
        cls: 'secondary',
        name: '',
        oneway: false,
        lanes: 0,
        points: [
          [c, -800],
          [c, -400],
          [c, 0],
          [c, 400],
          [c, 800],
        ],
      });
    }
    const tracks = autoTracks(roads, 1000, 'tst');
    expect(tracks.map((t) => t.id).sort()).toEqual(['tst_drift', 'tst_ring', 'tst_sprint']);
    for (const t of tracks) expect(() => buildTrack(t)).not.toThrow();
  });
});
