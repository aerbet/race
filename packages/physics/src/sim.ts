import type { BuiltTrack, CarConfig, InputFrame } from '@sr/shared';
import { FIXED_DT, quantizeInput, trackCoords, sampleAt } from '@sr/shared';
import type { Rapier } from './rapier';
import { createLevel, type PhysicsLevel } from './world';
import { Vehicle, type VehicleOptions } from './vehicle';
import type { Collider, RigidBody } from '@dimforge/rapier3d-compat';
import { GROUP_CAR, GROUP_STATIC, groups } from './world';
import { WALL_THICKNESS } from './level';

/** Наибольшая скорость вверх при касании стены, м/с. */
const WALL_MAX_RISE = 1.5;

/** Чужая машина, положение которой задаётся извне (сеть): кинематическое тело. */
export interface ProxyCar {
  body: RigidBody;
  position: { x: number; y: number; z: number };
}

/** Мир физики: уровень + машины. Один шаг = 1/60 с. */
export class Sim {
  readonly level: PhysicsLevel;
  readonly cars: Vehicle[] = [];
  step = 0;
  /** Индекс ближайшего сэмпла трассы для каждой машины (подсказка для поиска). */
  private hints: number[] = [];
  /** Последняя «безопасная» дистанция на трассе для каждой машины — для автосброса. */
  readonly lastSafeS: number[] = [];
  readonly proxies: ProxyCar[] = [];

  constructor(
    readonly R: Rapier,
    readonly track: BuiltTrack,
  ) {
    this.level = createLevel(R, track);
  }

  addCar(cfg: CarConfig, slot = 0, opts: VehicleOptions = {}): Vehicle {
    const g = this.track.grid[slot % this.track.grid.length]!;
    const v = new Vehicle(
      this.R,
      this.level.world,
      cfg,
      { x: g.x, y: g.y + 1.0, z: g.z },
      g.yaw,
      opts,
    );
    this.cars.push(v);
    this.hints.push(-1);
    this.lastSafeS.push(trackCoords(this.track, g.x, g.z).s);
    return v;
  }

  private tiles = new Map<string, Collider[]>();

  /**
   * Коллайдеры зданий блока города: [cx, cz, hx, hz, yaw, height].
   * Стриминг: блок добавляется, когда рядом есть машина, и убирается, когда все уехали.
   */
  addTile(key: string, boxes: readonly (readonly number[])[]): void {
    if (this.tiles.has(key)) return;
    const R = this.R;
    const world = this.level.world;
    const body = world.createRigidBody(R.RigidBodyDesc.fixed());
    const list: Collider[] = [];
    for (const b of boxes) {
      const [cx, cz, hx, hz, yaw, h, y0] = b as [
        number,
        number,
        number,
        number,
        number,
        number,
        number?,
      ];
      // y0 — высота низа: приподнятая плита (настил моста) — это дорога, а не стена
      const floor = y0 !== undefined;
      const c = world.createCollider(
        R.ColliderDesc.cuboid(hx, h / 2, hz)
          .setTranslation(cx, (y0 ?? 0) + h / 2, cz)
          .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
          .setFriction(floor ? 1 : 0)
          .setCollisionGroups(groups(GROUP_STATIC, 0xffff)),
        body,
      );
      if (!floor) this.level.wallHandles.add(c.handle);
      list.push(c);
    }
    this.tiles.set(key, list);
  }

  removeTile(key: string): void {
    const list = this.tiles.get(key);
    if (!list) return;
    const body = list[0]?.parent();
    for (const c of list) this.level.wallHandles.delete(c.handle);
    if (body) this.level.world.removeRigidBody(body);
    this.tiles.delete(key);
  }

  get tileKeys(): string[] {
    return [...this.tiles.keys()];
  }

  /** Добавить кинематическую «тень» машины (удалённый игрок). */
  addProxy(cfg: CarConfig, x: number, z: number): ProxyCar {
    const R = this.R;
    const body = this.level.world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, 1, z),
    );
    const b = cfg.body;
    this.level.world.createCollider(
      R.ColliderDesc.cuboid(b.width / 2, (b.height / 2) * 0.6, b.length / 2)
        .setTranslation(0, b.height * 0.12, 0)
        .setFriction(0.05)
        .setCollisionGroups(groups(GROUP_CAR, GROUP_STATIC | GROUP_CAR)),
      body,
    );
    const proxy: ProxyCar = { body, position: { x, y: 1, z } };
    this.proxies.push(proxy);
    return proxy;
  }

  /** Положение тени на следующий шаг. */
  moveProxy(
    p: ProxyCar,
    pos: { x: number; y: number; z: number },
    rot: { x: number; y: number; z: number; w: number },
  ): void {
    p.body.setNextKinematicTranslation(pos);
    p.body.setNextKinematicRotation(rot);
    p.position = { ...pos };
  }

  removeProxy(p: ProxyCar): void {
    const i = this.proxies.indexOf(p);
    if (i < 0) return;
    this.level.world.removeRigidBody(p.body);
    this.proxies.splice(i, 1);
  }

  removeCar(v: Vehicle): void {
    const i = this.cars.indexOf(v);
    if (i < 0) return;
    v.dispose();
    this.cars.splice(i, 1);
    this.hints.splice(i, 1);
    this.lastSafeS.splice(i, 1);
  }

  /** inputs[i] — ввод для cars[i]. */
  tick(inputs: readonly InputFrame[]): void {
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i]!;
      const inp = inputs[i];
      // Квантование — физика видит ровно то, что попадёт в запись ввода
      if (inp) car.update(quantizeInput(inp), FIXED_DT);
    }
    this.level.world.step();
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i]!;
      // Контакты: стена / другая машина
      car.wallContact = false;
      car.carContact = false;
      this.level.world.contactPairsWith(car.collider, (other) => {
        let touching = false;
        this.level.world.contactPair(car.collider, other, (m) => {
          if (m.numContacts() > 0) touching = true;
        });
        if (!touching) return;
        if (this.level.wallHandles.has(other.handle)) car.wallContact = true;
        else if (other.parent()?.isDynamic()) car.carContact = true;
      });
      // Удар о стену не подбрасывает машину (иначе на серпантине её перекидывает через отбойник)
      if (car.wallContact) {
        const v = car.body.linvel();
        if (v.y > WALL_MAX_RISE) car.body.setLinvel({ x: v.x, y: WALL_MAX_RISE, z: v.z }, true);
      }
      const p = car.position;
      const c = trackCoords(this.track, p.x, p.z, this.hints[i]);
      this.hints[i] = c.i;
      const sm = this.track.samples[c.i]!;
      if (Math.abs(c.lateral) < sm.width / 2 && car.grounded >= 3 && car.up().y > 0.9)
        this.lastSafeS[i] = c.s;
      // Серпантин: за отбойником или ниже полотна — сразу на трассу, без долгого падения
      const fellOff =
        this.track.elevated &&
        (p.y < sm.y - 3 ||
          Math.abs(c.lateral) > sm.width / 2 + this.track.def.wallOffset + WALL_THICKNESS + 2);
      if (car.needsReset || fellOff || p.y < this.track.minY - 20) this.resetCar(i);
    }
    this.step++;
  }

  /** Сброс на трассу в последнюю безопасную точку. */
  resetCar(i: number, s = this.lastSafeS[i]!): void {
    const sm = sampleAt(this.track, s);
    this.cars[i]!.teleport({ x: sm.x, y: sm.y + 1.0, z: sm.z }, Math.atan2(-sm.tx, -sm.tz));
  }

  dispose(): void {
    this.level.world.free();
  }
}
