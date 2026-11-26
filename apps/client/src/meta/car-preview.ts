/**
 * 3D-примерка в ателье (9.4): своя машина игрока на подиуме, медленно крутится,
 * тянется пальцем или мышью. Отдельный небольшой рендерер — только пока открыт экран.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { SMOKE_COLORS, applyTuning, getCar, resolveVisual } from '@sr/shared';
import { CarView, type CarViewOptions } from '../render/car';

/** Визуальные слоты гаража → параметры CarView (как в гонке, см. game/race.ts). */
export function viewOptions(visual: Record<string, string>): CarViewOptions {
  const v = resolveVisual(visual);
  const paint = v.paint;
  const neon = v.neon;
  return {
    color: paint?.startsWith('#') ? parseInt(paint.slice(1), 16) : 0xe8eef7,
    neon:
      neon === 'off' ? undefined : neon?.startsWith('#') ? parseInt(neon.slice(1), 16) : 0x29e0ff,
    paint,
    neonFx: neon && !neon.startsWith('#') && neon !== 'off' ? neon : undefined,
    vinyl: v.livery,
    rims: v.rims,
    spoiler: v.spoiler,
    kit: v.kit,
    paint2: v.paint2,
  };
}

let puffTex: THREE.Texture | null = null;
/** Мягкое круглое пятно для частиц дыма. */
function puff(): THREE.Texture {
  if (puffTex) return puffTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  puffTex = new THREE.CanvasTexture(c);
  return puffTex;
}

export class CarPreview {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  private view: CarView | null = null;
  private smoke: THREE.Points | null = null;
  private yaw = 2.4;
  private drag: number | null = null;
  private idleAt = 0;
  private raf = 0;
  private last = performance.now();

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'car-preview';
    parent.appendChild(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(4, 6, 3);
    this.scene.add(key, new THREE.HemisphereLight(0x9fb8ff, 0x1a1020, 0.7));
    // Подиум
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(3.4, 64),
      new THREE.MeshStandardMaterial({ color: 0x07080d, roughness: 0.55, metalness: 0.4 }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(3.3, 3.4, 96),
      new THREE.MeshBasicMaterial({ color: 0x29e0ff }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.002;
    this.scene.add(ring);

    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      this.drag = e.clientX;
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (this.drag === null) return;
      this.yaw -= (e.clientX - this.drag) * 0.01;
      this.drag = e.clientX;
      this.idleAt = performance.now() + 2500;
    });
    c.addEventListener('pointerup', () => (this.drag = null));
    this.loop();
  }

  /** Показать машину в этом виде (примерка — тот же вызов с изменённым слотом). */
  show(carId: string, visual: Record<string, string>, parts: Record<string, number> = {}): void {
    if (this.view) {
      this.scene.remove(this.view.root);
      this.view.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    const cfg = applyTuning(getCar(carId), parts);
    const view = new CarView(cfg, viewOptions(visual));
    const w = cfg.wheels;
    const susp = cfg.suspension.restLength * 0.75;
    let i = 0;
    for (const front of [true, false])
      for (const left of [true, false])
        view.setWheel(
          i++,
          new THREE.Vector3(
            (left ? -1 : 1) * (w.track / 2),
            w.mountY,
            (front ? -1 : 1) * (w.wheelbase / 2),
          ),
          susp,
          front ? 0.25 : 0,
          0,
          left,
        );
    // Колёса стоят на подиуме
    view.root.position.y = w.radius - (w.mountY - susp);
    this.scene.add(view.root);
    this.view = view;
    this.setSmoke(resolveVisual(visual).smoke);
    // Камера — по длине машины
    const len = w.wheelbase + 1.6;
    this.camera.position.set(0, 1.5, len * 1.7);
    this.camera.lookAt(0, 0.5, 0);
  }

  /** Цветной дым: облачко у задних колёс, чтобы было видно цвет. */
  private setSmoke(id?: string): void {
    if (this.smoke) this.view?.root.parent?.remove(this.smoke);
    this.smoke = null;
    const hex = id ? SMOKE_COLORS[id] : undefined;
    if (!hex || !this.view) return;
    const n = 60;
    const pos = new Float32Array(n * 3);
    const w = this.view.root.position;
    for (let k = 0; k < n; k++) {
      const s = k % 2 ? 1 : -1;
      pos.set(
        [s * (0.9 + Math.random() * 0.8), 0.2 + Math.random() * 0.7, 1.4 + Math.random() * 1.4],
        k * 3,
      );
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.smoke = new THREE.Points(
      g,
      new THREE.PointsMaterial({
        color: hex,
        size: 0.7,
        map: puff(),
        alphaTest: 0.01,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      }),
    );
    this.smoke.position.y = -w.y + 0.1;
    this.view.root.add(this.smoke);
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const c = this.canvas;
    const wpx = c.clientWidth;
    const hpx = c.clientHeight;
    if (
      wpx &&
      hpx &&
      (c.width !== Math.round(wpx * this.renderer.getPixelRatio()) ||
        this.camera.aspect !== wpx / hpx)
    ) {
      this.renderer.setSize(wpx, hpx, false);
      this.camera.aspect = wpx / hpx;
      this.camera.updateProjectionMatrix();
    }
    if (this.drag === null && now > this.idleAt) this.yaw += dt * 0.35;
    if (this.view) {
      this.view.root.rotation.y = this.yaw;
      this.view.setNitro(false, now / 1000);
    }
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.renderer.dispose();
    this.canvas.remove();
  }
}
