import * as THREE from 'three';

export type CameraView = 'close' | 'far' | 'hood';
export const CAMERA_VIEWS: CameraView[] = ['close', 'far', 'hood'];

const PRESETS: Record<
  CameraView,
  { dist: number; height: number; look: number; stiffness: number }
> = {
  close: { dist: 5.6, height: 1.9, look: 1.1, stiffness: 9 },
  far: { dist: 8.5, height: 2.9, look: 1.2, stiffness: 7 },
  hood: { dist: -0.4, height: 1.05, look: 1.0, stiffness: 40 },
};

/** Камера на пружине: отстаёт в поворотах, FOV 65→85 со скоростью, лёгкая тряска. */
export class CameraRig {
  view: CameraView = 'close';
  private pos = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private heading = new THREE.Vector3(0, 0, -1);
  private initialized = false;
  private shakeT = 0;
  fovBase = 65;
  fovMax = 85;
  /** Доп. FOV от нитро. */
  private fovBoost = 0;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  cycle(): void {
    this.view = CAMERA_VIEWS[(CAMERA_VIEWS.indexOf(this.view) + 1) % CAMERA_VIEWS.length]!;
  }

  snap(): void {
    this.initialized = false;
  }

  /**
   * target — позиция машины, forward — направление носа, velocity — скорость (м/с).
   */
  update(
    dt: number,
    target: THREE.Vector3,
    forward: THREE.Vector3,
    velocity: THREE.Vector3,
    nitro: boolean,
    carUp: THREE.Vector3,
  ): void {
    const p = PRESETS[this.view];
    const speed = velocity.length();
    const flatFwd = new THREE.Vector3(forward.x, 0, forward.z).normalize();
    // Направление камеры — смесь носа и вектора скорости (в дрифте видно занос)
    const velDir = speed > 4 ? new THREE.Vector3(velocity.x, 0, velocity.z).normalize() : flatFwd;
    const want = this.view === 'hood' ? flatFwd : flatFwd.clone().lerp(velDir, 0.35).normalize();
    // Отставание по направлению (в поворотах)
    const k = 1 - Math.exp(-dt * (this.view === 'hood' ? 30 : 4.5));
    this.heading.lerp(want, k).normalize();

    if (this.view === 'hood') {
      const eye = target.clone().addScaledVector(carUp, p.height).addScaledVector(forward, 0.4);
      this.camera.position.copy(eye);
      this.camera.up.copy(carUp);
      this.camera.lookAt(eye.clone().addScaledVector(forward, 10));
      this.camera.up.set(0, 1, 0);
    } else {
      const dist = p.dist + Math.min(speed, 70) * 0.02;
      const desired = target.clone().addScaledVector(this.heading, -dist);
      desired.y = target.y + p.height;
      if (!this.initialized) {
        this.pos.copy(desired);
        this.vel.set(0, 0, 0);
        this.heading.copy(flatFwd);
        this.initialized = true;
      }
      // Пружина с критическим демпфированием
      // Пружина с критическим демпфированием, подшаги 1/240 с — устойчиво при любом FPS
      const w = p.stiffness;
      const n = Math.max(1, Math.ceil(dt * 240));
      const h = dt / n;
      const acc = new THREE.Vector3();
      for (let i = 0; i < n; i++) {
        acc
          .copy(desired)
          .sub(this.pos)
          .multiplyScalar(w * w)
          .addScaledVector(this.vel, -2 * w);
        this.vel.addScaledVector(acc, h);
        this.pos.addScaledVector(this.vel, h);
      }
      // Не даём камере сильно отстать на высокой скорости
      const off = this.pos.clone().sub(desired);
      if (off.length() > 4) this.pos.copy(desired).addScaledVector(off.normalize(), 4);
      const flat = new THREE.Vector3(this.pos.x - target.x, 0, this.pos.z - target.z);
      if (flat.length() < dist * 0.7) {
        flat.setLength(dist * 0.7);
        this.pos.x = target.x + flat.x;
        this.pos.z = target.z + flat.z;
      }
      if (this.pos.y < target.y + 0.6) this.pos.y = target.y + 0.6;

      this.shakeT += dt;
      const shake = Math.max(0, speed - 30) * 0.0009 + (nitro ? 0.02 : 0);
      const sx = Math.sin(this.shakeT * 37.1) * shake;
      const sy = Math.sin(this.shakeT * 41.7 + 1.3) * shake;
      this.camera.position.set(this.pos.x + sx, this.pos.y + sy, this.pos.z);
      const look = target.clone().addScaledVector(this.heading, 3);
      look.y = target.y + p.look;
      this.camera.lookAt(look);
    }

    this.fovBoost += ((nitro ? 8 : 0) - this.fovBoost) * Math.min(1, dt * 4);
    const fov =
      this.fovBase + (this.fovMax - this.fovBase) * Math.min(1, speed / 70) + this.fovBoost;
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
