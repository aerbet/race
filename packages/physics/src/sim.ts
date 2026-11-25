import type { BuiltTrack, CarConfig, InputFrame } from '@sr/shared';
import { FIXED_DT, quantizeInput, trackCoords, sampleAt } from '@sr/shared';
import type { Rapier } from './rapier';
import { createLevel, type PhysicsLevel } from './world';
import { Vehicle, type VehicleOptions } from './vehicle';

/** Мир физики: уровень + машины. Один шаг = 1/60 с. */
export class Sim {
  readonly level: PhysicsLevel;
  readonly cars: Vehicle[] = [];
  step = 0;
  /** Индекс ближайшего сэмпла трассы для каждой машины (подсказка для поиска). */
  private hints: number[] = [];
  /** Последняя «безопасная» дистанция на трассе для каждой машины — для автосброса. */
  readonly lastSafeS: number[] = [];

  constructor(
    readonly R: Rapier,
    readonly track: BuiltTrack,
  ) {
    this.level = createLevel(R, track);
  }

  addCar(cfg: CarConfig, slot = 0, opts: VehicleOptions = {}): Vehicle {
    const g = this.track.grid[slot % this.track.grid.length]!;
    const v = new Vehicle(this.R, this.level.world, cfg, { x: g.x, y: 1.0, z: g.z }, g.yaw, opts);
    this.cars.push(v);
    this.hints.push(-1);
    this.lastSafeS.push(trackCoords(this.track, g.x, g.z).s);
    return v;
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
      const p = car.position;
      const c = trackCoords(this.track, p.x, p.z, this.hints[i]);
      this.hints[i] = c.i;
      const sm = this.track.samples[c.i]!;
      if (Math.abs(c.lateral) < sm.width / 2 && car.grounded >= 3 && car.up().y > 0.9)
        this.lastSafeS[i] = c.s;
      if (car.needsReset || p.y < -20) this.resetCar(i);
    }
    this.step++;
  }

  /** Сброс на трассу в последнюю безопасную точку. */
  resetCar(i: number, s = this.lastSafeS[i]!): void {
    const sm = sampleAt(this.track, s);
    this.cars[i]!.teleport({ x: sm.x, y: 1.0, z: sm.z }, Math.atan2(-sm.tx, -sm.tz));
  }

  dispose(): void {
    this.level.world.free();
  }
}
