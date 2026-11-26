import type { CarConfig, InputFrame } from '@sr/shared';
import { sampleCurve } from '@sr/shared';
import type { Collider, RigidBody, World } from '@dimforge/rapier3d-compat';
import type { Rapier } from './rapier';
import { GROUP_CAR, GROUP_STATIC, groups } from './world';

type V3 = { x: number; y: number; z: number };
type Q = { x: number; y: number; z: number; w: number };

const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: V3, b: V3): V3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const len = (a: V3) => Math.sqrt(dot(a, a));
const norm = (a: V3): V3 => {
  const l = len(a);
  return l > 1e-9 ? scale(a, 1 / l) : v3(0, 1, 0);
};
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const approach = (x: number, target: number, maxDelta: number) =>
  x < target ? Math.min(target, x + maxDelta) : Math.max(target, x - maxDelta);

function rotate(q: Q, v: V3): V3 {
  // v' = q v q*
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}

export const yawQuat = (yaw: number): Q => ({
  x: 0,
  y: Math.sin(yaw / 2),
  z: 0,
  w: Math.cos(yaw / 2),
});

export interface WheelState {
  /** Локальная точка крепления. */
  mount: V3;
  front: boolean;
  left: boolean;
  contact: boolean;
  compression: number;
  prevCompression: number;
  /** Текущая длина подвески (для рендера). */
  suspensionLength: number;
  load: number;
  /** Проскальзывание 0..1+ (для дыма, следов, звука). */
  slip: number;
  spin: number;
  spinSpeed: number;
  contactPoint: V3;
}

export interface VehicleTelemetry {
  speedKmh: number;
  forwardSpeed: number;
  rpm: number;
  gear: number;
  slipAngleDeg: number;
  drifting: boolean;
  driftFactor: number;
  grounded: number;
  nitro: number;
  nitroActive: boolean;
  throttle: number;
  steerAngle: number;
}

export interface VehicleOptions {
  manualGearbox?: boolean;
  /** Дрифт-гонка: срыв в занос и от сброса газа / скольжения на газу (не только ручником). */
  driftMode?: boolean;
}

const DRIVE_EFFICIENCY = 0.85;
const REVERSE_MAX_KMH = 40;

export class Vehicle {
  readonly body: RigidBody;
  readonly collider: Collider;
  readonly wheels: WheelState[];
  cfg: CarConfig;

  steerAngle = 0;
  gear = 1;
  rpm = 0;
  manual = false;
  private shiftTimer = 0;
  driftFactor = 0;
  private driftLatch = 0;
  private throttleHist = 0;
  private liftTimer = 0;
  private prevAbsBeta = 0;
  private lowAngleTime = 0;
  private exitIntent = 0;
  nitro = 0.35;
  nitroActive = false;
  airTime = 0;
  /** Время в «застрявшем» состоянии; при ≥ autoReset.seconds — needsReset. */
  stuckTime = 0;
  needsReset = false;
  /** Касание стены / другой машины на последнем шаге (заполняет Sim). */
  wallContact = false;
  /** Сцепление покрытия (погода): 1 — сухо, ~0,85 — мокро, ~0,7 — снег/слякоть. */
  surfaceGrip = 1;
  carContact = false;
  /** Счётчик впрыска нитро за текущий прыжок (заряд начисляется при приземлении). */
  private pendingAirCharge = 0;
  slipAngle = 0;
  grounded = 0;
  lastInput: InputFrame | null = null;
  private yawInertia = 1;
  /** Дрифт-гонка: автосрыв от сброса газа и скольжения на газу. */
  driftMode = false;
  private inertia: V3 = v3();

  constructor(
    private readonly R: Rapier,
    private readonly world: World,
    cfg: CarConfig,
    pos: V3,
    yaw: number,
    opts: VehicleOptions = {},
  ) {
    this.cfg = cfg;
    this.manual = !!opts.manualGearbox;
    this.driftMode = !!opts.driftMode;
    const b = cfg.body;
    const m = cfg.mass;
    const s = cfg.inertiaScale;
    this.inertia = v3(
      (m / 12) * (b.height ** 2 + b.length ** 2) * s,
      (m / 12) * (b.width ** 2 + b.length ** 2) * s,
      (m / 12) * (b.width ** 2 + b.height ** 2) * s,
    );
    this.yawInertia = this.inertia.y;
    const desc = R.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setRotation(yawQuat(yaw))
      .setAdditionalMassProperties(
        m,
        { x: 0, y: cfg.centerOfMass.y, z: cfg.centerOfMass.z },
        this.inertia,
        { x: 0, y: 0, z: 0, w: 1 },
      )
      .setCcdEnabled(true)
      .setAngularDamping(0.3)
      .setCanSleep(false);
    this.body = world.createRigidBody(desc);
    const soft = cfg.assists.softWalls;
    const cd = R.ColliderDesc.cuboid(b.width / 2, (b.height / 2) * 0.6, b.length / 2)
      .setTranslation(0, b.height * 0.12, 0)
      .setDensity(0)
      .setFriction(soft.enabled ? soft.friction : 0.8)
      .setFrictionCombineRule(R.CoefficientCombineRule.Min)
      .setRestitution(soft.enabled ? soft.restitution : 0.3)
      .setRestitutionCombineRule(R.CoefficientCombineRule.Max)
      .setCollisionGroups(groups(GROUP_CAR, GROUP_STATIC | GROUP_CAR));
    this.collider = world.createCollider(cd, this.body);

    const w = cfg.wheels;
    this.wheels = [];
    for (const front of [true, false]) {
      for (const left of [true, false]) {
        this.wheels.push({
          mount: v3(
            (left ? -1 : 1) * (w.track / 2),
            w.mountY,
            (front ? -1 : 1) * (w.wheelbase / 2),
          ),
          front,
          left,
          contact: false,
          compression: 0,
          prevCompression: 0,
          suspensionLength: cfg.suspension.restLength,
          load: 0,
          slip: 0,
          spin: 0,
          spinSpeed: 0,
          contactPoint: v3(),
        });
      }
    }
    this.rpm = cfg.engine.idleRpm;
  }

  /** Замена конфига «на лету» (панель отладки). Масса и инерция обновляются. */
  setConfig(cfg: CarConfig): void {
    this.cfg = cfg;
    const b = cfg.body;
    const m = cfg.mass;
    const s = cfg.inertiaScale;
    this.inertia = v3(
      (m / 12) * (b.height ** 2 + b.length ** 2) * s,
      (m / 12) * (b.width ** 2 + b.length ** 2) * s,
      (m / 12) * (b.width ** 2 + b.height ** 2) * s,
    );
    this.yawInertia = this.inertia.y;
    this.body.setAdditionalMassProperties(
      m,
      { x: 0, y: cfg.centerOfMass.y, z: cfg.centerOfMass.z },
      this.inertia,
      { x: 0, y: 0, z: 0, w: 1 },
      true,
    );
    const soft = cfg.assists.softWalls;
    this.collider.setFriction(soft.enabled ? soft.friction : 0.8);
    this.collider.setRestitution(soft.enabled ? soft.restitution : 0.3);
    const w = cfg.wheels;
    for (const wh of this.wheels) {
      wh.mount = v3(
        (wh.left ? -1 : 1) * (w.track / 2),
        w.mountY,
        (wh.front ? -1 : 1) * (w.wheelbase / 2),
      );
    }
  }

  teleport(pos: V3, yaw: number): void {
    this.body.setTranslation(pos, true);
    this.body.setRotation(yawQuat(yaw), true);
    this.body.setLinvel(v3(), true);
    this.body.setAngvel(v3(), true);
    this.driftFactor = 0;
    this.driftLatch = 0;
    this.stuckTime = 0;
    this.needsReset = false;
    this.gear = 1;
    this.steerAngle = 0;
    for (const w of this.wheels) {
      w.compression = w.prevCompression = 0;
      w.spinSpeed = 0;
    }
  }

  addNitro(amount: number): void {
    this.nitro = clamp(this.nitro + amount, 0, 1);
  }

  get position(): V3 {
    return this.body.translation();
  }
  get rotation(): Q {
    return this.body.rotation();
  }
  get speed(): number {
    return len(this.body.linvel());
  }
  get yaw(): number {
    const f = rotate(this.body.rotation(), v3(0, 0, -1));
    return Math.atan2(-f.x, -f.z);
  }

  telemetry(): VehicleTelemetry {
    const v = this.body.linvel();
    const fwd = rotate(this.body.rotation(), v3(0, 0, -1));
    return {
      speedKmh: len(v) * 3.6,
      forwardSpeed: dot(v, fwd),
      rpm: this.rpm,
      gear: this.gear,
      slipAngleDeg: (this.slipAngle * 180) / Math.PI,
      drifting: this.driftFactor > 0.3 && Math.abs(this.slipAngle) > (10 * Math.PI) / 180,
      driftFactor: this.driftFactor,
      grounded: this.grounded,
      nitro: this.nitro,
      nitroActive: this.nitroActive,
      throttle: this.lastInput?.throttle ?? 0,
      steerAngle: this.steerAngle,
    };
  }

  /** Один шаг физики. Вызывать ДО world.step(). */
  update(inp: InputFrame, dt: number): void {
    const cfg = this.cfg;
    const A = cfg.assists;
    this.lastInput = inp;
    const body = this.body;
    body.resetForces(true);
    body.resetTorques(true);

    const q = body.rotation();
    const t = body.translation();
    const v = body.linvel();
    const w = body.angvel();
    const right = rotate(q, v3(1, 0, 0));
    const up = rotate(q, v3(0, 1, 0));
    const fwd = rotate(q, v3(0, 0, -1));
    const com = add(t, rotate(q, v3(0, cfg.centerOfMass.y, cfg.centerOfMass.z)));
    const speed = len(v);
    const fwdSpeed = dot(v, fwd);
    const latSpeed = dot(v, right);
    const kmh = speed * 3.6;
    const m = cfg.mass;

    // --- Угол заноса
    this.slipAngle = speed > 3 ? Math.atan2(latSpeed, Math.abs(fwdSpeed)) : 0;
    const beta = this.slipAngle;
    const absBeta = Math.abs(beta);

    // --- Руль (по скорости)
    let maxSteer = (cfg.steering.maxAngleDeg * Math.PI) / 180;
    if (A.speedSteer.enabled) {
      const minA = (A.speedSteer.minAngleDeg * Math.PI) / 180;
      const tt = clamp(kmh / A.speedSteer.speedRefKmh, 0, 1);
      maxSteer = lerp(maxSteer, minA, Math.sqrt(tt));
    }
    // Руль по сцеплению: угол колёс не больше того, что держат шины (иначе машину срывает)
    const latPeak = Math.max(...cfg.tires.lateral.map((pt) => pt[1]));
    const aLatMax =
      latPeak * Math.min(cfg.tires.frontGrip, cfg.tires.rearGrip) * this.surfaceGrip * 9.81;
    if (A.gripSteer.enabled && speed > 3) {
      const kin = Math.atan((cfg.wheels.wheelbase * aLatMax * A.gripSteer.latG) / (speed * speed));
      maxSteer = Math.min(maxSteer, kin + (A.gripSteer.extraDeg * Math.PI) / 180);
    }
    // В дрифте даём больше угла для контрруления
    maxSteer = lerp(
      maxSteer,
      Math.max(maxSteer, ((cfg.steering.maxAngleDeg * Math.PI) / 180) * 0.8),
      this.driftFactor,
    );
    this.steerAngle = approach(this.steerAngle, inp.steer * maxSteer, 5 * dt);

    // --- Коробка передач
    const nG = cfg.gearbox.ratios.length;
    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    let driveInput = inp.throttle;
    let brakeInput = inp.brake;
    if (this.manual) {
      if (inp.shift > 0 && this.gear < nG) this.shiftTo(this.gear === -1 ? 1 : this.gear + 1);
      if (inp.shift < 0 && this.gear > -1) this.shiftTo(this.gear === 1 ? -1 : this.gear - 1);
      if (this.gear === -1) {
        driveInput = inp.throttle;
      }
    } else {
      if (this.gear > 0 && inp.brake > 0.1 && inp.throttle < 0.1 && fwdSpeed < 0.6) this.gear = -1;
      else if (this.gear === -1 && inp.throttle > 0.1 && fwdSpeed > -0.6) this.gear = 1;
      if (this.gear === -1) {
        driveInput = inp.brake;
        brakeInput = inp.throttle;
      }
    }

    // Ручник: без руля — почти полный тормоз по прямой, с рулём — немного (занос)
    if (A.handbrake.enabled && inp.handbrake > 0.5) {
      const blend = Math.abs(inp.steer) < 0.2 ? A.handbrake.straightBrake : A.handbrake.turnBrake;
      brakeInput = Math.max(brakeInput, blend);
    }

    // --- Обороты
    const R = cfg.wheels.radius;
    const ratio = this.gear === -1 ? cfg.gearbox.reverse : (cfg.gearbox.ratios[this.gear - 1] ?? 1);
    const totalRatio = ratio * cfg.gearbox.final;
    const drivenOnFront = cfg.drive !== 'rwd';
    const drivenOnRear = cfg.drive !== 'fwd';
    let wheelOmega = 0;
    let nd = 0;
    for (const wh of this.wheels) {
      if ((wh.front && drivenOnFront) || (!wh.front && drivenOnRear)) {
        wheelOmega += Math.abs(wh.spinSpeed);
        nd++;
      }
    }
    wheelOmega /= Math.max(1, nd);
    // Ручник/занос не должны «ронять» обороты: берём не меньше скорости кузова
    wheelOmega = Math.max(wheelOmega, Math.abs(fwdSpeed) / R);
    const idle = cfg.engine.idleRpm;
    const red = cfg.engine.redlineRpm;
    let targetRpm = (wheelOmega * totalRatio * 60) / (2 * Math.PI);
    // Сцепление: на малой скорости держит обороты
    const clutchRpm = idle + driveInput * (red * 0.45 - idle);
    if (this.gear === 1 || this.gear === -1)
      targetRpm = Math.max(targetRpm, clutchRpm * clamp(1 - fwdSpeed / 12, 0, 1));
    if (this.grounded === 0) targetRpm = lerp(this.rpm, idle + driveInput * (red - idle), 0.08);
    if (this.shiftTimer > 0) targetRpm = lerp(this.rpm, targetRpm, 0.25);
    this.rpm = clamp(lerp(this.rpm, Math.max(idle, targetRpm), 0.5), idle * 0.9, red * 1.02);

    if (!this.manual && this.gear > 0 && this.shiftTimer <= 0 && this.grounded > 0) {
      if (this.rpm > cfg.gearbox.autoUpRpm && this.gear < nG && driveInput > 0.1)
        this.shiftTo(this.gear + 1);
      else if (
        this.rpm < cfg.gearbox.autoDownRpm &&
        this.gear > 1 &&
        this.driftFactor < 0.2 &&
        inp.handbrake < 0.5
      )
        this.shiftTo(this.gear - 1);
    }

    // --- Момент двигателя
    let engineTorque = 0;
    const limiter = this.rpm >= red;
    if (this.shiftTimer <= 0 && !limiter)
      engineTorque = sampleCurve(cfg.engine.torqueCurve, this.rpm) * driveInput;
    let driveForce = (engineTorque * totalRatio * DRIVE_EFFICIENCY) / R;
    if (this.gear === -1) {
      driveForce = -driveForce;
      if (-fwdSpeed * 3.6 > REVERSE_MAX_KMH) driveForce = 0;
    }
    const engineBrakeForce =
      driveInput < 0.05 && this.gear > 0
        ? ((cfg.engine.engineBrake * totalRatio) / R) * (this.rpm / red)
        : 0;

    // --- Нитро
    this.nitroActive = inp.nitro > 0.5 && this.nitro > 0 && this.gear > 0 && inp.throttle > 0.3;
    if (this.nitroActive) {
      this.nitro = Math.max(0, this.nitro - dt / cfg.nitro.capacity);
      // Тяга нитро не режется лимитером/переключением
      const base = Math.max(
        driveForce,
        (sampleCurve(cfg.engine.torqueCurve, this.rpm) * totalRatio * DRIVE_EFFICIENCY) / R,
      );
      driveForce = base * (1 + cfg.nitro.boost);
    }

    // --- Дрифт: срыв / удержание / выход
    const steerAbs = Math.abs(inp.steer);
    if (this.throttleHist > 0.6 && inp.throttle < 0.2) this.liftTimer = 0.35;
    this.liftTimer = Math.max(0, this.liftTimer - dt);
    this.throttleHist = lerp(this.throttleHist, inp.throttle, 0.3);
    let driftTarget = 0;
    if (
      A.driftInit.enabled &&
      kmh > A.driftInit.minSpeedKmh &&
      this.grounded >= 2 &&
      fwdSpeed > 0
    ) {
      const hb = inp.handbrake > 0.5 && steerAbs > 0.2;
      // Автосрывы (сброс газа, скольжение на газу) — только в дрифт-гонке или по конфигу
      const auto = this.driftMode || A.driftInit.autoTriggers;
      const lift = auto && this.liftTimer > 0 && steerAbs > 0.6;
      const brakeThrottle = inp.brake > 0.3 && inp.throttle > 0.5 && steerAbs > 0.3;
      // Срыв «мощностью»: машина уже идёт боком и газ нажат
      const powerOver =
        auto && absBeta > (12 * Math.PI) / 180 && inp.throttle > 0.4 && steerAbs > 0.2;
      if (hb || lift || brakeThrottle || powerOver) this.driftLatch = 1;
      // Выход: угол мал какое-то время, или газ брошен надолго
      this.lowAngleTime = absBeta < (7 * Math.PI) / 180 ? this.lowAngleTime + dt : 0;
      if (!hb && this.driftFactor > 0.2 && this.lowAngleTime > 0.25) this.driftLatch = 0;
      // Руль прямо или в обратную сторону — игрок выходит из дрифта
      const driftDir = absBeta > 0.05 ? -Math.sign(beta) : 0;
      const steerAlong = inp.steer * driftDir;
      this.exitIntent = driftDir !== 0 && steerAlong < 0.15 && !hb ? this.exitIntent + dt : 0;
      if (this.exitIntent > 0.15) this.driftLatch = 0;
      if (inp.throttle < 0.1 && !hb && inp.brake < 0.1 && this.liftTimer === 0)
        this.driftLatch = Math.max(0, this.driftLatch - dt * 1.5);
      driftTarget = this.driftLatch > 0.5 ? 1 : 0;
    } else {
      this.driftLatch = 0;
    }
    const recover = A.driftExit.enabled ? A.driftExit.recoverRate : 50;
    this.driftFactor = approach(
      this.driftFactor,
      driftTarget,
      (driftTarget > this.driftFactor ? A.driftInit.attackRate : recover) * dt,
    );
    const rearGripScale = A.driftInit.enabled
      ? lerp(1, A.driftInit.rearGripScale, this.driftFactor)
      : 1;

    // --- Колёса
    const sus = cfg.suspension;
    const rayLen = sus.restLength + R;
    let grounded = 0;
    const wheelForces: { p: V3; f: V3 }[] = [];
    const loads: number[] = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const wh = this.wheels[i]!;
      const origin = add(t, rotate(q, wh.mount));
      const ray = new this.R.Ray(origin, scale(up, -1));
      const hit = this.world.castRayAndGetNormal(
        ray,
        rayLen,
        true,
        undefined,
        groups(0xffff, GROUP_STATIC),
        undefined,
        body,
      );
      wh.prevCompression = wh.compression;
      if (hit && hit.timeOfImpact <= rayLen) {
        const susLen = Math.max(0, hit.timeOfImpact - R);
        wh.contact = true;
        wh.compression = clamp(sus.restLength - susLen, 0, sus.restLength);
        wh.suspensionLength = Math.max(sus.restLength - sus.travel, susLen);
        wh.contactPoint = add(origin, scale(up, -hit.timeOfImpact));
        (wh as WheelState & { normal?: V3 }).normal = hit.normal;
        grounded++;
      } else {
        wh.contact = false;
        wh.compression = 0;
        wh.suspensionLength = sus.restLength;
      }
    }
    this.grounded = grounded;

    for (let i = 0; i < 4; i++) {
      const wh = this.wheels[i]!;
      if (!wh.contact) continue;
      const compVel = (wh.compression - wh.prevCompression) / dt;
      let f = sus.stiffness * wh.compression + sus.damping * compVel;
      // Упор отбойника
      const over = wh.compression - sus.travel;
      if (over > 0) f += sus.stiffness * 6 * over;
      // Стабилизатор
      const other = this.wheels[i ^ 1]!;
      if (other.contact) f += sus.antiRoll * (wh.compression - other.compression);
      loads[i] = Math.max(0, f);
    }

    const downforce = cfg.aero.downforce * speed * speed;
    let latForceSum = 0;
    for (let i = 0; i < 4; i++) {
      const wh = this.wheels[i]!;
      wh.load = loads[i]!;
      if (!wh.contact) {
        wh.slip = 0;
        wh.spinSpeed *= 0.98;
        if (((wh.front && drivenOnFront) || (!wh.front && drivenOnRear)) && driveInput > 0.1)
          wh.spinSpeed = lerp(wh.spinSpeed, 60 * driveInput, 0.05);
        wh.spin += wh.spinSpeed * dt;
        continue;
      }
      const n = norm((wh as WheelState & { normal?: V3 }).normal ?? up);
      const Fz = loads[i]! + downforce / 4;
      const p = wh.contactPoint;
      const r = sub(p, com);
      const vp = add(v, cross(w, r));
      let wf = fwd;
      if (wh.front) {
        const c = Math.cos(this.steerAngle),
          s = Math.sin(this.steerAngle);
        // поворот вперёд-вектора вокруг up: + угол = вправо
        wf = add(scale(fwd, c), scale(right, s));
      }
      wf = norm(sub(wf, scale(n, dot(wf, n))));
      const wr = cross(wf, n);
      const vLong = dot(vp, wf);
      const vLat = dot(vp, wr);
      const share = m / 4;

      const grip =
        (wh.front ? cfg.tires.frontGrip : cfg.tires.rearGrip * rearGripScale) * this.surfaceGrip;

      // Продольная сила
      let driveShare = 0;
      const isDriven = (wh.front && drivenOnFront) || (!wh.front && drivenOnRear);
      if (isDriven) {
        if (cfg.drive === 'awd')
          driveShare = wh.front ? (1 - cfg.awdRearShare) / 2 : cfg.awdRearShare / 2;
        else driveShare = 0.5;
      }
      let Fx = driveForce * driveShare;
      const brakeShare = wh.front ? cfg.brakes.frontBias / 2 : (1 - cfg.brakes.frontBias) / 2;
      let brakeF = brakeInput * cfg.brakes.maxForce * brakeShare;
      if (!wh.front) brakeF += inp.handbrake * cfg.brakes.handbrakeForce * 0.5;
      if (isDriven) brakeF += engineBrakeForce * driveShare;
      brakeF += cfg.tires.rollingResistance * Fz;
      // Тормоз не может развернуть скорость колеса
      const stopF = (Math.abs(vLong) * share) / dt;
      Fx -= Math.sign(vLong) * Math.min(brakeF, stopF);

      const longPeak = Math.max(...cfg.tires.longitudinal.map((pt) => pt[1]));
      const FxMax = longPeak * Fz * grip;
      let slipRatio = 0;
      if (Math.abs(Fx) > FxMax) {
        const over = Math.abs(Fx) / FxMax;
        slipRatio = clamp(0.12 * over, 0.12, 1);
        Fx = Math.sign(Fx) * sampleCurve(cfg.tires.longitudinal, slipRatio) * Fz * grip;
      } else {
        slipRatio = (Math.abs(Fx) / FxMax) * 0.12;
      }

      // Боковая сила
      const slipDeg = (Math.atan2(Math.abs(vLat), Math.max(Math.abs(vLong), 1.5)) * 180) / Math.PI;
      const muLat = sampleCurve(cfg.tires.lateral, slipDeg) * grip;
      let FyMax = muLat * Fz;
      // Комбинированное сцепление: пробуксовка «съедает» боковое
      const usage = Math.abs(Fx) / Math.max(1, FxMax);
      FyMax *= Math.sqrt(Math.max(0, 1 - 0.55 * usage * usage));
      // Боковая сила не больше той, что гасит боковую скорость за шаг
      const needed = (Math.abs(vLat) * share) / dt;
      const Fy = -Math.sign(vLat) * Math.min(FyMax, needed);
      latForceSum += Math.abs(Fy);

      wh.slip = Math.max(
        slipRatio > 0.13 ? (slipRatio - 0.1) * 2 : 0,
        slipDeg > 8 ? (slipDeg - 8) / 25 : 0,
      );
      const targetSpin =
        vLong / R + (isDriven && slipRatio > 0.13 ? Math.sign(Fx || 1) * slipRatio * 25 : 0);
      wh.spinSpeed = lerp(wh.spinSpeed, targetSpin, 0.5);
      if (!wh.front && inp.handbrake > 0.5) wh.spinSpeed = 0;
      wh.spin += wh.spinSpeed * dt;

      // Точка приложения поднята к центру масс — меньше кренов, стабильнее
      const comH = dot(sub(com, p), up);
      const ap = add(p, scale(up, comH * 0.6));
      wheelForces.push({ p: ap, f: add(scale(wf, Fx), scale(wr, Fy)) });
      // Пружина
      wheelForces.push({ p: add(p, scale(up, 0.0)), f: scale(up, loads[i]!) });
    }
    for (const wf of wheelForces) body.addForceAtPoint(wf.f, wf.p, true);

    // --- Аэродинамика
    if (speed > 0.1) {
      body.addForce(scale(v, -cfg.aero.drag * speed), true);
      if (grounded > 0) body.addForce(scale(up, -downforce), true);
    }

    const yawRate = dot(w, up);
    const torqueYaw = (accel: number) => body.addTorque(scale(up, accel * this.yawInertia), true);

    if (grounded >= 2 && speed > 2) {
      // --- Помощь в повороте (+ steer = вправо = отрицательное вращение вокруг up)
      if (A.turnAssist.enabled && this.driftFactor < 0.5) {
        const k = clamp(speed / 15, 0, 1) * clamp(1.4 - kmh / 250, 0.4, 1);
        torqueYaw(-inp.steer * A.turnAssist.yawAccel * k * Math.sign(fwdSpeed || 1));
      }

      // --- Стабилизация вне дрифта (как ESP): рыскание — к ожидаемому по рулю,
      // скольжение — не больше maxSlipDeg. Плавно уходит, когда включается дрифт.
      if (A.stability.enabled && fwdSpeed > 2) {
        const g = 1 - clamp(this.driftFactor / 0.5, 0, 1);
        if (g > 0) {
          const wb = cfg.wheels.wheelbase;
          const lim = aLatMax / Math.max(speed, 1);
          const target = clamp(-(fwdSpeed * Math.tan(this.steerAngle)) / wb, -lim, lim);
          torqueYaw(-(yawRate - target) * A.stability.yawGain * g);
          const maxSlip = (A.stability.maxSlipDeg * Math.PI) / 180;
          const allowed = Math.abs(fwdSpeed) * Math.tan(maxSlip);
          const excess = Math.abs(latSpeed) - allowed;
          if (excess > 0)
            body.addForce(
              scale(right, -Math.sign(latSpeed) * excess * m * A.stability.slipRate * g),
              true,
            );
        }
      }

      // --- Удержание дрифта
      if (A.driftHold.enabled && this.driftFactor > 0.25 && fwdSpeed > 3) {
        const minA = (A.driftHold.minAngleDeg * Math.PI) / 180;
        const maxA = (A.driftHold.maxAngleDeg * Math.PI) / 180;
        // направление дрифта: +1 вправо (зад уходит влево → latSpeed < 0)
        const dir = absBeta > 0.03 ? -Math.sign(beta) : inp.steer !== 0 ? Math.sign(inp.steer) : 1;
        const along = inp.steer * dir; // +1 — руль в сторону дрифта, −1 — контрруление
        const target = lerp(minA, maxA, clamp(0.5 + along * 0.5, 0, 1));
        const err = target - absBeta;
        const betaRate = (absBeta - this.prevAbsBeta) / dt;
        // Ручником можно чуть перекрутить предел угла, но не развернуться поперёк
        const extra = A.handbrake.enabled ? (A.handbrake.extraAngleDeg * Math.PI) / 180 : Math.PI;
        const explicitError =
          inp.handbrake > 0.5 && along > 0.9 && absBeta > maxA && absBeta < maxA + extra;
        // PD-регулятор угла заноса: kp — из конфига, kd — около критического демпфирования
        let kp = A.driftHold.strength * this.driftFactor;
        if (absBeta > maxA) kp *= 1.8;
        const kd = 1.8 * Math.sqrt(Math.max(kp, 0.01));
        if (!explicitError) {
          // поворот носа «в сторону дрифта» (= рост угла) — это −dir вокруг up
          torqueYaw(-dir * (kp * err - kd * betaRate));
        }
        // Сохранение скорости: возвращаем часть «тормоза боком» (проекция боковых сил на скорость)
        const vdir = norm(v);
        const keep = A.driftHold.speedKeep * this.driftFactor * latForceSum * Math.sin(absBeta);
        body.addForce(scale(vdir, keep), true);
        // Подкрутка вектора скорости к носу без потери модуля — машина «едет по дуге»
        const toward = sub(fwd, scale(vdir, dot(fwd, vdir)));
        if (len(toward) > 1e-3) {
          body.addForce(scale(norm(toward), m * speed * 0.35 * this.driftFactor), true);
        }
      }

      // --- Выход из дрифта / стабилизация рыскания без дрифта
      if (A.driftExit.enabled && this.driftFactor < 0.6) {
        const wb = cfg.wheels.wheelbase;
        const expected = -(fwdSpeed * Math.tan(this.steerAngle)) / wb;
        const excess = yawRate - expected;
        const k = A.driftExit.yawDamp * (1 - this.driftFactor) * clamp(speed / 20, 0, 1);
        torqueYaw(-excess * k);
      }
    }

    this.prevAbsBeta = absBeta;

    // --- Стабилизация в воздухе
    if (grounded === 0) {
      this.airTime += dt;
      this.pendingAirCharge += dt;
      if (A.airStabilize.enabled) {
        const axis = cross(up, v3(0, 1, 0));
        const angVelNoYaw = sub(w, scale(v3(0, 1, 0), w.y));
        const torque = sub(
          scale(axis, A.airStabilize.strength),
          scale(angVelNoYaw, A.airStabilize.damping),
        );
        body.addTorque(
          v3(torque.x * this.inertia.x, torque.y * this.inertia.y, torque.z * this.inertia.z),
          true,
        );
      }
    } else {
      if (this.pendingAirCharge > 0.35)
        this.addNitro(this.pendingAirCharge * cfg.nitro.chargePerAirSecond);
      this.pendingAirCharge = 0;
      this.airTime = 0;
    }

    // --- Заряд нитро от дрифта
    if (absBeta > (15 * Math.PI) / 180 && kmh > 40 && grounded >= 2 && !this.nitroActive) {
      this.addNitro(cfg.nitro.chargePerDriftSecond * dt);
    }

    // --- Автосброс
    if (A.autoReset.enabled) {
      const upsideDown = up.y < 0.3;
      const stuck = speed < 1.5 && (inp.throttle > 0.5 || inp.brake > 0.5);
      const onSide = grounded === 0 && speed < 1 && up.y < 0.8;
      if (upsideDown || stuck || onSide) this.stuckTime += dt;
      else this.stuckTime = Math.max(0, this.stuckTime - dt * 2);
      if (this.stuckTime >= A.autoReset.seconds) this.needsReset = true;
    }
    if (inp.reset > 0.5) this.needsReset = true;
  }

  private shiftTo(g: number): void {
    if (g === this.gear) return;
    this.gear = g;
    this.shiftTimer = this.cfg.gearbox.shiftTime;
  }

  /** Ориентация «вперёд» в мире. */
  forward(): V3 {
    return rotate(this.body.rotation(), v3(0, 0, -1));
  }
  up(): V3 {
    return rotate(this.body.rotation(), v3(0, 1, 0));
  }
  localToWorld(p: V3): V3 {
    return add(this.body.translation(), rotate(this.body.rotation(), p));
  }

  dispose(): void {
    this.world.removeRigidBody(this.body);
  }
}

export { rotate as rotateByQuat };
