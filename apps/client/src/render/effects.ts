import * as THREE from 'three';
import type { Quality } from './quality';

/** Следы шин: кольцевой буфер четырёхугольников. */
export class SkidMarks {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array;
  private alpha: Float32Array;
  private i = 0;
  private last = new Map<number, { x: number; z: number; rx: number; rz: number }>();

  constructor(readonly max: number) {
    this.pos = new Float32Array(max * 4 * 3);
    this.alpha = new Float32Array(max * 4);
    const idx = new Uint32Array(max * 6);
    for (let q = 0; q < max; q++)
      idx.set([q * 4, q * 4 + 2, q * 4 + 1, q * 4 + 1, q * 4 + 2, q * 4 + 3], q * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: `attribute float alpha; varying float vA; void main(){ vA=alpha; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
      fragmentShader: `varying float vA; void main(){ gl_FragColor=vec4(0.02,0.02,0.02,vA*0.75);} `,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  /** key — уникальный id колеса; strength 0..1 (0 — разрыв следа). */
  add(
    key: number,
    x: number,
    z: number,
    dirX: number,
    dirZ: number,
    width: number,
    strength: number,
  ): void {
    if (strength <= 0.05) {
      this.last.delete(key);
      return;
    }
    const l = Math.hypot(dirX, dirZ) || 1;
    const rx = (-dirZ / l) * width * 0.5,
      rz = (dirX / l) * width * 0.5;
    const prev = this.last.get(key);
    this.last.set(key, { x, z, rx, rz });
    if (!prev) return;
    if ((prev.x - x) ** 2 + (prev.z - z) ** 2 < 0.04) {
      this.last.set(key, prev);
      return;
    }
    const q = this.i % this.max;
    const y = 0.045;
    this.pos.set(
      [
        prev.x - prev.rx,
        y,
        prev.z - prev.rz,
        prev.x + prev.rx,
        y,
        prev.z + prev.rz,
        x - rx,
        y,
        z - rz,
        x + rx,
        y,
        z + rz,
      ],
      q * 12,
    );
    const a = Math.min(1, strength);
    this.alpha.set([a, a, a, a], q * 4);
    this.i++;
    const g = this.mesh.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.alpha as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Дым из-под колёс: простые частицы-спрайты. */
export class Smoke {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private size: Float32Array;
  private color: Float32Array;
  private i = 0;

  constructor(readonly max: number) {
    this.color = new Float32Array(max * 3);
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.size = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('life', new THREE.BufferAttribute(this.life, 1));
    g.setAttribute('psize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('tint', new THREE.BufferAttribute(this.color, 3));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { scale: { value: window.innerHeight / 2 } },
      vertexShader: `attribute float life; attribute float psize; attribute vec3 tint; uniform float scale; varying float vL; varying vec3 vC;
        void main(){ vL=life; vC=tint; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize = psize*scale/(-mv.z); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `varying float vL; varying vec3 vC; void main(){ vec2 c=gl_PointCoord-0.5; float d=length(c); if(d>0.5) discard;
        float a = (1.0-d*2.0) * vL * 0.35; gl_FragColor=vec4(vC, a);} `,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
  }

  /** Частица дыма; color — цветной дым из ателье, по умолчанию серый. */
  emit(x: number, y: number, z: number, vx: number, vz: number, color?: THREE.Color): void {
    const i = this.i++ % this.max;
    if (color) this.color.set([color.r, color.g, color.b], i * 3);
    else this.color.set([0.75, 0.76, 0.8], i * 3);
    (this.points.geometry.attributes.tint as THREE.BufferAttribute).needsUpdate = true;
    this.pos.set([x, y, z], i * 3);
    this.vel.set(
      [
        vx * 0.15 + (Math.random() - 0.5),
        0.8 + Math.random() * 0.6,
        vz * 0.15 + (Math.random() - 0.5),
      ],
      i * 3,
    );
    this.life[i] = 1;
    this.size[i] = 0.8;
  }

  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i]! <= 0) continue;
      this.life[i] = Math.max(0, this.life[i]! - dt * 0.7);
      this.size[i]! += dt * 2.2;
      this.pos[i * 3]! += this.vel[i * 3]! * dt;
      this.pos[i * 3 + 1]! += this.vel[i * 3 + 1]! * dt;
      this.pos[i * 3 + 2]! += this.vel[i * 3 + 2]! * dt;
    }
    const g = this.points.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.life as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.psize as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Линии скорости — экранный оверлей (canvas), только пресет high. */
export class SpeedLines {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private lines: { a: number; r: number; v: number; len: number }[] = [];

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'speedlines';
    parent.appendChild(this.canvas);
    this.g = this.canvas.getContext('2d')!;
    for (let i = 0; i < 70; i++) this.lines.push(this.spawn());
  }

  private spawn() {
    return {
      a: Math.random() * Math.PI * 2,
      r: 0.3 + Math.random() * 0.5,
      v: 0.6 + Math.random(),
      len: 0.05 + Math.random() * 0.12,
    };
  }

  update(dt: number, intensity: number): void {
    const c = this.canvas;
    if (c.width !== window.innerWidth || c.height !== window.innerHeight) {
      c.width = window.innerWidth;
      c.height = window.innerHeight;
    }
    const g = this.g;
    g.clearRect(0, 0, c.width, c.height);
    if (intensity <= 0.01) return;
    const cx = c.width / 2,
      cy = c.height * 0.55,
      R = Math.hypot(cx, cy);
    g.strokeStyle = `rgba(220,235,255,${0.35 * intensity})`;
    g.lineWidth = 1.5;
    g.beginPath();
    for (const l of this.lines) {
      l.r += l.v * dt * (1 + intensity * 2);
      if (l.r > 1.1) Object.assign(l, this.spawn());
      const r0 = l.r * R,
        r1 = (l.r + l.len * intensity) * R;
      g.moveTo(cx + Math.cos(l.a) * r0, cy + Math.sin(l.a) * r0);
      g.lineTo(cx + Math.cos(l.a) * r1, cy + Math.sin(l.a) * r1);
    }
    g.stroke();
  }
}

export function createEffects(q: Quality) {
  return { skid: new SkidMarks(q.skidMarks), smoke: new Smoke(q.smokeParticles) };
}
