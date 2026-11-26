/**
 * Неоновые вывески-коробки для городов из набора модулей. Раньше вывески строились по
 * коллайдерам блока и в модульных городах оказывались внутри зданий (фасады модулей шире
 * коллайдеров), поэтому были отключены. Теперь вывеска ставится от самого модуля:
 * по габаритам его меша, на фасад, обращённый к улице (+Z модуля в осях three, см.
 * art/scripts/city/build_modules.py — фасад со стороны −Y Блендера).
 */
import * as THREE from 'three';

export interface ModuleBox {
  minX: number;
  maxX: number;
  maxZ: number;
  height: number;
}

export interface SignPlacement {
  /** Центр вывески в мире. */
  x: number;
  y: number;
  z: number;
  /** Размеры: ширина вдоль фасада, высота, толщина. */
  w: number;
  h: number;
  d: number;
  yaw: number;
  color: number;
}

const COLORS = {
  tokyo: [0xff2bd6, 0x29e0ff, 0xff4d5e, 0xffe14d, 0x8cff3a, 0xb56dff],
  moscow: [0xff2bd6, 0x29e0ff, 0x8cff3a, 0xffb02b, 0xff4d5e],
};

const hash = (x: number, z: number) =>
  Math.abs(Math.imul(Math.round(x * 7) ^ Math.imul(Math.round(z * 7), 2654435761), 1597334677));

/**
 * Вывески одного экземпляра модуля — чистая функция (тест): горизонтальная над первым
 * этажом, в «Токио» у высоких зданий — ещё вертикальная у края фасада.
 */
export function signsForModule(
  box: ModuleBox,
  x: number,
  z: number,
  yaw: number,
  sx: number,
  sy: number,
  sz: number,
  style: 'tokyo' | 'moscow',
): SignPlacement[] {
  const h = box.height * sy;
  const width = (box.maxX - box.minX) * sx;
  const k = hash(x, z);
  const every = style === 'tokyo' ? 2 : 4;
  if (k % every !== 0 || h < 9 || width < 6) return [];
  const colors = COLORS[style];
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // Точка модуля (lx, ly, lz) → мир: поворот вокруг Y на yaw, как у матрицы экземпляра
  const at = (lx: number, ly: number, lz: number) => ({
    x: x + lx * c + lz * s,
    y: ly,
    z: z - lx * s + lz * c,
  });
  const front = box.maxZ * sz;
  const cx = ((box.minX + box.maxX) / 2) * sx;
  const out: SignPlacement[] = [
    {
      ...at(cx, Math.min(h - 1.5, 5 + (k % 3) * 2.5), front + 0.2),
      w: Math.min(width * 0.55, 12),
      h: 1.1,
      d: 0.25,
      yaw,
      color: colors[k % colors.length]!,
    },
  ];
  if (style === 'tokyo' && h > 20 && k % 3 !== 2) {
    const vh = Math.min(h * 0.5, 16);
    out.push({
      ...at(box.maxX * sx - 0.8, 8 + vh / 2, front + 0.5),
      w: 0.9,
      h: vh,
      d: 0.35,
      yaw,
      color: colors[(k + 2) % colors.length]!,
    });
  }
  return out;
}

/** Все вывески видимых модулей: InstancedMesh на цвет. */
export class KitSigns {
  readonly group = new THREE.Group();
  private meshes = new Map<number, THREE.InstancedMesh>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(
    readonly style: 'tokyo' | 'moscow',
    private capacity: number,
  ) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    for (const color of COLORS[style]) {
      const im = new THREE.InstancedMesh(
        geo,
        new THREE.MeshBasicMaterial({ color, toneMapped: false }),
        Math.max(1, capacity),
      );
      im.count = 0;
      im.visible = false;
      this.meshes.set(color, im);
      this.group.add(im);
    }
  }

  begin(): void {
    for (const im of this.meshes.values()) im.count = 0;
  }

  add(p: SignPlacement): void {
    const im = this.meshes.get(p.color);
    if (!im || im.count >= this.capacity) return;
    this.m.compose(
      new THREE.Vector3(p.x, p.y, p.z),
      this.q.setFromAxisAngle(this.up, p.yaw),
      new THREE.Vector3(p.w, p.h, p.d),
    );
    im.setMatrixAt(im.count++, this.m);
  }

  end(): void {
    for (const im of this.meshes.values()) {
      im.instanceMatrix.needsUpdate = true;
      im.visible = im.count > 0;
      if (im.count) im.computeBoundingSphere();
    }
  }
}
