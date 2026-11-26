import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { defaultDressing, placeDressing, type BuiltTrack } from '@sr/shared';
import type { LevelGeometry } from '@sr/physics';
import type { Quality } from './quality';

let gltfLoader: GLTFLoader | null = null;
const loader = () => (gltfLoader ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder));
let dressingPromise: Promise<THREE.Object3D> | null = null;
/** Библиотека оформления трасс (одна загрузка на сессию). */
function dressingLib(): Promise<THREE.Object3D> {
  dressingPromise ??= loader()
    .loadAsync(`${import.meta.env.BASE_URL}tracks/dressing.glb`)
    .then((g) => {
      g.scene.updateMatrixWorld(true);
      return g.scene;
    });
  dressingPromise.catch(() => (dressingPromise = null));
  return dressingPromise;
}

/** Детерминированный ГПСЧ для расстановки декора. */
function rng(seed: number) {
  return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

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
  t.anisotropy = 8;
  return t;
}

function asphaltTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 512, (g) => {
    g.fillStyle = '#2a2b30';
    g.fillRect(0, 0, 256, 512);
    const r = rng(7);
    for (let i = 0; i < 9000; i++) {
      const v = 30 + r() * 40;
      g.fillStyle = `rgb(${v},${v},${v + 4})`;
      g.fillRect(r() * 256, r() * 512, 1.5, 1.5);
    }
    // края
    g.fillStyle = '#d8d8d0';
    g.fillRect(6, 0, 5, 512);
    g.fillRect(245, 0, 5, 512);
    // штриховая осевая
    g.fillStyle = '#e8c14a';
    g.fillRect(125, 0, 6, 300);
  });
}

function groundTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 256, (g) => {
    g.fillStyle = '#15161b';
    g.fillRect(0, 0, 256, 256);
    const r = rng(3);
    for (let i = 0; i < 4000; i++) {
      const v = 18 + r() * 18;
      g.fillStyle = `rgb(${v},${v + 1},${v + 3})`;
      g.fillRect(r() * 256, r() * 256, 2, 2);
    }
    g.strokeStyle = 'rgba(80,90,120,0.25)';
    g.lineWidth = 2;
    g.strokeRect(0, 0, 256, 256);
  });
}

function windowsTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 256, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, 128, 256);
    const r = rng(11);
    const colors = ['#ffd38a', '#ffe7b8', '#9fd0ff', '#ff9a6a'];
    for (let y = 4; y < 256; y += 16) {
      for (let x = 4; x < 128; x += 16) {
        if (r() < 0.38) {
          g.fillStyle = colors[Math.floor(r() * colors.length)]!;
          g.globalAlpha = 0.5 + r() * 0.5;
          g.fillRect(x, y, 9, 10);
        }
      }
    }
    g.globalAlpha = 1;
  });
}

export class LevelView {
  readonly group = new THREE.Group();

  constructor(
    readonly track: BuiltTrack,
    geom: LevelGeometry,
    readonly quality: Quality,
    inCity = false,
  ) {
    this.loadDressing(inCity);
    if (inCity) {
      // Город рисует CityView; здесь только старт и чекпоинты поверх улиц
      this.buildStartLine();
      this.buildCheckpointMarkers();
      return;
    }
    if (track.elevated) this.loadTerrain(track.def.groundSize);
    else this.buildGround(track.def.groundSize);
    this.buildRoad();
    this.buildWalls(geom);
    this.buildRamps(geom);
    this.buildStartLine();
    this.buildLamps();
    if (!track.elevated) this.buildCity();
  }

  /**
   * Оформление (BLENDER_PLAN 7.1): элементы dressing.glb по правилам трассы —
   * один InstancedMesh на элемент (бюджет draw calls). Нет файла — трасса без оформления.
   */
  private loadDressing(inCity: boolean): void {
    const rules = this.track.def.dressing ?? defaultDressing(this.track, inCity);
    const inst = placeDressing(this.track, rules);
    if (!inst.length) return;
    void dressingLib()
      .then((scene) => {
        const gltf = { scene };
        const byItem = new Map<string, typeof inst>();
        for (const i of inst) byItem.set(i.item, [...(byItem.get(i.item) ?? []), i]);
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        const up = new THREE.Vector3(0, 1, 0);
        for (const [item, list] of byItem) {
          const src = gltf.scene.getObjectByName(item) as THREE.Mesh | undefined;
          if (!src?.isMesh) continue;
          const im = new THREE.InstancedMesh(src.geometry, src.material, list.length);
          list.forEach((d, k) => {
            m.compose(
              new THREE.Vector3(d.x, d.y, d.z),
              q.setFromAxisAngle(up, d.yaw),
              new THREE.Vector3(d.sx, 1, 1),
            );
            im.setMatrixAt(k, m.multiply(src.matrixWorld));
          });
          im.computeBoundingSphere();
          im.castShadow = this.quality.shadows;
          this.group.add(im);
        }
      })
      .catch(() => undefined);
  }

  /**
   * Рельеф из Блендера (BLENDER_PLAN 7.2): tracks/terrain_<id>.glb блоками 256 м + сосны и скалы
   * экземплярами элементов dressing.glb. Нет файла — процедурная гора (buildMountain).
   */
  private loadTerrain(size: number): void {
    const id = this.track.def.id;
    const base = `${import.meta.env.BASE_URL}tracks/terrain_${id}`;
    void Promise.all([
      fetch(`${base}.json`).then((r) => {
        if (!r.ok) throw new Error('нет рельефа');
        return r.json() as Promise<{
          instances: [string, number, number, number, number, number][];
        }>;
      }),
      loader().loadAsync(`${base}.glb`),
      dressingLib(),
    ])
      .then(([info, gltf, lib]) => {
        const atlas = (lib.getObjectByName('pine') as THREE.Mesh | undefined)?.material;
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          if (o.name.endsWith('_collision')) {
            o.visible = false; // упрощённая сетка — для физики, если понадобится
            return;
          }
          if (atlas) m.material = atlas;
          m.receiveShadow = this.quality.shadows;
        });
        this.group.add(gltf.scene);
        // Сосны и скалы: по InstancedMesh на элемент; в low — каждое второе
        const keep = this.quality.name === 'low' ? 2 : 1;
        const by = new Map<string, typeof info.instances>();
        info.instances.forEach((d, k) => {
          if (k % keep === 0) by.set(d[0], [...(by.get(d[0]) ?? []), d]);
        });
        lib.updateMatrixWorld(true);
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        const up = new THREE.Vector3(0, 1, 0);
        for (const [item, list] of by) {
          const src = lib.getObjectByName(item) as THREE.Mesh | undefined;
          if (!src?.isMesh) continue;
          const im = new THREE.InstancedMesh(src.geometry, src.material, list.length);
          list.forEach(([, x, y, z, yaw, sc], k) => {
            m.compose(
              new THREE.Vector3(x, y, z),
              q.setFromAxisAngle(up, yaw),
              new THREE.Vector3(sc, sc, sc),
            );
            im.setMatrixAt(k, m.multiply(src.matrixWorld));
          });
          im.computeBoundingSphere();
          im.castShadow = this.quality.shadows;
          this.group.add(im);
        }
      })
      .catch(() => this.buildMountain(size));
  }

  /**
   * Склон горы под серпантином: высота — от ближайшего участка дороги, ниже полотна
   * у края и с рельефом вдали; сосны-конусы на склонах. Только визуал.
   */
  private buildMountain(size: number): void {
    const S = this.track.samples;
    const res = this.quality.name === 'low' ? 80 : 140;
    const g = new THREE.PlaneGeometry(size, size, res, res);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const noise = (x: number, z: number) =>
      Math.sin(x * 0.013) * Math.cos(z * 0.011) * 9 + Math.sin(x * 0.041 + z * 0.023) * 3;
    const heightAt = (x: number, z: number) => {
      let best = Infinity;
      let by = 0;
      let bw = 10;
      for (let i = 0; i < S.length; i += 2) {
        const sm = S[i]!;
        const d = (sm.x - x) ** 2 + (sm.z - z) ** 2;
        if (d < best) {
          best = d;
          by = sm.y;
          bw = sm.width;
        }
      }
      const d = Math.sqrt(best);
      const edge = Math.max(0, d - bw / 2 - 4);
      // У дороги — чуть ниже полотна, дальше — рельеф и спад
      return by - 0.4 - edge * 0.12 + noise(x, z) * Math.min(1, edge / 50);
    };
    for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
    g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1d2a22,
      roughness: 0.95,
      flatShading: true,
    });
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = this.quality.shadows;
    this.group.add(m);

    // Сосны
    let seed = 77;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const count = this.quality.name === 'low' ? 500 : 1400;
    const trees = new THREE.InstancedMesh(
      new THREE.ConeGeometry(2.2, 9, 6),
      new THREE.MeshStandardMaterial({ color: 0x14301f, roughness: 0.9, flatShading: true }),
      count,
    );
    const mx = new THREE.Matrix4();
    let n = 0;
    for (let tries = 0; n < count && tries < count * 6; tries++) {
      const x = (rnd() - 0.5) * size * 0.95;
      const z = (rnd() - 0.5) * size * 0.95;
      let near = Infinity;
      for (let i = 0; i < S.length; i += 6)
        near = Math.min(near, (S[i]!.x - x) ** 2 + (S[i]!.z - z) ** 2);
      if (near < 14 ** 2) continue;
      const sc = 0.7 + rnd() * 0.8;
      mx.compose(
        new THREE.Vector3(x, heightAt(x, z) + 4.5 * sc, z),
        new THREE.Quaternion(),
        new THREE.Vector3(sc, sc, sc),
      );
      trees.setMatrixAt(n++, mx);
    }
    trees.count = n;
    trees.castShadow = this.quality.shadows;
    this.group.add(trees);
  }

  /** Неоновые «ворота» на чекпоинтах — на городских улицах иначе не видно маршрута. */
  private buildCheckpointMarkers(): void {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x29e0ff,
      toneMapped: false,
      transparent: true,
      opacity: 0.85,
    });
    // Столбики — один InstancedMesh (бюджет draw calls 10.5), а не меш на столбик
    const cps = this.track.checkpoints.slice(0, -1);
    const posts = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.15, 0.15, 4, 6),
      mat,
      cps.length * 2,
    );
    const pm = new THREE.Matrix4();
    let pi = 0;
    for (const cp of cps) {
      for (const side of [-1, 1]) {
        const off = side * (cp.halfWidth - 2);
        posts.setMatrixAt(pi++, pm.makeTranslation(cp.x - cp.tz * off, 2, cp.z + cp.tx * off));
      }
    }
    this.group.add(posts);
    // Стрелки-шевроны на асфальте вдоль трассы
    const chevTex = canvasTexture(64, 64, (g) => {
      g.strokeStyle = 'rgba(41,224,255,0.9)';
      g.lineWidth = 8;
      g.beginPath();
      g.moveTo(12, 44);
      g.lineTo(32, 20);
      g.lineTo(52, 44);
      g.stroke();
    });
    const S = this.track.samples;
    const every = 30;
    const chev = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(4, 4),
      new THREE.MeshBasicMaterial({
        map: chevTex,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
      Math.ceil(S.length / every),
    );
    const m = new THREE.Matrix4();
    let n = 0;
    for (let i = 0; i < S.length; i += every) {
      const s = S[i]!;
      const q = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(-Math.PI / 2, 0, Math.atan2(-s.tx, -s.tz), 'YXZ'),
      );
      q.setFromEuler(new THREE.Euler(-Math.PI / 2, Math.atan2(-s.tx, -s.tz), 0, 'YXZ'));
      m.compose(new THREE.Vector3(s.x, 0.08, s.z), q, new THREE.Vector3(1, 1, 1));
      chev.setMatrixAt(n++, m);
    }
    chev.count = n;
    chev.renderOrder = 3;
    this.group.add(chev);
  }

  private buildGround(size: number): void {
    const tex = groundTexture();
    tex.repeat.set(size / 16, size / 16);
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 }),
    );
    m.rotation.x = -Math.PI / 2;
    m.receiveShadow = this.quality.shadows;
    this.group.add(m);
  }

  private ribbon(
    offsetA: (w: number) => number,
    offsetB: (w: number) => number,
    y: number,
    vScale: number,
  ): THREE.BufferGeometry {
    const S = this.track.samples;
    const closed = this.track.def.closed;
    const n = S.length + (closed ? 1 : 0);
    const pos = new Float32Array(n * 2 * 3);
    const uv = new Float32Array(n * 2 * 2);
    const idx: number[] = [];
    for (let k = 0; k < n; k++) {
      const s = S[k % S.length]!;
      const sv = k === S.length ? this.track.length : s.s;
      const rx = -s.tz,
        rz = s.tx;
      const a = offsetA(s.width),
        b = offsetB(s.width);
      pos.set([s.x + rx * a, y + s.y, s.z + rz * a, s.x + rx * b, y + s.y, s.z + rz * b], k * 6);
      uv.set([0, sv / vScale, 1, sv / vScale], k * 4);
      if (k < n - 1) {
        const i = k * 2;
        idx.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  private buildRoad(): void {
    const tex = asphaltTexture();
    const road = new THREE.Mesh(
      this.ribbon(
        (w) => -w / 2,
        (w) => w / 2,
        0.02,
        12,
      ),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, metalness: 0.05 }),
    );
    road.receiveShadow = this.quality.shadows;
    this.group.add(road);
    // Обочина-поребрик (красно-белый)
    const curbTex = canvasTexture(16, 64, (g) => {
      g.fillStyle = '#c8283a';
      g.fillRect(0, 0, 16, 32);
      g.fillStyle = '#eee';
      g.fillRect(0, 32, 16, 32);
    });
    const curbMat = new THREE.MeshStandardMaterial({ map: curbTex, roughness: 0.6 });
    const off = this.track.def.wallOffset;
    for (const side of [-1, 1]) {
      const g = this.ribbon(
        (w) => side * (w / 2),
        (w) => side * (w / 2 + Math.min(off, 1.2)),
        0.03,
        4,
      );
      const m = new THREE.Mesh(g, curbMat);
      if (side < 0) (m.material as THREE.Material).side = THREE.DoubleSide;
      this.group.add(m);
    }
  }

  private buildWalls(geom: LevelGeometry): void {
    const walls = geom.boxes.filter((b) => b.kind === 'wall');
    const box = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0x6a6f7c, roughness: 0.6, metalness: 0.2 });
    const inst = new THREE.InstancedMesh(box, mat, walls.length);
    const strip = new THREE.InstancedMesh(
      box,
      new THREE.MeshBasicMaterial({ color: 0x29e0ff, toneMapped: false }),
      walls.length,
    );
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    walls.forEach((w, i) => {
      // На серпантине коллайдер выше видимой стены — рисуем видимую часть
      const b = w.visual ? { ...w, y: w.visual.y, hy: w.visual.hy } : w;
      q.setFromEuler(new THREE.Euler(b.pitch ?? 0, b.yaw, 0, 'YXZ'));
      m.compose(
        new THREE.Vector3(b.x, b.y, b.z),
        q,
        new THREE.Vector3(b.hx * 2, b.hy * 2, b.hz * 2),
      );
      inst.setMatrixAt(i, m);
      m.compose(
        new THREE.Vector3(b.x, b.y + b.hy - 0.25, b.z),
        q,
        new THREE.Vector3(b.hx * 2 + 0.04, 0.06, b.hz * 2),
      );
      strip.setMatrixAt(i, m);
    });
    inst.castShadow = inst.receiveShadow = this.quality.shadows;
    this.group.add(inst, strip);
  }

  private buildRamps(geom: LevelGeometry): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0xd9a531, roughness: 0.5, metalness: 0.3 });
    for (const w of geom.wedges) {
      const v = w.vertices;
      // 6 вершин: [L0, L1, L1top, R0, R1, R1top]
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3));
      g.setIndex([0, 2, 1, 3, 4, 5, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 4, 0, 1, 4, 0, 4, 3]);
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, mat);
      mat.side = THREE.DoubleSide;
      mesh.castShadow = this.quality.shadows;
      this.group.add(mesh);
    }
  }

  private buildStartLine(): void {
    const s0 =
      this.track.samples[Math.round(this.track.def.startS / 2) % this.track.samples.length]!;
    const tex = canvasTexture(64, 16, (g) => {
      for (let x = 0; x < 16; x++)
        for (let y = 0; y < 4; y++) {
          g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
          g.fillRect(x * 4, y * 4, 4, 4);
        }
    });
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.set(s0.width / 4, 1);
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(s0.width, 2),
      new THREE.MeshStandardMaterial({ map: tex }),
    );
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.atan2(-s0.tx, -s0.tz);
    m.position.set(s0.x, s0.y + 0.04, s0.z);
    this.group.add(m);
    // Арка старта
    const arch = new THREE.Group();
    const postMat = new THREE.MeshStandardMaterial({
      color: 0x222633,
      metalness: 0.6,
      roughness: 0.4,
    });
    const neon = new THREE.MeshBasicMaterial({ color: 0xff2bd6, toneMapped: false });
    const hw = s0.width / 2 + 2;
    for (const side of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.6, 7, 0.6), postMat);
      p.position.set(side * hw, 3.5, 0);
      arch.add(p);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 0.6, 1.2, 0.8), postMat);
    beam.position.y = 7;
    const beamNeon = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 0.6, 0.15, 0.85), neon);
    beamNeon.position.y = 6.35;
    arch.add(beam, beamNeon);
    arch.position.set(s0.x, s0.y, s0.z);
    arch.rotation.y = Math.atan2(-s0.tx, -s0.tz);
    this.group.add(arch);
  }

  private buildLamps(): void {
    const S = this.track.samples;
    const every = 18; // ~36 м
    const spots: { x: number; z: number; yaw: number; y: number }[] = [];
    for (let i = 0; i < S.length; i += every) {
      const s = S[i]!;
      const side = (i / every) % 2 === 0 ? 1 : -1;
      const off = side * (s.width / 2 + this.track.def.wallOffset + 2.2);
      spots.push({
        x: s.x - s.tz * off,
        z: s.z + s.tx * off,
        yaw: Math.atan2(-s.tz * side, s.tx * side),
        y: s.y,
      });
    }
    const pole = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.12, 0.16, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x30343e, metalness: 0.7, roughness: 0.4 }),
      spots.length,
    );
    const head = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.5, 0.2, 1.6),
      new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false }),
      spots.length,
    );
    // Пятно света на асфальте — дешёвая подделка освещения (работает и на low)
    const glowTex = canvasTexture(64, 64, (g) => {
      const gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,200,130,0.55)');
      gr.addColorStop(1, 'rgba(255,200,130,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 64, 64);
    });
    const glow = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(16, 16),
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
      m.compose(new THREE.Vector3(s.x, s.y + 4, s.z), q, one);
      pole.setMatrixAt(i, m);
      const hx = s.x - Math.sin(s.yaw) * -1.2,
        hz = s.z - Math.cos(s.yaw) * -1.2;
      m.compose(new THREE.Vector3(hx, s.y + 8, hz), q, one);
      head.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(hx, s.y + 0.05, hz), flat, one);
      glow.setMatrixAt(i, m);
    });
    glow.renderOrder = 1;
    this.group.add(pole, head, glow);
    this.lampSpots = spots;
  }

  lampSpots: { x: number; z: number; yaw: number }[] = [];

  /** Застройка вокруг полигона — силуэты ночного города. */
  private buildCity(): void {
    const r = rng(1234);
    const half = this.track.def.groundSize / 2;
    const S = this.track.samples;
    const tooClose = (x: number, z: number, rad: number) => {
      for (let i = 0; i < S.length; i += 4) {
        const s = S[i]!;
        if ((s.x - x) ** 2 + (s.z - z) ** 2 < (s.width / 2 + rad + 12) ** 2) return true;
      }
      return false;
    };
    const winTex = windowsTexture();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1b1e28,
      roughness: 0.8,
      emissive: 0xffffff,
      emissiveMap: winTex,
      emissiveIntensity: 0.9,
    });
    const items: THREE.Matrix4[] = [];
    const target = this.quality.name === 'low' ? 140 : 320;
    let tries = 0;
    while (items.length < target && tries++ < 5000) {
      const x = (r() * 2 - 1) * (half - 20);
      const z = (r() * 2 - 1) * (half - 20);
      const w = 12 + r() * 26,
        d = 12 + r() * 26;
      const h = 10 + r() * r() * 90;
      if (tooClose(x, z, Math.max(w, d) / 2)) continue;
      items.push(
        new THREE.Matrix4().compose(
          new THREE.Vector3(x, h / 2, z),
          new THREE.Quaternion(),
          new THREE.Vector3(w, h, d),
        ),
      );
    }
    // Кольцо высоток по периметру
    for (let i = 0; i < 80; i++) {
      const a = (i / 80) * Math.PI * 2;
      const rad = half + 30 + r() * 60;
      const h = 30 + r() * 120;
      items.push(
        new THREE.Matrix4().compose(
          new THREE.Vector3(Math.cos(a) * rad, h / 2, Math.sin(a) * rad),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a),
          new THREE.Vector3(30 + r() * 30, h, 25 + r() * 20),
        ),
      );
    }
    const g = new THREE.BoxGeometry(1, 1, 1);
    // UV по высоте — окна не растягиваются (приблизительно, через масштаб в шейдере не делаем)
    const inst = new THREE.InstancedMesh(g, mat, items.length);
    items.forEach((m, i) => inst.setMatrixAt(i, m));
    this.group.add(inst);

    // Неоновые вывески на некоторых зданиях
    const neonColors = [0xff2bd6, 0x29e0ff, 0x8cff3a, 0xffb02b];
    const signs = new THREE.Group();
    for (let i = 0; i < items.length; i += 5) {
      const p = new THREE.Vector3(),
        s = new THREE.Vector3(),
        qq = new THREE.Quaternion();
      items[i]!.decompose(p, qq, s);
      const sign = new THREE.Mesh(
        new THREE.BoxGeometry(s.x * 0.7, 1.4, 0.3),
        new THREE.MeshBasicMaterial({
          color: neonColors[i % neonColors.length]!,
          toneMapped: false,
        }),
      );
      sign.position.set(p.x, Math.min(s.y - 2, 6 + r() * 10), p.z + s.z / 2 + 0.2);
      signs.add(sign);
    }
    this.group.add(signs);
  }
}
