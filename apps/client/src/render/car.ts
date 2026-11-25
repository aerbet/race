import * as THREE from 'three';
import type { CarConfig } from '@sr/shared';

/**
 * Low-poly кузов из собственного профиля (экструзия боковой проекции) — без внешних моделей.
 * Перед машины — −Z.
 */
const PROFILES: Record<string, [number, number][]> = {
  // [доля длины от носа 0..1, доля высоты 0..1]
  '2000': [
    [0, 0.18],
    [0.02, 0.42],
    [0.22, 0.5],
    [0.38, 0.56],
    [0.5, 0.95],
    [0.72, 0.97],
    [0.9, 0.62],
    [1, 0.6],
    [1, 0.2],
    [0.97, 0.05],
    [0.03, 0.05],
  ],
  '2026': [
    [0, 0.2],
    [0.02, 0.48],
    [0.2, 0.58],
    [0.34, 0.64],
    [0.48, 1],
    [0.84, 0.98],
    [0.97, 0.78],
    [1, 0.6],
    [1, 0.2],
    [0.97, 0.05],
    [0.03, 0.05],
  ],
};

export interface CarViewOptions {
  color: number;
  neon?: number;
  ghost?: boolean;
}

export class CarView {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly wheels: THREE.Group[] = [];
  private brakeMat: THREE.MeshBasicMaterial;
  private nitroFlames: THREE.Mesh[] = [];
  readonly cfg: CarConfig;

  constructor(cfg: CarConfig, opts: CarViewOptions) {
    this.cfg = cfg;
    const { width: W, height: H, length: L } = cfg.body;
    const prof = PROFILES[cfg.era] ?? PROFILES['2000']!;
    const shape = new THREE.Shape();
    prof.forEach(([fz, fy], i) => {
      const z = -L / 2 + fz * L;
      const y = -H / 2 + fy * H;
      if (i === 0) shape.moveTo(z, y);
      else shape.lineTo(z, y);
    });
    shape.closePath();
    const ext = new THREE.ExtrudeGeometry(shape, {
      depth: W,
      bevelEnabled: true,
      bevelSize: 0.06,
      bevelThickness: 0.08,
      bevelSegments: 2,
      steps: 1,
    });
    // экструзия по +Z → поворачиваем так, чтобы профиль лежал в плоскости ZY, ширина — по X
    ext.rotateY(-Math.PI / 2);
    ext.translate(W / 2, 0, 0);
    ext.computeVertexNormals();

    const paint = new THREE.MeshStandardMaterial({
      color: opts.color,
      metalness: 0.6,
      roughness: 0.32,
      transparent: !!opts.ghost,
      opacity: opts.ghost ? 0.35 : 1,
      depthWrite: !opts.ghost,
    });
    const shell = new THREE.Mesh(ext, paint);
    shell.castShadow = !opts.ghost;
    this.body.add(shell);

    // Стёкла
    const glass = new THREE.MeshStandardMaterial({
      color: 0x0b0f18,
      metalness: 0.9,
      roughness: 0.1,
      transparent: !!opts.ghost,
      opacity: opts.ghost ? 0.3 : 1,
    });
    const roofStart = prof.findIndex((p) => p[1] > 0.9);
    const ws = prof[roofStart - 1]!,
      wr = prof[roofStart]!;
    const cabinLen = (prof[roofStart + 1]![0] - wr[0]) * L;
    const gl = new THREE.Mesh(
      new THREE.BoxGeometry(W * 0.86, H * 0.28, cabinLen + (wr[0] - ws[0]) * L * 0.6),
      glass,
    );
    gl.position.set(0, -H / 2 + H * 0.78, -L / 2 + (wr[0] + cabinLen / L / 2) * L);
    this.body.add(gl);

    if (!opts.ghost) {
      // Фары
      const head = new THREE.MeshBasicMaterial({ color: 0xf4f7ff, toneMapped: false });
      for (const s of [-1, 1]) {
        const f = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 0.05), head);
        f.position.set(s * (W / 2 - 0.3), -H / 2 + H * 0.38, -L / 2 - 0.06);
        this.body.add(f);
      }
      // Стопы
      this.brakeMat = new THREE.MeshBasicMaterial({ color: 0x701010, toneMapped: false });
      for (const s of [-1, 1]) {
        const t = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.05), this.brakeMat);
        t.position.set(s * (W / 2 - 0.3), -H / 2 + H * 0.5, L / 2 + 0.06);
        this.body.add(t);
      }
      // Спойлер для «нулевых»
      if (cfg.era === '2000') {
        const sp = new THREE.Mesh(new THREE.BoxGeometry(W * 0.9, 0.05, 0.3), paint);
        sp.position.set(0, -H / 2 + H * 0.78, L / 2 - 0.2);
        this.body.add(sp);
        for (const s of [-1, 1]) {
          const st = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.12), paint);
          st.position.set(s * W * 0.35, -H / 2 + H * 0.69, L / 2 - 0.2);
          this.body.add(st);
        }
      }
      // Неон под днищем
      if (opts.neon !== undefined) {
        const glowTex = makeGlow();
        const glow = new THREE.Mesh(
          new THREE.PlaneGeometry(W * 1.8, L * 1.3),
          new THREE.MeshBasicMaterial({
            map: glowTex,
            color: opts.neon,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
        );
        glow.rotation.x = -Math.PI / 2;
        glow.position.y = -H / 2 - 0.25;
        glow.name = 'neon';
        this.root.add(glow);
      }
      // Пламя нитро
      const flameMat = new THREE.MeshBasicMaterial({
        color: 0x6fb8ff,
        transparent: true,
        opacity: 0.85,
        toneMapped: false,
      });
      for (const s of [-1, 1]) {
        const f = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.8, 8), flameMat);
        f.rotation.x = Math.PI / 2;
        f.position.set(s * 0.35, -H / 2 + 0.22, L / 2 + 0.45);
        f.visible = false;
        this.body.add(f);
        this.nitroFlames.push(f);
      }
    } else {
      this.brakeMat = new THREE.MeshBasicMaterial();
    }
    this.root.add(this.body);

    // Колёса
    const R = cfg.wheels.radius;
    const tireMat = new THREE.MeshStandardMaterial({
      color: 0x111111,
      roughness: 0.9,
      transparent: !!opts.ghost,
      opacity: opts.ghost ? 0.3 : 1,
    });
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0xb8bcc6,
      metalness: 0.9,
      roughness: 0.25,
      transparent: !!opts.ghost,
      opacity: opts.ghost ? 0.3 : 1,
    });
    for (let i = 0; i < 4; i++) {
      const wg = new THREE.Group();
      const spinner = new THREE.Group();
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(R, R, cfg.wheels.width, 18), tireMat);
      tire.rotation.z = Math.PI / 2;
      tire.castShadow = !opts.ghost;
      const rim = new THREE.Mesh(
        new THREE.CylinderGeometry(R * 0.62, R * 0.62, cfg.wheels.width + 0.02, 5),
        rimMat,
      );
      rim.rotation.z = Math.PI / 2;
      spinner.add(tire, rim);
      spinner.name = 'spin';
      wg.add(spinner);
      this.wheels.push(wg);
      this.root.add(wg);
    }
  }

  setBraking(on: boolean): void {
    this.brakeMat.color.setHex(on ? 0xff2020 : 0x701010);
  }

  setNitro(on: boolean, t: number): void {
    for (const f of this.nitroFlames) {
      f.visible = on;
      if (on) f.scale.set(1, 0.7 + Math.sin(t * 60) * 0.3, 1);
    }
  }

  /**
   * Позиция колёс: локальная точка крепления + длина подвески, поворот руля и вращение.
   */
  setWheel(
    i: number,
    local: THREE.Vector3,
    suspensionLength: number,
    steer: number,
    spin: number,
    left: boolean,
  ): void {
    const wg = this.wheels[i]!;
    wg.position.set(local.x + (left ? 0.04 : -0.04), local.y - suspensionLength, local.z);
    wg.rotation.set(0, -steer, 0);
    const sp = wg.getObjectByName('spin')!;
    sp.rotation.x = -spin;
  }
}

let glowCache: THREE.Texture | null = null;
function makeGlow(): THREE.Texture {
  if (glowCache) return glowCache;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  glowCache = new THREE.CanvasTexture(c);
  return glowCache;
}
