import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { newest } from '../../art/src/blender';
import {
  BRAKES,
  PARTS,
  SOCKETS,
  WHEELS,
  validateGlb,
  validateKitGlb,
  validateWheelGlb,
} from './validate';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** GLB из JSON-части (без бинарного буфера — валидатору нужны только min/max). */
function toGlb(json: unknown): Uint8Array {
  let text = JSON.stringify(json);
  while (text.length % 4) text += ' ';
  const body = new TextEncoder().encode(text);
  const out = new Uint8Array(20 + body.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, out.length, true);
  dv.setUint32(12, body.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(body, 20);
  return out;
}

/** Синтетическое колесо: ось X, Ø 0,66 м; tweak меняет габариты/узлы. */
function makeWheel(half = [0.118, 0.33, 0.33], tris = [2600, 1400, 550], drop = ''): Uint8Array {
  const accessors: unknown[] = [];
  const meshes: unknown[] = [];
  const nodes: { name: string; mesh?: number; children?: number[] }[] = [
    { name: 'wheel_root', children: [] },
  ];
  const add = (name: string, t?: number) => {
    if (name === drop) return;
    let mesh: number | undefined;
    if (t !== undefined) {
      accessors.push({ count: t * 3, min: half.map((v) => -v), max: half });
      meshes.push({ primitives: [{ attributes: { POSITION: accessors.length - 1 } }] });
      mesh = meshes.length - 1;
    }
    nodes.push({ name, mesh });
    nodes[0]!.children!.push(nodes.length - 1);
  };
  add('wheel', tris[0]);
  add('wheel_LOD1', tris[1]);
  add('wheel_LOD2', tris[2]);
  add('brake', 480);
  add('brake_LOD1', 200);
  add('brake_LOD2');
  return toGlb({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes,
    meshes,
    accessors,
  });
}

/** Синтетическая машина: у каждой детали свой меш-коробка; tweak меняет узлы перед сборкой. */
function makeCar(tweak: (nodes: Node[]) => void = () => {}): Uint8Array {
  interface Acc {
    count: number;
    min: number[];
    max: number[];
  }
  const accessors: Acc[] = [];
  const meshes: unknown[] = [];
  const box = (min: number[], max: number[], tris: number) => {
    accessors.push({ count: tris * 3, min, max });
    accessors.push({ count: tris * 3, min: [0, 0], max: [1, 1] });
    accessors.push({ count: tris * 3, min: [0, 0], max: [1, 1] });
    const i = accessors.length - 3;
    meshes.push({
      primitives: [{ attributes: { POSITION: i, TEXCOORD_0: i + 1, TEXCOORD_1: i + 2 } }],
    });
    return meshes.length - 1;
  };
  const nodes: Node[] = [{ name: 'car_root', children: [] }];
  const add = (n: Node) => {
    nodes.push(n);
    nodes[0]!.children!.push(nodes.length - 1);
  };
  for (const p of PARTS) {
    // Фары — у переднего края (−Z), фонари — у заднего
    const z = p === 'lights_front' ? -2 : p === 'lights_rear' ? 2 : 0;
    const dz = z ? 0.1 : 2.1;
    add({ name: p, mesh: box([-0.85, 0.15, z - dz], [0.85, 1.3, z + dz], 1000) });
    add({ name: `${p}_LOD1`, mesh: box([-0.85, 0.15, -2.1], [0.85, 1.3, 2.1], 400) });
    add({ name: `${p}_LOD2`, mesh: box([-0.85, 0.15, -2.1], [0.85, 1.3, 2.1], 100) });
  }
  for (const [i, w] of [...WHEELS, ...BRAKES].entries()) {
    const x = w[7] === 'L' ? -0.75 : 0.75;
    const z = w[6] === 'F' ? -1.27 : 1.27;
    const r = i < 4 ? 0.32 : 0.18;
    const t = [x, 0.32, z];
    add({ name: w, translation: t, mesh: box([-0.11, -r, -r], [0.11, r, r], 500) });
    add({ name: `${w}_LOD1`, translation: t, mesh: box([-0.11, -r, -r], [0.11, r, r], 200) });
    add({ name: `${w}_LOD2`, translation: t, mesh: box([-0.11, -r, -r], [0.11, r, r], 50) });
  }
  for (const s of SOCKETS) add({ name: s, translation: [0, 0.5, 2] });
  tweak(nodes);
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes,
    meshes,
    accessors,
  };
  let text = JSON.stringify(json);
  while (text.length % 4) text += ' ';
  const body = new TextEncoder().encode(text);
  const out = new Uint8Array(12 + 8 + body.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, out.length, true);
  dv.setUint32(12, body.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(body, 20);
  return out;
}

interface Node {
  name: string;
  children?: number[];
  mesh?: number;
  translation?: number[];
  scale?: number[];
}

describe('car-validate', () => {
  it('правильная машина проходит без ошибок', () => {
    const r = validateGlb(makeCar());
    expect(r.errors).toEqual([]);
    expect(r.stats.lod0).toBe(11 * 1000 + 8 * 500);
  });

  it('ловит отсутствующий узел и имя по умолчанию', () => {
    const r = validateGlb(
      makeCar((n) => {
        n.find((x) => x.name === 'hood')!.name = 'Cube.001';
      }),
    );
    expect(r.errors).toContain('нет узла hood');
    expect(r.errors.some((e) => e.includes('Cube.001'))).toBe(true);
  });

  it('ловит перевёрнутую машину (перёд в +Z)', () => {
    const r = validateGlb(
      makeCar((n) => {
        n.find((x) => x.name === 'lights_front')!.translation = [0, 0, 4];
      }),
    );
    expect(r.errors.some((e) => e.includes('−Z'))).toBe(true);
  });

  it('ловит неверный масштаб (сантиметры вместо метров)', () => {
    const r = validateGlb(
      makeCar((n) => {
        n[0]!.scale = [100, 100, 100];
      }),
    );
    expect(r.errors.some((e) => e.includes('длина'))).toBe(true);
  });

  it('ловит колесо с началом не в оси и сокет с мешем', () => {
    const r = validateGlb(
      makeCar((n) => {
        n.find((x) => x.name === 'wheel_FL')!.translation = [-0.75, 0.32, 1.27];
        n.find((x) => x.name === 'socket_spoiler')!.mesh = 0;
      }),
    );
    expect(r.errors.some((e) => e.startsWith('wheel_FL'))).toBe(true);
    expect(r.errors.some((e) => e.startsWith('socket_spoiler'))).toBe(true);
  });

  it('ловит превышение бюджета и отсутствие LOD', () => {
    const r = validateGlb(
      makeCar((n) => {
        n.find((x) => x.name === 'skirts_LOD2')!.name = 'skirts_lod';
      }),
      { lod0Max: 10000 },
    );
    expect(r.errors.some((e) => e.startsWith('LOD0'))).toBe(true);
    expect(r.errors).toContain('нет skirts_LOD2');
  });

  // Модель из Блендера (B0): проверяем реальный файл, если он собран
  const real = join(root, 'apps/client/public/cars/test_rig/base.glb');
  it.skipIf(!existsSync(real))('тестовая модель из Блендера (сжатая meshopt) проходит', () => {
    const r = validateGlb(new Uint8Array(readFileSync(real)));
    expect(r.errors).toEqual([]);
    expect(r.stats.size[2]).toBeCloseTo(4.35, 1);
  });
});

describe('car-validate: колёса', () => {
  it('правильное колесо проходит', () => {
    const r = validateWheelGlb(makeWheel());
    expect(r.errors).toEqual([]);
    expect(r.warnings).toContain('нет карты нормалей протектора');
  });

  it('ловит ось не по X', () => {
    const r = validateWheelGlb(makeWheel([0.33, 0.118, 0.33]));
    expect(r.errors.some((e) => e.includes('ось'))).toBe(true);
  });

  it('ловит бюджет, LOD и отсутствие узла', () => {
    const r = validateWheelGlb(makeWheel(undefined, [3200, 3300, 500], 'brake_LOD1'));
    expect(r.errors.some((e) => e.startsWith('wheel:'))).toBe(true);
    expect(r.errors.some((e) => e.startsWith('LOD'))).toBe(true);
    expect(r.errors).toContain('нет узла brake_LOD1');
  });

  // Колёса из Блендера (B1): проверяем, если собраны (art/export — вне git)
  const dir = join(root, 'art/export/wheels');
  const built = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.min.glb')) : [];
  it.skipIf(!built.length)('колёса из Блендера проходят', () => {
    for (const f of built) {
      const r = validateWheelGlb(new Uint8Array(readFileSync(join(dir, f))));
      expect(r.errors, f).toEqual([]);
    }
  });
});

describe('car-validate: кузовные киты', () => {
  it('опубликованные киты проходят', () => {
    const dir = join(root, 'apps/client/public/cars');
    const kits = existsSync(dir)
      ? readdirSync(dir).flatMap((id) =>
          readdirSync(join(dir, id))
            .filter((f) => /^kit_.+\.glb$/.test(f))
            .map((f) => join(dir, id, f)),
        )
      : [];
    for (const f of kits) {
      const r = validateKitGlb(new Uint8Array(readFileSync(f)));
      expect(r.errors, f).toEqual([]);
      expect(r.stats.lod0).toBeGreaterThan(1000);
    }
  });

  it('ловит отсутствие корня kit_<id>', () => {
    const r = validateKitGlb(
      toGlb({
        asset: { version: '2.0' },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ name: 'car_root' }],
      }),
    );
    expect(r.errors.join()).toMatch(/kit_<id>/);
  });
});

describe('поиск Блендера', () => {
  it('берёт самую новую версию', () => {
    expect(newest(['Blender 4.2', 'Blender 5.3', 'Blender 4.10'])).toBe('Blender 5.3');
  });
});
