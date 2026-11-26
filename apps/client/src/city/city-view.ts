import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { parseCity, registerTrack, tileOf, type City, type Weather } from '@sr/shared';
import type { Quality } from '../render/quality';

/** Загрузка city.json и регистрация городских трасс. */
export async function loadCity(id: string): Promise<City> {
  const res = await fetch(`${import.meta.env.BASE_URL}cities/${id}/city.json`);
  if (!res.ok) throw new Error(`город ${id} не найден`);
  const city = parseCity(await res.json());
  for (const t of city.tracks) registerTrack(t);
  return city;
}

export const CITIES = [
  { id: 'moscow_synth', name: 'Москва (процедурная)', country: 'Россия' },
  { id: 'tokyo_synth', name: 'Токио (процедурный)', country: 'Япония' },
];

function canvasTexture(
  w: number,
  h: number,
  draw: (g: CanvasRenderingContext2D) => void,
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Окна: одна ячейка UV = 4 м × 1 этаж; часть окон светится. */
function windowsTextures(): { map: THREE.Texture; emissive: THREE.Texture } {
  let s = 99;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const N = 8;
  const lit: boolean[] = [];
  for (let i = 0; i < N * N; i++) lit.push(rnd() < 0.42);
  const colors = ['#ffd38a', '#ffe7b8', '#9fd0ff', '#ffb27a'];
  const draw = (g: CanvasRenderingContext2D, emissive: boolean) => {
    g.fillStyle = emissive ? '#000' : '#fff';
    g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const on = lit[y * N + x]!;
        if (emissive) {
          if (!on) continue;
          g.fillStyle = colors[(x * 7 + y * 3) % colors.length]!;
        } else g.fillStyle = on ? '#555' : '#2a2d36';
        g.fillRect(x * 32 + 9, y * 32 + 8, 14, 17);
      }
  };
  return {
    map: canvasTexture(256, 256, (g) => draw(g, false)),
    emissive: canvasTexture(256, 256, (g) => draw(g, true)),
  };
}

/**
 * Город: стриминг блоков 256 м вокруг камеры (glb), фонари вдоль улиц,
 * неон, погода. LOD: дальние блоки на low не грузятся, туман скрывает край.
 */
export class CityView {
  readonly group = new THREE.Group();
  private loader = new GLTFLoader();
  private loaded = new Map<string, THREE.Object3D>();
  private loading = new Set<string>();
  private byKey = new Map<string, City['tiles'][number]>();
  private facade: THREE.MeshStandardMaterial;
  private road: THREE.MeshStandardMaterial;
  private roof: THREE.MeshStandardMaterial;
  private shop: THREE.MeshBasicMaterial;
  private snow: THREE.Points | null = null;
  private rain: THREE.LineSegments | null = null;
  readonly radius: number;

  constructor(
    readonly city: City,
    readonly quality: Quality,
    readonly weather: Weather,
  ) {
    for (const t of city.tiles) this.byKey.set(`${t.i}_${t.j}`, t);
    this.radius = quality.name === 'low' ? 2 : 3;
    const win = windowsTextures();
    // 1 единица UV = одно окно (4 м × этаж); в текстуре 8×8 окон
    win.map.repeat.set(1 / 8, 1 / 8);
    win.emissive.repeat.set(1 / 8, 1 / 8);
    this.facade = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: win.map,
      emissiveMap: win.emissive,
      emissive: 0xffffff,
      emissiveIntensity: 1.1,
      // Ночь: фасады приглушены, светятся окна
      color: 0x6e6e74,
      envMapIntensity: 0.25,
      roughness: 0.85,
      side: THREE.DoubleSide,
    });
    const wet = weather === 'wet';
    const snowy = weather === 'snow';
    const hi = quality.name === 'high';
    this.road = new THREE.MeshStandardMaterial({
      // Цвет покрытия задаём явно: сухо — асфальт, мокро — тёмный блестящий, снег — серая слякоть
      color: snowy ? 0x4a4e55 : wet ? 0x15171c : 0x2a2b30,
      // Мокрый асфальт отражает огни (только high)
      roughness: wet && hi ? 0.28 : 0.85,
      metalness: wet && hi ? 0.35 : 0.05,
      envMapIntensity: wet ? 0.6 : 0.3,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      side: THREE.DoubleSide,
    });
    // Витрины: светящиеся панели с переплётами и тёмной полосой вывески, цвет — из вершин
    const shopTex = canvasTexture(256, 64, (g) => {
      const gr = g.createLinearGradient(0, 64, 0, 14);
      gr.addColorStop(0, '#fff2d6');
      gr.addColorStop(1, '#b49a78');
      g.fillStyle = gr;
      g.fillRect(0, 14, 256, 50);
      g.fillStyle = '#0d0e12';
      g.fillRect(0, 0, 256, 14);
      for (let x = 0; x < 256; x += 64) {
        g.fillRect(x, 14, 5, 50);
        g.fillRect(x + 40, 30, 3, 34);
      }
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.fillRect(12, 4, 90, 5);
      g.fillRect(140, 4, 60, 5);
    });
    this.shop = new THREE.MeshBasicMaterial({
      map: shopTex,
      vertexColors: true,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    this.shop.color.setScalar(quality.name === 'high' ? 1.1 : 0.9);
    this.roof = new THREE.MeshStandardMaterial({
      vertexColors: true,
      color: snowy ? 0xb8c0cc : 0xffffff,
      roughness: 0.95,
      side: THREE.DoubleSide,
    });
    this.buildGround();
    this.buildLamps();
    if (snowy) this.buildSnow();
    if (wet) this.buildRain();
  }

  private buildGround(): void {
    const b = this.city.bounds;
    const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) + 800;
    const color = this.weather === 'snow' ? 0x8d95a3 : 0x1e2027;
    const g = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({ color, roughness: 0.95 }),
    );
    g.rotation.x = -Math.PI / 2;
    g.position.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
    g.receiveShadow = this.quality.shadows;
    this.group.add(g);
  }

  /** Фонари вдоль всех улиц города (инстансы) + световые пятна на асфальте. */
  private buildLamps(): void {
    const spots: { x: number; z: number; yaw: number }[] = [];
    for (const r of this.city.roads) {
      if (r.cls === 'living_street') continue;
      let acc = 0;
      let side = 1;
      for (let i = 1; i < r.points.length; i++) {
        const [ax, az] = r.points[i - 1]!,
          [bx, bz] = r.points[i]!;
        const len = Math.hypot(bx - ax, bz - az);
        const tx = (bx - ax) / len,
          tz = (bz - az) / len;
        for (let d = (35 - acc) % 35; d < len; d += 35) {
          const off = side * (r.width / 2 + 1.2);
          spots.push({
            x: ax + tx * d - tz * off,
            z: az + tz * d + tx * off,
            yaw: Math.atan2(-tz * side, tx * side),
          });
          side = -side;
        }
        acc = (acc + len) % 35;
      }
    }
    const pole = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.12, 0.16, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x30343e, metalness: 0.7, roughness: 0.4 }),
      spots.length,
    );
    const head = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.5, 0.2, 1.4),
      new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false }),
      spots.length,
    );
    const glowTex = canvasTexture(64, 64, (g) => {
      const gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,200,130,0.5)');
      gr.addColorStop(1, 'rgba(255,200,130,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 64, 64);
    });
    const glow = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(15, 15),
      new THREE.MeshBasicMaterial({
        map: glowTex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
      spots.length,
    );
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    spots.forEach((s, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw);
      m.compose(new THREE.Vector3(s.x, 4, s.z), q, one);
      pole.setMatrixAt(i, m);
      const hx = s.x + Math.sin(s.yaw) * 1.2,
        hz = s.z + Math.cos(s.yaw) * 1.2;
      m.compose(new THREE.Vector3(hx, 8, hz), q, one);
      head.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(hx, 0.06, hz), flat, one);
      glow.setMatrixAt(i, m);
    });
    glow.renderOrder = 2;
    this.group.add(pole, head, glow);
  }

  private buildSnow(): void {
    const n = this.quality.name === 'low' ? 1500 : 5000;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++)
      pos.set(
        [(Math.random() - 0.5) * 120, Math.random() * 40, (Math.random() - 0.5) * 120],
        i * 3,
      );
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.snow = new THREE.Points(
      g,
      new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.09,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
      }),
    );
    this.snow.frustumCulled = false;
    this.group.add(this.snow);
  }

  private buildRain(): void {
    const n = this.quality.name === 'low' ? 1200 : 4000;
    const pos = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      const x = (Math.random() - 0.5) * 100,
        y = Math.random() * 40,
        z = (Math.random() - 0.5) * 100;
      pos.set([x, y, z, x + 0.05, y - 0.8, z], i * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.LineSegments(
      g,
      new THREE.LineBasicMaterial({ color: 0x9fb4d6, transparent: true, opacity: 0.35 }),
    );
    this.rain.frustumCulled = false;
    this.group.add(this.rain);
  }

  /** Неоновые вывески на фасадах, обращённых к дороге (из коллайдеров блока). */
  private signMats = new Map<number, THREE.MeshBasicMaterial>();
  private signMat(c: number): THREE.MeshBasicMaterial {
    let m = this.signMats.get(c);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color: c, toneMapped: false });
      this.signMats.set(c, m);
    }
    return m;
  }

  /**
   * Неоновые вывески на фасадах (по коллайдерам блока): горизонтальные над первым этажом,
   * в стиле «Токио» — чаще и ещё вертикальные «столбы» на углах.
   */
  private signsFor(tile: City['tiles'][number]): THREE.Object3D {
    const g = new THREE.Group();
    const tokyo = this.city.style === 'tokyo';
    const colors = tokyo
      ? [0xff2bd6, 0x29e0ff, 0xff4d5e, 0xffe14d, 0x8cff3a, 0xb56dff]
      : [0xff2bd6, 0x29e0ff, 0x8cff3a, 0xffb02b, 0xff4d5e];
    const every = tokyo ? 2 : 4;
    tile.colliders.forEach(([cx, cz, hx, hz, yaw, h], k) => {
      if ((tile.i * 31 + tile.j * 17 + k) % every !== 0 || Math.max(hx, hz) < 3 || h < 9) return;
      const longX = hx >= hz;
      const nx = longX ? Math.sin(yaw) : Math.cos(yaw);
      const nz = longX ? Math.cos(yaw) : -Math.sin(yaw);
      const d = (longX ? hz : hx) + 0.2;
      const rot = longX ? yaw : yaw + Math.PI / 2;
      const sign = new THREE.Mesh(
        new THREE.BoxGeometry(Math.min(Math.max(hx, hz) * 1.2, 14), 1.1, 0.25),
        this.signMat(colors[k % colors.length]!),
      );
      sign.position.set(cx + nx * d, Math.min(h - 1.5, 5 + (k % 3) * 2.5), cz + nz * d);
      sign.rotation.y = rot;
      g.add(sign);
      if (tokyo && h > 20 && k % 3 !== 2) {
        // Вертикальная вывеска у края фасада
        const tx = longX ? Math.cos(yaw) : -Math.sin(yaw);
        const tz = longX ? -Math.sin(yaw) : -Math.cos(yaw);
        const side = (longX ? hx : hz) - 0.8;
        const vh = Math.min(h * 0.5, 16);
        const v = new THREE.Mesh(
          new THREE.BoxGeometry(0.9, vh, 0.35),
          this.signMat(colors[(k + 2) % colors.length]!),
        );
        v.position.set(
          cx + nx * (d + 0.5) + tx * side,
          8 + vh / 2,
          cz + nz * (d + 0.5) + tz * side,
        );
        v.rotation.y = rot;
        g.add(v);
      }
    });
    return g;
  }

  /** Стриминг: загрузить блоки рядом с (x, z), выгрузить дальние. */
  update(x: number, z: number, dt: number): void {
    const [ti, tj] = tileOf(x, z, this.city.blockSize);
    const want = new Set<string>();
    const R = this.radius;
    for (let di = -R; di <= R; di++)
      for (let dj = -R; dj <= R; dj++)
        if (di * di + dj * dj <= R * R + 1) want.add(`${ti + di}_${tj + dj}`);
    for (const [k, obj] of this.loaded) {
      if (want.has(k)) continue;
      this.group.remove(obj);
      obj.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose();
      });
      this.loaded.delete(k);
    }
    // Ближние блоки — первыми
    const order = [...want].sort((a, b) => {
      const [ai, aj] = a.split('_').map(Number),
        [bi, bj] = b.split('_').map(Number);
      return (ai! - ti) ** 2 + (aj! - tj) ** 2 - ((bi! - ti) ** 2 + (bj! - tj) ** 2);
    });
    for (const k of order) {
      if (this.loaded.has(k) || this.loading.has(k) || this.loading.size >= 3) continue;
      const t = this.byKey.get(k);
      if (!t) continue;
      this.loading.add(k);
      this.loader.load(
        `${import.meta.env.BASE_URL}cities/${this.city.id}/${t.file}`,
        (gltf) => {
          this.loading.delete(k);
          const obj = gltf.scene;
          obj.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh) return;
            const name = (mesh.material as THREE.Material).name;
            mesh.material =
              name === 'facade'
                ? this.facade
                : name === 'road'
                  ? this.road
                  : name === 'shop'
                    ? this.shop
                    : this.roof;
            mesh.castShadow = this.quality.shadows && name === 'facade';
            mesh.receiveShadow = this.quality.shadows;
          });
          obj.add(this.signsFor(t));
          // Блок могли уже «разхотеть», пока грузился
          this.loaded.set(k, obj);
          this.group.add(obj);
        },
        undefined,
        () => this.loading.delete(k),
      );
    }

    // Осадки следуют за камерой
    if (this.snow) {
      this.snow.position.set(x, 0, z);
      const p = this.snow.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        let y = p.getY(i) - dt * 2.2;
        if (y < 0) y += 40;
        p.setY(i, y);
        p.setX(i, p.getX(i) + Math.sin(y + i) * dt * 0.3);
      }
      p.needsUpdate = true;
    }
    if (this.rain) {
      this.rain.position.set(x, 0, z);
      const p = this.rain.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i += 2) {
        let y = p.getY(i) - dt * 22;
        if (y < 0) y += 40;
        p.setY(i, y);
        p.setY(i + 1, y - 0.8);
      }
      p.needsUpdate = true;
    }
  }

  get loadedCount(): number {
    return this.loaded.size;
  }
}
