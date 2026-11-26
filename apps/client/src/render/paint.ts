/**
 * Краска машины (PLAN_V2 9.2): материалы глянец/металлик · перламутр · мат · хамелеон · хром,
 * винилы и ливреи, маска покраски glTF-моделей.
 *
 * Маска покраски у моделей из Блендера — по слотам материалов (kits.py, build_car.py):
 * paint — основной цвет (R), accent — второй цвет (G), carbon / chrome — B.
 * Ливреи glTF-кузова рисуются по развёртке uv1 (art/scripts/lib/uv.py, livery_uv1).
 */
import * as THREE from 'three';
import type { CarViewOptions } from './car';
import { bodyBox, materialRole } from './car-model';

const vinylCache = new Map<string, THREE.Texture>();
/** Винил — текстура по развёртке кузова: u — вдоль длины, v — вокруг сечения (0 низ, 0.5 крыша). */
function vinylTexture(kind: string): THREE.Texture | null {
  if (!kind || kind === 'none') return null;
  const hit = vinylCache.get(kind);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 512, 256);
  g.fillStyle = '#16181f';
  const vy = (v: number) => (1 - v) * 256;
  if (kind === 'stripes') {
    // Две гоночные полосы через капот, крышу и багажник
    g.fillRect(0, vy(0.535), 512, 9);
    g.fillRect(0, vy(0.485), 512, 9);
  } else if (kind === 'checker') {
    for (const side of [0.19, 0.81])
      for (let x = 300; x < 512; x += 16)
        for (let y = -2; y < 3; y++)
          if ((x / 16 + y) % 2 === 0) g.fillRect(x, vy(side) + y * 12, 16, 12);
  } else if (kind === 'tribal') {
    g.lineWidth = 7;
    g.strokeStyle = '#16181f';
    for (const side of [0.19, 0.81]) {
      const y0 = vy(side);
      g.beginPath();
      g.moveTo(40, y0 + 18);
      for (let x = 40; x < 470; x += 30)
        g.quadraticCurveTo(x + 15, y0 - 26 + ((x / 30) % 2) * 10, x + 30, y0 + 14);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  vinylCache.set(kind, t);
  return t;
}

export function paintMaterial(
  opts: CarViewOptions,
  hi: boolean,
  map: THREE.Texture | null = vinylTexture(opts.vinyl ?? ''),
): THREE.Material {
  const ghost = !!opts.ghost;
  if (ghost)
    return new THREE.MeshStandardMaterial({
      color: opts.color,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      metalness: 0.3,
      roughness: 0.4,
    });
  const p = opts.paint ?? '';
  const base = p.startsWith('#') ? parseInt(p.slice(1), 16) : opts.color;
  const common = { map, side: THREE.FrontSide };
  if (p === 'chrome')
    return new THREE.MeshPhysicalMaterial({
      ...common,
      color: 0xf4f6fa,
      metalness: 1,
      roughness: 0.06,
      clearcoat: 1,
      envMapIntensity: 1.4,
    });
  if (p === 'pearl')
    return new THREE.MeshPhysicalMaterial({
      ...common,
      color: 0xf3efe8,
      metalness: 0.25,
      roughness: 0.22,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      sheen: 1,
      sheenColor: new THREE.Color(0xc8b8ff),
      sheenRoughness: 0.4,
    });
  if (p === 'matte_black')
    return new THREE.MeshStandardMaterial({
      ...common,
      color: 0x141518,
      metalness: 0.2,
      roughness: 0.82,
    });
  if (p === 'chameleon')
    return new THREE.MeshPhysicalMaterial({
      ...common,
      color: 0x3a1f7a,
      metalness: 0.7,
      roughness: 0.25,
      clearcoat: 1,
      iridescence: 1,
      iridescenceIOR: 1.9,
      iridescenceThicknessRange: [200, 900],
    });
  if (!hi)
    return new THREE.MeshStandardMaterial({
      ...common,
      color: base,
      metalness: 0.55,
      roughness: 0.32,
    });
  // Автоэмаль с лаком
  return new THREE.MeshPhysicalMaterial({
    ...common,
    color: base,
    metalness: 0.45,
    roughness: 0.38,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    // Ночная сцена с bloom: светлые машины иначе пересвечены
    envMapIntensity: 0.7,
  });
}

// ---------------- ливреи по uv1 (glTF-модели) ----------------

/** Зоны атласа uv1 — та же формула, что в art/scripts/lib/uv.py (livery_uv1). */
export interface LiveryZones {
  k: number;
  /** Размеры кузова в осях Блендера: sx — ширина, sy — длина, sz — высота (м). */
  sx: number;
  sy: number;
  sz: number;
  left: [number, number];
  right: [number, number];
  top: [number, number];
  front: [number, number];
  rear: [number, number];
}

export function liveryZones(sx: number, sy: number, sz: number): LiveryZones {
  const gap = 0.02;
  const k = Math.min(
    (1 - 2 * gap) / Math.max(sy, 1e-6),
    (1 - 5 * gap) / Math.max(3 * sz + sx, 1e-6),
    (1 - 3 * gap) / 2 / Math.max(sx, 1e-6),
  );
  const v1 = gap + sz * k + gap;
  const v2 = v1 + sz * k + gap;
  const v3 = v2 + sx * k + gap;
  return {
    k,
    sx,
    sy,
    sz,
    left: [gap, gap],
    right: [gap, v1],
    top: [gap, v2],
    front: [gap, v3],
    rear: [gap * 2 + sx * k, v3],
  };
}

const liveryCache = new Map<string, THREE.Texture>();
const N = 1024;

/** Ливрея по развёртке uv1: u, v — доли атласа, v = 0 внизу. */
export function liveryTexture(kind: string, z: LiveryZones): THREE.Texture | null {
  if (!kind || kind === 'none') return null;
  const key = `${kind}|${z.sx.toFixed(2)}|${z.sy.toFixed(2)}|${z.sz.toFixed(2)}`;
  const hit = liveryCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, N, N);
  g.fillStyle = '#16181f';
  const { k } = z;
  // Прямоугольник в метрах внутри зоны: a — по u, b — по v
  const rect = (zone: [number, number], a0: number, b0: number, a1: number, b1: number) => {
    const u0 = zone[0] + a0 * k;
    const v0 = zone[1] + b0 * k;
    g.fillRect(u0 * N, (1 - (zone[1] + b1 * k)) * N, (a1 - a0) * k * N, (b1 - b0) * k * N);
    return v0;
  };
  const sides = [z.left, z.right];
  if (kind === 'stripes') {
    // Две полосы через капот, крышу и багажник (верх: u — длина, v — ширина от левого края)
    const cx = z.sx / 2;
    for (const [a, b] of [
      [0.03, 0.15],
      [-0.15, -0.03],
    ] as const) {
      rect(z.top, 0, cx + a, z.sy, cx + b);
      rect(z.front, cx + a, 0, cx + b, z.sz);
      rect(z.rear, cx + a, 0, cx + b, z.sz);
    }
  } else if (kind === 'checker') {
    // Шахматка на задней части боков (u = 0 — корма)
    const s = 0.1;
    for (const zone of sides)
      for (let i = 0; i * s < z.sy * 0.42; i++)
        for (let j = 0; j < 3; j++)
          if ((i + j) % 2 === 0)
            rect(zone, 0.2 + i * s, 0.22 + j * s, 0.2 + (i + 1) * s, 0.22 + (j + 1) * s);
  } else if (kind === 'tribal') {
    g.lineWidth = 0.05 * k * N;
    g.strokeStyle = '#16181f';
    for (const zone of sides) {
      const px = (a: number) => (zone[0] + a * k) * N;
      const py = (b: number) => (1 - (zone[1] + b * k)) * N;
      g.beginPath();
      g.moveTo(px(0.3), py(0.42));
      for (let a = 0.3; a < z.sy - 0.6; a += 0.3)
        g.quadraticCurveTo(px(a + 0.15), py(0.58 - ((a / 0.3) % 2) * 0.06), px(a + 0.3), py(0.44));
      g.stroke();
    }
  } else return null;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.channel = 1; // uv1 (TEXCOORD_1)
  t.anisotropy = 4;
  liveryCache.set(key, t);
  return t;
}

// ---------------- карбон ----------------

let carbonTex: THREE.Texture | null = null;
/** Саржевое плетение 2×2: тёмные ячейки с бликом поперёк. */
function carbonTexture(): THREE.Texture {
  if (carbonTex) return carbonTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#121317';
  g.fillRect(0, 0, 64, 64);
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) {
      const horiz = (x + y) % 4 < 2;
      const gr = horiz
        ? g.createLinearGradient(x * 16, 0, x * 16 + 16, 0)
        : g.createLinearGradient(0, y * 16, 0, y * 16 + 16);
      gr.addColorStop(0, '#191a1f');
      gr.addColorStop(0.5, '#3a3d46');
      gr.addColorStop(1, '#191a1f');
      g.fillStyle = gr;
      g.fillRect(x * 16 + 1, y * 16 + 1, 14, 14);
    }
  carbonTex = new THREE.CanvasTexture(c);
  carbonTex.colorSpace = THREE.SRGBColorSpace;
  carbonTex.wrapS = carbonTex.wrapT = THREE.RepeatWrapping;
  carbonTex.repeat.set(40, 40);
  return carbonTex;
}

// ---------------- маска покраски glTF-модели ----------------

type Std = THREE.MeshStandardMaterial;

function keepAo<T extends Std>(from: Std, to: T): T {
  to.aoMap = from.aoMap;
  to.aoMapIntensity = from.aoMapIntensity;
  to.name = from.name;
  return to;
}

function underNode(o: THREE.Object3D, name: string): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.name === name) return true;
  return false;
}

/**
 * Перекрасить модель по маске: paint — краска игрока (на кузове — с ливреей по uv1),
 * accent — второй цвет (paint2), carbon — карбон; остальное без изменений.
 * Запечённый AO из glTF сохраняется.
 */
export function applyModelPaint(root: THREE.Object3D, opts: CarViewOptions, hi: boolean): void {
  const box = bodyBox(root);
  const size = box?.getSize(new THREE.Vector3());
  // Оси three: x — ширина, y — высота, z — длина
  const livery = size ? liveryTexture(opts.vinyl ?? '', liveryZones(size.x, size.z, size.y)) : null;
  const made = new Map<string, THREE.Material>();
  const remake = (old: Std, onBody: boolean): THREE.Material | null => {
    switch (materialRole(old.name)) {
      case 'paint':
        return keepAo(old, paintMaterial(opts, hi, onBody ? livery : null) as Std);
      case 'accent':
        if (!opts.paint2?.startsWith('#')) return null;
        return keepAo(
          old,
          new THREE.MeshPhysicalMaterial({
            color: parseInt(opts.paint2.slice(1), 16),
            metalness: 0.35,
            roughness: 0.3,
            clearcoat: hi ? 1 : 0,
          }),
        );
      case 'carbon':
        return keepAo(
          old,
          hi
            ? new THREE.MeshPhysicalMaterial({
                color: 0xffffff,
                map: carbonTexture(),
                metalness: 0.3,
                roughness: 0.35,
                clearcoat: 1,
                clearcoatRoughness: 0.05,
              })
            : new THREE.MeshStandardMaterial({
                color: 0xffffff,
                map: carbonTexture(),
                metalness: 0.3,
                roughness: 0.35,
              }),
        );
      default:
        return null;
    }
  };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const old = mesh.material as Std;
    const onBody = underNode(mesh, 'body');
    const key = `${old.uuid}|${onBody ? 1 : 0}`;
    let m = made.get(key);
    if (!m) {
      m = remake(old, onBody) ?? old;
      made.set(key, m);
    }
    mesh.material = m;
  });
}
