/**
 * Минимальное чтение GLB: JSON-часть, бинарный буфер, мировые матрицы узлов,
 * треугольники и габариты мешей. Без декодирования вершин — хватает min/max
 * у POSITION, поэтому работает и для сжатых meshopt-файлов.
 */

export interface GltfNode {
  name?: string;
  mesh?: number;
  children?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  matrix?: number[];
}

export interface GltfJson {
  asset: { version: string };
  scene?: number;
  scenes?: { nodes: number[] }[];
  nodes?: GltfNode[];
  meshes?: {
    name?: string;
    primitives: { attributes: Record<string, number>; indices?: number; mode?: number }[];
  }[];
  accessors?: {
    count: number;
    min?: number[];
    max?: number[];
    normalized?: boolean;
    componentType?: number;
  }[];
  images?: { mimeType?: string; bufferView?: number; uri?: string }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number }[];
  extensionsUsed?: string[];
}

export interface Glb {
  json: GltfJson;
  bin: Uint8Array | null;
}

export function parseGlb(buf: Uint8Array): Glb {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('не GLB (нет подписи glTF)');
  if (dv.getUint32(4, true) !== 2) throw new Error('нужен glTF 2.0');
  let off = 12;
  let json: GltfJson | null = null;
  let bin: Uint8Array | null = null;
  while (off < dv.byteLength) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(data)) as GltfJson;
    else if (type === 0x004e4942) bin = data;
    off += 8 + len;
  }
  if (!json) throw new Error('в GLB нет JSON-части');
  return { json, bin };
}

export type Mat4 = number[];

const IDENT: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Умножение матриц 4×4 (столбцы, как в glTF). */
export function mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) o[c * 4 + r]! += a[k * 4 + r]! * b[c * 4 + k]!;
  return o;
}

export function localMatrix(n: GltfNode): Mat4 {
  if (n.matrix) return n.matrix;
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  return [
    (1 - 2 * (y! * y! + z! * z!)) * sx!,
    2 * (x! * y! + z! * w!) * sx!,
    2 * (x! * z! - y! * w!) * sx!,
    0,
    2 * (x! * y! - z! * w!) * sy!,
    (1 - 2 * (x! * x! + z! * z!)) * sy!,
    2 * (y! * z! + x! * w!) * sy!,
    0,
    2 * (x! * z! + y! * w!) * sz!,
    2 * (y! * z! - x! * w!) * sz!,
    (1 - 2 * (x! * x! + y! * y!)) * sz!,
    0,
    tx!,
    ty!,
    tz!,
    1,
  ];
}

export function apply(m: Mat4, p: number[]): number[] {
  const [x, y, z] = p as [number, number, number];
  return [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
    m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
  ];
}

export interface NodeInfo {
  index: number;
  name: string;
  parent: number | null;
  world: Mat4;
  mesh?: number;
}

/** Все узлы сцены с мировыми матрицами (обход от корней сцены). */
export function walk(json: GltfJson): NodeInfo[] {
  const nodes = json.nodes ?? [];
  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? [];
  const out: NodeInfo[] = [];
  const visit = (i: number, parent: number | null, pm: Mat4) => {
    const n = nodes[i]!;
    const world = mul(pm, localMatrix(n));
    out.push({ index: i, name: n.name ?? '', parent, world, mesh: n.mesh });
    for (const c of n.children ?? []) visit(c, i, world);
  };
  for (const r of roots) visit(r, null, IDENT);
  return out;
}

export function meshTriangles(json: GltfJson, mesh: number): number {
  let t = 0;
  for (const p of json.meshes?.[mesh]?.primitives ?? []) {
    if ((p.mode ?? 4) !== 4) continue;
    const count =
      p.indices !== undefined
        ? json.accessors![p.indices]!.count
        : json.accessors![p.attributes.POSITION!]!.count;
    t += Math.floor(count / 3);
  }
  return t;
}

/** Делитель нормализованных компонент: BYTE, UNSIGNED_BYTE, SHORT, UNSIGNED_SHORT. */
const NORM: Record<number, number> = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

export interface Box {
  min: number[];
  max: number[];
}

/** Габариты меша в мировых координатах (по min/max атрибута POSITION). */
export function meshBox(json: GltfJson, mesh: number, world: Mat4): Box | null {
  let box: Box | null = null;
  for (const p of json.meshes?.[mesh]?.primitives ?? []) {
    const a = json.accessors?.[p.attributes.POSITION!];
    if (!a?.min || !a.max) continue;
    // KHR_mesh_quantization: нормализованные целые → [-1, 1] / [0, 1]
    const k = a.normalized ? 1 / (NORM[a.componentType ?? 5126] ?? 1) : 1;
    const lo = a.min.map((v) => v * k);
    const hi = a.max.map((v) => v * k);
    for (let i = 0; i < 8; i++) {
      const c = [i & 1 ? hi[0]! : lo[0]!, i & 2 ? hi[1]! : lo[1]!, i & 4 ? hi[2]! : lo[2]!];
      box = grow(box, apply(world, c));
    }
  }
  return box;
}

export function grow(box: Box | null, p: number[]): Box {
  if (!box) return { min: [...p], max: [...p] };
  for (let k = 0; k < 3; k++) {
    box.min[k] = Math.min(box.min[k]!, p[k]!);
    box.max[k] = Math.max(box.max[k]!, p[k]!);
  }
  return box;
}

export function merge(a: Box | null, b: Box | null): Box | null {
  if (!b) return a;
  return grow(grow(a, b.min), b.max);
}

/** Размер картинки по заголовку PNG / JPEG / KTX2; null — формат не распознан. */
export function imageSize(data: Uint8Array): { w: number; h: number; format: string } | null {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data[0] === 0x89 && data[1] === 0x50)
    return { w: dv.getUint32(16), h: dv.getUint32(20), format: 'png' };
  if (data[0] === 0xab && data[1] === 0x4b && data[2] === 0x54 && data[3] === 0x58)
    return { w: dv.getUint32(20, true), h: dv.getUint32(24, true), format: 'ktx2' };
  if (data[0] === 0xff && data[1] === 0xd8) {
    let o = 2;
    while (o + 9 < data.length) {
      if (data[o] !== 0xff) return null;
      const marker = data[o + 1]!;
      const len = dv.getUint16(o + 2);
      if (marker >= 0xc0 && marker <= 0xc2)
        return { w: dv.getUint16(o + 7), h: dv.getUint16(o + 5), format: 'jpeg' };
      o += 2 + len;
    }
  }
  return null;
}
