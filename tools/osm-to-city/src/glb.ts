/** Минимальный писатель glTF 2.0 (.glb): несколько примитивов, позиции/нормали/цвета/UV, индексы u32. */
export interface Primitive {
  positions: number[];
  normals: number[];
  colors?: number[];
  uvs?: number[];
  indices: number[];
  material: {
    name: string;
    color: [number, number, number, number];
    emissive?: [number, number, number];
    roughness?: number;
    metallic?: number;
  };
}

export function writeGlb(prims: Primitive[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const bufferViews: object[] = [];
  const accessors: object[] = [];
  const pushView = (arr: Float32Array | Uint32Array, target: number) => {
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    const pad = (4 - (bytes.length % 4)) % 4;
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
    chunks.push(bytes);
    if (pad) chunks.push(new Uint8Array(pad));
    offset += bytes.length + pad;
    return bufferViews.length - 1;
  };
  const materials: object[] = [];
  const primitives: object[] = [];
  for (const p of prims) {
    if (p.indices.length === 0) continue;
    const pos = new Float32Array(p.positions);
    const min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k]!, pos[i + k]!);
        max[k] = Math.max(max[k]!, pos[i + k]!);
      }
    const attrs: Record<string, number> = {};
    accessors.push({
      bufferView: pushView(pos, 34962),
      componentType: 5126,
      count: pos.length / 3,
      type: 'VEC3',
      min,
      max,
    });
    attrs.POSITION = accessors.length - 1;
    accessors.push({
      bufferView: pushView(new Float32Array(p.normals), 34962),
      componentType: 5126,
      count: pos.length / 3,
      type: 'VEC3',
    });
    attrs.NORMAL = accessors.length - 1;
    if (p.colors) {
      accessors.push({
        bufferView: pushView(new Float32Array(p.colors), 34962),
        componentType: 5126,
        count: pos.length / 3,
        type: 'VEC3',
      });
      attrs.COLOR_0 = accessors.length - 1;
    }
    if (p.uvs) {
      accessors.push({
        bufferView: pushView(new Float32Array(p.uvs), 34962),
        componentType: 5126,
        count: pos.length / 3,
        type: 'VEC2',
      });
      attrs.TEXCOORD_0 = accessors.length - 1;
    }
    accessors.push({
      bufferView: pushView(new Uint32Array(p.indices), 34963),
      componentType: 5125,
      count: p.indices.length,
      type: 'SCALAR',
    });
    const m = p.material;
    materials.push({
      name: m.name,
      pbrMetallicRoughness: {
        baseColorFactor: m.color,
        roughnessFactor: m.roughness ?? 0.8,
        metallicFactor: m.metallic ?? 0,
      },
      ...(m.emissive ? { emissiveFactor: m.emissive } : {}),
    });
    primitives.push({
      attributes: attrs,
      indices: accessors.length - 1,
      material: materials.length - 1,
    });
  }
  const json = {
    asset: { version: '2.0', generator: 'osm-to-city (street-racer)' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives }],
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: offset }],
  };
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jpad = (4 - (jsonBytes.length % 4)) % 4;
  if (jpad) {
    const j = new Uint8Array(jsonBytes.length + jpad).fill(0x20);
    j.set(jsonBytes);
    jsonBytes = j;
  }
  const total = 12 + 8 + jsonBytes.length + 8 + offset;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // glTF
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true);
  dv.setUint32(16, 0x4e4f534a, true); // JSON
  out.set(jsonBytes, 20);
  let o = 20 + jsonBytes.length;
  dv.setUint32(o, offset, true);
  dv.setUint32(o + 4, 0x004e4942, true); // BIN
  o += 8;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
