/**
 * Проверка glTF-машины по docs/ART_BRIEF.md: имена узлов, бюджеты, LOD, оси,
 * масштаб, сокеты, UV, размеры текстур.
 */
import {
  imageSize,
  merge,
  meshBox,
  meshTriangles,
  parseGlb,
  walk,
  type Box,
  type NodeInfo,
} from './glb';

export const PARTS = [
  'body',
  'hood',
  'bumper_front',
  'bumper_rear',
  'skirts',
  'spoiler',
  'glass',
  'lights_front',
  'lights_rear',
  'interior_low',
  'exhaust',
] as const;
export const WHEELS = ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'] as const;
export const BRAKES = ['brake_FL', 'brake_FR', 'brake_RL', 'brake_RR'] as const;
export const SOCKETS = [
  'socket_spoiler',
  'socket_exhaust',
  'socket_plate_front',
  'socket_plate_rear',
] as const;
/** Узлы, которые могут быть пустыми (без меша). */
const MAY_BE_EMPTY = new Set(['spoiler', 'exhaust']); // у электромобиля нет выхлопа

export interface Limits {
  lod0Max: number;
  /** Ниже — только предупреждение (тестовая модель, простые машины). */
  lod0Min: number;
  wheelMax: number;
  interiorMax: number;
  textureMax: number;
}

export const LIMITS: Limits = {
  lod0Max: 45000,
  lod0Min: 25000,
  wheelMax: 3000,
  interiorMax: 3000,
  textureMax: 2048,
};

export interface Report {
  errors: string[];
  warnings: string[];
  stats: {
    lod0: number;
    lod1: number;
    lod2: number;
    size: number[];
    wheels: number[];
    textures: string[];
  };
}

const lodOf = (name: string) => (/_LOD([12])$/.exec(name)?.[1] ?? '0') as '0' | '1' | '2';

export function validateGlb(buf: Uint8Array, limits: Partial<Limits> = {}): Report {
  const L = { ...LIMITS, ...limits };
  const errors: string[] = [];
  const warnings: string[] = [];
  const { json, bin } = parseGlb(buf);
  const nodes = walk(json);
  const byName = new Map<string, NodeInfo>();
  for (const n of nodes) {
    if (byName.has(n.name)) errors.push(`узел «${n.name}» встречается дважды`);
    byName.set(n.name, n);
  }

  // 1. Структура узлов
  const root = byName.get('car_root');
  if (!root) errors.push('нет узла car_root');
  else if (root.parent !== null) errors.push('car_root должен быть корнем сцены');
  for (const name of [...PARTS, ...WHEELS, ...BRAKES, ...SOCKETS]) {
    const n = byName.get(name);
    if (!n) {
      errors.push(`нет узла ${name}`);
      continue;
    }
    if (root && n.parent !== root.index) errors.push(`${name} должен быть дочерним узлом car_root`);
    const isSocket = name.startsWith('socket_');
    if (isSocket && n.mesh !== undefined)
      errors.push(`${name} — точка крепления, меша быть не должно`);
    if (!isSocket && n.mesh === undefined && !MAY_BE_EMPTY.has(name))
      errors.push(`${name} без меша`);
  }
  for (const n of nodes) {
    if (/\.\d{3}$|^(Cube|Sphere|Cylinder|Plane|Empty|Object)\b/.test(n.name))
      errors.push(`имя по умолчанию: «${n.name}»`);
  }

  // 2. Треугольники по LOD
  const tris = { '0': 0, '1': 0, '2': 0 };
  const meshNodes = nodes.filter((n) => n.mesh !== undefined && !n.name.endsWith('_collision'));
  for (const n of meshNodes) tris[lodOf(n.name)] += meshTriangles(json, n.mesh!);
  if (tris['0'] > L.lod0Max) errors.push(`LOD0: ${tris['0']} треугольников > ${L.lod0Max}`);
  else if (tris['0'] < L.lod0Min)
    warnings.push(`LOD0: ${tris['0']} треугольников — меньше ${L.lod0Min} (упрощённая модель?)`);
  const wheelTris = WHEELS.map((w) => {
    const n = byName.get(w);
    return n?.mesh !== undefined ? meshTriangles(json, n.mesh) : 0;
  });
  wheelTris.forEach((t, i) => {
    if (t > L.wheelMax) errors.push(`${WHEELS[i]}: ${t} треугольников > ${L.wheelMax}`);
  });
  const inter = byName.get('interior_low');
  if (inter?.mesh !== undefined && meshTriangles(json, inter.mesh) > L.interiorMax)
    errors.push(`interior_low: больше ${L.interiorMax} треугольников`);

  // 3. LOD: у каждого меша LOD0 есть _LOD1 и _LOD2 (LOD2 может быть пустым узлом)
  for (const n of meshNodes) {
    if (lodOf(n.name) !== '0') continue;
    for (const s of ['_LOD1', '_LOD2']) {
      if (!byName.has(n.name + s)) errors.push(`нет ${n.name}${s}`);
    }
  }
  if (tris['0'] > 0) {
    if (tris['1'] >= tris['0']) errors.push('LOD1 не легче LOD0');
    else if (tris['1'] > tris['0'] * 0.55)
      warnings.push(`LOD1 = ${pct(tris['1'], tris['0'])} от LOD0 (цель ~40%)`);
    if (tris['2'] >= tris['1'] && tris['1'] > 0) errors.push('LOD2 не легче LOD1');
    else if (tris['2'] > tris['0'] * 0.2)
      warnings.push(`LOD2 = ${pct(tris['2'], tris['0'])} от LOD0 (цель ~10%)`);
  }

  // 4. Габариты, оси, масштаб (только LOD0)
  let all: Box | null = null;
  const boxOf = (name: string) => {
    const n = byName.get(name);
    return n?.mesh !== undefined ? meshBox(json, n.mesh, n.world) : null;
  };
  for (const n of meshNodes)
    if (lodOf(n.name) === '0') all = merge(all, meshBox(json, n.mesh!, n.world));
  const size = all ? [0, 1, 2].map((k) => all!.max[k]! - all!.min[k]!) : [0, 0, 0];
  if (all) {
    const [w, h, l] = size as [number, number, number];
    if (l < 2.5 || l > 7) errors.push(`длина ${l.toFixed(2)} м вне 2,5–7 (масштаб? 1 юнит = 1 м)`);
    if (w < 1.2 || w > 2.6) errors.push(`ширина ${w.toFixed(2)} м вне 1,2–2,6`);
    if (h < 0.8 || h > 2.5) errors.push(`высота ${h.toFixed(2)} м вне 0,8–2,5`);
    if (l < w) errors.push('машина длиннее по X, чем по Z — перёд должен смотреть в −Z');
    if (Math.abs(all.min[1]!) > 0.05)
      errors.push(`низ модели на y=${all.min[1]!.toFixed(3)}, а должен быть на земле (y=0)`);
    const cz = (all.min[2]! + all.max[2]!) / 2;
    if (Math.abs(cz) > 0.6)
      warnings.push(`центр по длине смещён на ${cz.toFixed(2)} м от начала координат`);
  }
  const lf = boxOf('lights_front');
  const lr = boxOf('lights_rear');
  if (lf && lr && (lf.min[2]! + lf.max[2]!) / 2 >= (lr.min[2]! + lr.max[2]!) / 2)
    errors.push('фары сзади фонарей: перёд машины должен смотреть в −Z (в Блендере — нос по +Y)');

  // 5. Колёса: начало узла — в оси вращения, перед — с −Z, лево — −X
  const wheelPos = WHEELS.map((w) => byName.get(w)?.world.slice(12, 15));
  WHEELS.forEach((w, i) => {
    const p = wheelPos[i];
    const b = boxOf(w);
    if (!p || !b) return;
    const c = [0, 1, 2].map((k) => (b.min[k]! + b.max[k]!) / 2);
    const off = Math.hypot(c[0]! - p[0]!, c[1]! - p[1]!, c[2]! - p[2]!);
    if (off > 0.03)
      errors.push(`${w}: начало узла не в центре колеса (смещение ${off.toFixed(3)} м)`);
    const front = w[6] === 'F';
    const left = w[7] === 'L';
    if (front !== p[2]! < 0)
      errors.push(`${w}: ${front ? 'переднее' : 'заднее'} колесо не на своей оси`);
    if (left !== p[0]! < 0)
      errors.push(`${w}: ${left ? 'левое' : 'правое'} колесо не на своей стороне`);
    const r = (b.max[1]! - b.min[1]!) / 2;
    if (Math.abs(p[1]! - r) > 0.06)
      warnings.push(
        `${w}: колесо не стоит на земле (центр y=${p[1]!.toFixed(2)}, радиус ${r.toFixed(2)})`,
      );
  });

  // 6. UV: кузов с двумя развёртками (uv0 — текстуры, uv1 — ливреи)
  const body = byName.get('body');
  if (body?.mesh !== undefined) {
    const attrs = json.meshes![body.mesh]!.primitives[0]!.attributes;
    if (attrs.TEXCOORD_0 === undefined) errors.push('у body нет uv0 (TEXCOORD_0)');
    if (attrs.TEXCOORD_1 === undefined) errors.push('у body нет uv1 под ливреи (TEXCOORD_1)');
  }

  // 7. Текстуры
  const textures: string[] = [];
  for (const [i, img] of (json.images ?? []).entries()) {
    if (img.bufferView === undefined || !bin) {
      errors.push(`картинка ${i}: только встроенные в GLB`);
      continue;
    }
    const bv = json.bufferViews![img.bufferView]!;
    const data = bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
    const s = imageSize(data);
    if (!s) {
      warnings.push(`картинка ${i}: формат не распознан`);
      continue;
    }
    textures.push(`${s.w}×${s.h} ${s.format}`);
    if (s.w > L.textureMax || s.h > L.textureMax)
      errors.push(`картинка ${i}: ${s.w}×${s.h} > ${L.textureMax}`);
  }

  return {
    errors,
    warnings,
    stats: { lod0: tris['0'], lod1: tris['1'], lod2: tris['2'], size, wheels: wheelTris, textures },
  };
}

const pct = (a: number, b: number) => `${Math.round((a / b) * 100)}%`;

export const WHEEL_LIMITS = { wheelMax: 3000, textureMax: 1024 };

/**
 * Колесо из библиотеки дисков (BLENDER_PLAN 5.3): wheel_root → wheel (+_LOD1/_LOD2),
 * brake (+_LOD1, _LOD2 — пустой). Ось вращения — X, начало — центр колеса.
 */
export function validateWheelGlb(buf: Uint8Array): Report {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { json, bin } = parseGlb(buf);
  const nodes = walk(json);
  const byName = new Map(nodes.map((n) => [n.name, n]));
  const root = byName.get('wheel_root');
  if (!root) errors.push('нет узла wheel_root');
  else if (root.parent !== null) errors.push('wheel_root должен быть корнем сцены');
  const tris = (name: string) => {
    const n = byName.get(name);
    return n?.mesh !== undefined ? meshTriangles(json, n.mesh) : 0;
  };
  for (const name of ['wheel', 'wheel_LOD1', 'wheel_LOD2', 'brake', 'brake_LOD1']) {
    const n = byName.get(name);
    if (!n) errors.push(`нет узла ${name}`);
    else if (n.mesh === undefined) errors.push(`${name} без меша`);
    else if (root && n.parent !== root.index)
      errors.push(`${name} должен быть дочерним узлом wheel_root`);
  }
  if (!byName.has('brake_LOD2')) errors.push('нет узла brake_LOD2 (может быть пустым)');
  const [t0, t1, t2] = ['wheel', 'wheel_LOD1', 'wheel_LOD2'].map(tris) as [number, number, number];
  if (t0 > WHEEL_LIMITS.wheelMax)
    errors.push(`wheel: ${t0} треугольников > ${WHEEL_LIMITS.wheelMax}`);
  if (t1 >= t0 || t2 >= t1) errors.push(`LOD не легчают: ${t0} / ${t1} / ${t2}`);

  const w = byName.get('wheel');
  const box = w?.mesh !== undefined ? meshBox(json, w.mesh, w.world) : null;
  const size = box ? [0, 1, 2].map((k) => box.max[k]! - box.min[k]!) : [0, 0, 0];
  if (box) {
    const [sx, sy, sz] = size as [number, number, number];
    if (Math.abs(sy - sz) > 0.01)
      errors.push(
        `колесо не круглое в плоскости YZ (${sy.toFixed(3)} × ${sz.toFixed(3)}) — ось должна быть X`,
      );
    if (sx >= sy * 0.6)
      errors.push(`ширина ${sx.toFixed(2)} м слишком большая — ось вращения должна быть X`);
    if (sy < 0.5 || sy > 0.85) errors.push(`диаметр ${sy.toFixed(2)} м вне 0,5–0,85`);
    const cy = (box.min[1]! + box.max[1]!) / 2;
    const cz = (box.min[2]! + box.max[2]!) / 2;
    if (Math.hypot(cy, cz) > 0.005) errors.push('начало координат не в оси колеса');
  }

  const textures: string[] = [];
  for (const [i, img] of (json.images ?? []).entries()) {
    if (img.bufferView === undefined || !bin) {
      errors.push(`картинка ${i}: только встроенные в GLB`);
      continue;
    }
    const bv = json.bufferViews![img.bufferView]!;
    const s = imageSize(bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength));
    if (!s) continue;
    textures.push(`${s.w}×${s.h} ${s.format}`);
    if (s.w > WHEEL_LIMITS.textureMax || s.h > WHEEL_LIMITS.textureMax)
      errors.push(`картинка ${i}: ${s.w}×${s.h} > ${WHEEL_LIMITS.textureMax}`);
  }
  if (!textures.length) warnings.push('нет карты нормалей протектора');
  return {
    errors,
    warnings,
    stats: { lod0: t0, lod1: t1, lod2: t2, size, wheels: [tris('brake')], textures },
  };
}

export const KIT_PARTS = ['hood', 'bumper_front', 'bumper_rear', 'skirts', 'spoiler'] as const;
export const KIT_LIMITS = { lod0Max: 12000, textureMax: 1024 };

/**
 * Кузовной кит (BLENDER_PLAN 5.4): kit_<id> → <часть>__<id> (+_LOD1/_LOD2) для hood,
 * bumper_front, bumper_rear, skirts, spoiler. Начало — как у car_root, спойлер — в сокете.
 */
export function validateKitGlb(buf: Uint8Array): Report & { kit: string } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { json, bin } = parseGlb(buf);
  const nodes = walk(json);
  const byName = new Map(nodes.map((n) => [n.name, n]));
  const root = nodes.find((n) => n.parent === null && /^kit_[a-z0-9_]+$/.test(n.name));
  const kit = root?.name.slice(4) ?? '';
  if (!root) errors.push('нет корневого узла kit_<id>');
  const tris = { '0': 0, '1': 0, '2': 0 };
  let all: Box | null = null;
  for (const part of KIT_PARTS) {
    for (const lod of ['', '_LOD1', '_LOD2'] as const) {
      const name = `${part}__${kit}${lod}`;
      const n = byName.get(name);
      if (!n) {
        errors.push(`нет узла ${name}`);
        continue;
      }
      if (root && n.parent !== root.index)
        errors.push(`${name} должен быть дочерним узлом kit_${kit}`);
      if (n.mesh === undefined) {
        if (!lod) errors.push(`${name} без меша`);
        continue;
      }
      tris[lodOf(name)] += meshTriangles(json, n.mesh);
      if (!lod) all = merge(all, meshBox(json, n.mesh, n.world));
    }
  }
  for (const n of nodes) if (/\.\d{3}$/.test(n.name)) errors.push(`имя по умолчанию: «${n.name}»`);
  if (tris['0'] > KIT_LIMITS.lod0Max)
    errors.push(`LOD0: ${tris['0']} треугольников > ${KIT_LIMITS.lod0Max}`);
  if (tris['0'] && (tris['1'] >= tris['0'] || tris['2'] >= tris['1']))
    errors.push(`LOD не легчают: ${tris['0']} / ${tris['1']} / ${tris['2']}`);
  const size = all ? [0, 1, 2].map((k) => all!.max[k]! - all!.min[k]!) : [0, 0, 0];
  if (all) {
    const [w, , l] = size as [number, number, number];
    if (l < 2.5 || l > 7 || w < 1.2 || w > 2.8)
      errors.push(`габариты кита ${size.map((v) => v.toFixed(2)).join('×')} м — масштаб или оси`);
    if (all.min[1]! < -0.02) errors.push(`кит ниже земли (y=${all.min[1]!.toFixed(3)})`);
  }
  // Перёд — в −Z: передний бампер должен быть впереди заднего
  const fb = byName.get(`bumper_front__${kit}`);
  const rb = byName.get(`bumper_rear__${kit}`);
  if (fb?.mesh !== undefined && rb?.mesh !== undefined) {
    const f = meshBox(json, fb.mesh, fb.world);
    const r = meshBox(json, rb.mesh, rb.world);
    if (f && r && f.min[2]! + f.max[2]! >= r.min[2]! + r.max[2]!)
      errors.push('передний бампер сзади заднего: перёд должен смотреть в −Z');
  }
  const textures: string[] = [];
  for (const img of json.images ?? []) {
    if (img.bufferView === undefined || !bin) continue;
    const bv = json.bufferViews![img.bufferView]!;
    const s = imageSize(bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength));
    if (!s) continue;
    textures.push(`${s.w}×${s.h} ${s.format}`);
    if (s.w > KIT_LIMITS.textureMax || s.h > KIT_LIMITS.textureMax)
      errors.push(`картинка ${s.w}×${s.h} > ${KIT_LIMITS.textureMax}`);
  }
  return {
    kit,
    errors,
    warnings,
    stats: { lod0: tris['0'], lod1: tris['1'], lod2: tris['2'], size, wheels: [], textures },
  };
}
