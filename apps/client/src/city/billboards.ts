/**
 * Вымышленные бренды на щитах города: модуль `prop_billboard` из набора модулей даёт
 * пустые лайтбоксы, клиент кладёт поверх по картинке бренда на каждую сторону
 * (art/scripts/city/build_modules.py, prop_billboard). Бренды — `CITY_BRANDS` в shared.
 */
import * as THREE from 'three';
import { CITY_BRANDS, type CityBrand } from '@sr/shared';

/** Лайтбокс в осях модуля (three): ширина 8,6 м, высота 6,2–9,0 м, стороны — z = ±0,31. */
export const PANEL = { w: 8.6, h: 2.8, y: 7.6, z: 0.33 };

/** Бренд для стороны щита — по месту, стабильно между загрузками блоков. */
export function brandIndex(x: number, z: number, side: number, n: number): number {
  const h =
    Math.imul(Math.round(x * 10) ^ Math.imul(Math.round(z * 10), 73856093), 19349663) ^ side;
  return ((h % n) + n) % n;
}

function brandTexture(b: CityBrand): THREE.Texture {
  const W = 1024;
  const H = Math.round((W * PANEL.h) / PANEL.w);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const gr = g.createLinearGradient(0, 0, W, H);
  gr.addColorStop(0, b.bg);
  gr.addColorStop(1, '#000000');
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = b.fg;
  g.lineWidth = 10;
  g.shadowColor = b.fg;
  g.shadowBlur = 24;
  g.strokeRect(18, 18, W - 36, H - 36);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = b.fg;
  let size = 150;
  g.font = `italic 900 ${size}px Inter, system-ui, sans-serif`;
  while (g.measureText(b.name).width > W - 120 && size > 60) {
    size -= 6;
    g.font = `italic 900 ${size}px Inter, system-ui, sans-serif`;
  }
  g.fillText(b.name, W / 2, H * 0.44);
  g.shadowBlur = 0;
  g.fillStyle = '#f4f7ff';
  g.font = `600 ${Math.round(size * 0.36)}px Inter, system-ui, sans-serif`;
  g.fillText(b.tag, W / 2, H * 0.78);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Картинки брендов на всех щитах набора: InstancedMesh на бренд. */
export class Billboards {
  readonly meshes: THREE.InstancedMesh[] = [];
  private local: THREE.Matrix4[];

  constructor(kit: string, maxPanels: number) {
    const brands = CITY_BRANDS[kit] ?? CITY_BRANDS.moscow ?? [];
    const geo = new THREE.PlaneGeometry(PANEL.w, PANEL.h);
    for (const b of brands) {
      const im = new THREE.InstancedMesh(
        geo,
        new THREE.MeshBasicMaterial({ map: brandTexture(b), toneMapped: false }),
        Math.max(1, maxPanels),
      );
      im.count = 0;
      im.visible = false;
      this.meshes.push(im);
    }
    // Две стороны: лицом к +z и (развёрнутая) к −z
    this.local = [1, -1].map((s) =>
      new THREE.Matrix4().compose(
        new THREE.Vector3(0, PANEL.y, s * PANEL.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s > 0 ? 0 : Math.PI),
        new THREE.Vector3(1, 1, 1),
      ),
    );
  }

  begin(): void {
    for (const im of this.meshes) im.count = 0;
  }

  /** Щит в точке (x, z) с поворотом и масштабом экземпляра модуля. */
  add(base: THREE.Matrix4, x: number, z: number): void {
    const n = this.meshes.length;
    if (!n) return;
    this.local.forEach((l, side) => {
      const im = this.meshes[brandIndex(x, z, side, n)]!;
      if (im.count >= im.instanceMatrix.count) return;
      im.setMatrixAt(im.count++, new THREE.Matrix4().multiplyMatrices(base, l));
    });
  }

  end(): void {
    for (const im of this.meshes) {
      im.instanceMatrix.needsUpdate = true;
      im.visible = im.count > 0;
      if (im.count) im.computeBoundingSphere();
    }
  }
}
