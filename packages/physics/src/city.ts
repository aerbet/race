import { tileOf, type City } from '@sr/shared';
import type { Sim } from './sim';

/**
 * Стриминг коллайдеров города: держим загруженными блоки в радиусе `radius` блоков
 * вокруг каждой машины. Вызывать раз в несколько шагов.
 */
export class CityColliders {
  private byKey = new Map<string, City['tiles'][number]>();

  constructor(
    readonly city: City,
    readonly sim: Sim,
    readonly radius = 1,
  ) {
    for (const t of city.tiles) this.byKey.set(`${t.i}_${t.j}`, t);
  }

  update(points: { x: number; z: number }[]): void {
    const want = new Set<string>();
    for (const p of points) {
      const [ti, tj] = tileOf(p.x, p.z, this.city.blockSize);
      for (let di = -this.radius; di <= this.radius; di++)
        for (let dj = -this.radius; dj <= this.radius; dj++) want.add(`${ti + di}_${tj + dj}`);
    }
    for (const k of this.sim.tileKeys) if (!want.has(k)) this.sim.removeTile(k);
    for (const k of want) {
      const t = this.byKey.get(k);
      if (t) this.sim.addTile(k, t.colliders);
    }
  }
}
