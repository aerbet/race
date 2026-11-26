import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyKit, groupLods, KIT_PARTS, materialRole, splitCarModel } from './car-model';
import { liveryZones } from './paint';

const box = () => new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2));

function node(name: string, parent: THREE.Object3D, at = new THREE.Vector3()): THREE.Object3D {
  const o = box();
  o.name = name;
  o.position.copy(at);
  parent.add(o);
  return o;
}

/** Синтетическая база: car_root с частями, LOD1/LOD2, колёсами и сокетом. */
function base(): THREE.Object3D {
  const scene = new THREE.Group();
  const root = new THREE.Group();
  root.name = 'car_root';
  scene.add(root);
  for (const p of ['body', ...KIT_PARTS]) for (const s of ['', '_LOD1', '_LOD2']) node(p + s, root);
  ['FL', 'FR', 'RL', 'RR'].forEach((t, i) => {
    const at = new THREE.Vector3(i % 2 ? 0.75 : -0.75, 0.33, i < 2 ? -1.3 : 1.3);
    for (const s of ['', '_LOD1', '_LOD2']) {
      node(`wheel_${t}${s}`, root, at);
      node(`brake_${t}${s}`, root, at);
    }
  });
  const sock = new THREE.Object3D();
  sock.name = 'socket_spoiler';
  sock.position.set(0, 0.99, 2.1);
  root.add(sock);
  return scene;
}

function kitScene(kit: string, socketAt = new THREE.Vector3(0, 0.99, 2.1)): THREE.Object3D {
  const scene = new THREE.Group();
  const root = new THREE.Group();
  root.name = `kit_${kit}`;
  scene.add(root);
  for (const p of KIT_PARTS)
    for (const s of ['', '_LOD1', '_LOD2'])
      node(`${p}__${kit}${s}`, root, p === 'spoiler' ? socketAt : undefined);
  const sock = new THREE.Object3D();
  sock.name = `socket_spoiler__${kit}`;
  sock.position.copy(socketAt);
  root.add(sock);
  return scene;
}

describe('загрузчик glTF-машин (9.1)', () => {
  it('сворачивает LOD0/1/2 в THREE.LOD', () => {
    const g = new THREE.Group();
    node('hood', g);
    node('hood_LOD1', g);
    node('hood_LOD2', g);
    node('glass', g);
    groupLods(g);
    const lod = g.getObjectByName('hood') as THREE.LOD;
    expect(lod).toBeInstanceOf(THREE.LOD);
    expect(lod.levels.map((l) => l.distance)).toEqual([0, 22, 55]);
    expect(g.getObjectByName('glass')).toBeInstanceOf(THREE.Mesh);
  });

  it('кит заменяет пять частей и ставит спойлер в сокет базы', () => {
    const scene = base();
    const root = scene.getObjectByName('car_root')!;
    const stockHood = root.getObjectByName('hood');
    // Кит собран для другой точки сокета — спойлер сдвигается на разницу
    expect(applyKit(root, kitScene('track', new THREE.Vector3(0, 1.0, 2.0)), 'track')).toBe(true);
    expect(root.getObjectByName('hood')).not.toBe(stockHood);
    expect(root.children.filter((c) => c.name === 'hood')).toHaveLength(1);
    const sp = root.getObjectByName('spoiler')!;
    expect(sp.position.y).toBeCloseTo(0.99);
    expect(sp.position.z).toBeCloseTo(2.1);
    expect(root.getObjectByName('body')).toBeDefined();
  });

  it('неполный кит не трогает базу', () => {
    const scene = base();
    const root = scene.getObjectByName('car_root')!;
    const k = kitScene('drift');
    k.getObjectByName('skirts__drift')!.removeFromParent();
    const hood = root.getObjectByName('hood');
    expect(applyKit(root, k, 'drift')).toBe(false);
    expect(root.getObjectByName('hood')).toBe(hood);
  });

  it('splitCarModel: колёса с LOD в оси вращения, кит отмечен', () => {
    const parts = splitCarModel(base(), kitScene('street'), 'street');
    expect(parts.kit).toBe('street');
    expect(parts.wheels).toHaveLength(4);
    const w = parts.wheels[0]!.children[0] as THREE.LOD;
    expect(w).toBeInstanceOf(THREE.LOD);
    expect(w.levels[0]!.object.position.length()).toBeCloseTo(0);
    expect(parts.body.getObjectByName('wheel_FL')).toBeUndefined();
    expect(parts.body.getObjectByName('bumper_front')).toBeInstanceOf(THREE.LOD);
  });

  it('без кита — сток', () => {
    expect(splitCarModel(base(), null, 'track').kit).toBeNull();
  });
});

describe('краска (9.2)', () => {
  it('роль материала по имени слота', () => {
    expect(materialRole('paint__track')).toBe('paint');
    expect(materialRole('paint')).toBe('paint');
    expect(materialRole('carbon__drift')).toBe('carbon');
  });

  it('зоны ливреи uv1 — как в uv.py: не перекрываются и влезают в атлас', () => {
    const z = liveryZones(2.15, 4.64, 1.34);
    expect(z.k).toBeCloseTo(0.9 / (3 * 1.34 + 2.15), 6);
    const top = z.top[1] + 2.15 * z.k;
    expect(z.right[1]).toBeGreaterThan(z.left[1] + 1.34 * z.k);
    expect(z.top[1]).toBeGreaterThan(z.right[1] + 1.34 * z.k);
    expect(z.front[1]).toBeGreaterThan(top);
    expect(z.front[1] + 1.34 * z.k).toBeLessThanOrEqual(1);
    expect(z.rear[0] + 2.15 * z.k).toBeLessThanOrEqual(1);
  });
});

describe('диски из гаража у glTF-машин (хвост 9.x)', () => {
  it('каждый диск ателье — колесо из public/wheels в обоих диаметрах', async () => {
    const { existsSync } = await import('node:fs');
    const { SHOP } = await import('@sr/shared');
    const { RIM_WHEELS, wheelFile } = await import('./car-model');
    const pub = new URL('../../public/', import.meta.url).pathname;
    const rims = SHOP.cosmetics.filter((c) => c.slot === 'rims').map((c) => c.value);
    for (const r of [...rims, 'five']) {
      expect(RIM_WHEELS[r], r).toBeDefined();
      for (const era of ['2000', '2026'])
        expect(existsSync(pub + wheelFile(r, era)), `${r} ${era}`).toBe(true);
    }
    expect(wheelFile('stock', '2000')).toBeNull();
    expect(wheelFile(undefined, '2026')).toBeNull();
    expect(wheelFile('turbine', '2000')).toBe('wheels/w04_turbine_17.glb');
  });

  it('экземпляр колеса: только wheel*, масштаб под машину, левое развёрнуто', async () => {
    const { wheelInstance } = await import('./car-model');
    const src = new THREE.Group();
    src.name = 'wheel_root';
    for (const n of ['wheel', 'wheel_LOD1', 'brake']) {
      const o = new THREE.Object3D();
      o.name = n;
      src.add(o);
    }
    const w = wheelInstance(src, 0.33, 0.235, true);
    expect(w.getObjectByName('brake')).toBeUndefined();
    expect(w.getObjectByName('wheel')).toBeDefined();
    expect(w.rotation.y).toBeCloseTo(Math.PI);
    const r = wheelInstance(src, 0.36, 0.265, false);
    expect(r.scale.y).toBeCloseTo(0.36 / 0.33);
    expect(r.scale.x).toBeCloseTo(0.265 / 0.235);
  });
});
