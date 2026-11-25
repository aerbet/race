import { describe, expect, it } from 'vitest';
import { parseCity } from '@sr/shared';
import { orientedBox, polygonArea, simplify, triangulate, type P } from './geom';
import { buildingHeight, makeProjection, parseOverpass, type OverpassJson } from './osm';
import { buildCity, buildingColliders } from './build';
import { synthDistrict, synthTracks } from './synth';
import { buildTrack } from '@sr/shared';
import { writeGlb } from './glb';

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
