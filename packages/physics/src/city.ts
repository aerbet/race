import { deckColliders, tileOf, type City } from '@sr/shared';
import type { Sim } from './sim';

/**
 * Стриминг коллайдеров города: держим загруженными блоки в радиусе `radius` блоков
 * вокруг каждой машины. Вызывать раз в несколько шагов.
 */
export class CityColliders {
  private byKey = new Map<string, City['tiles'][number]>();
  /** Настилы мостов-ориентиров по блокам (в city.json их нет — только опоры). */
  private decks = new Map<string, number[][]>();

  constructor(
    readonly city: City,
    readonly sim: Sim,
    readonly radius = 1,
  ) {
    for (const t of city.tiles) this.byKey.set(`${t.i}_${t.j}`, t);
    for (const d of deckColliders(city.landmarks)) {
      const [ti, tj] = tileOf(d[0], d[1], city.blockSize);
      const k = `${ti}_${tj}`;
      this.decks.set(k, [...(this.decks.get(k) ?? []), d]);
    }
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
      const deck = this.decks.get(k);
      if (t || deck) this.sim.addTile(k, [...(t?.colliders ?? []), ...(deck ?? [])]);
    }
  }
}
