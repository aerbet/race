import { describe, expect, it } from 'vitest';
import { defaultDressing, getTrack, placeDressing } from '../index';

describe('оформление трасс (BLENDER_PLAN 7.1)', () => {
  it('элементы стоят за кромкой дороги и смотрят на неё', () => {
    const t = getTrack('polygon');
    const inst = placeDressing(t, defaultDressing(t, false));
    expect(inst.length).toBeGreaterThan(50);
    for (const d of inst) {
      let best = Infinity,
        w = 0;
      for (const s of t.samples) {
        const dd = Math.hypot(s.x - d.x, s.z - d.z);
        if (dd < best) [best, w] = [dd, s.width];
      }
      // не на проезжей части (конусы — у самой кромки)
      expect(best, d.item).toBeGreaterThan(w / 2 - 0.5);
    }
    const items = new Set(inst.map((d) => d.item));
    for (const i of ['grandstand', 'light_mast', 'tire_wall', 'banner_a'])
      expect(items).toContain(i);
  });

  it('outer — снаружи поворота, minCurve отсекает прямые', () => {
    const t = getTrack('polygon');
    const tires = placeDressing(t, [
      { item: 'tire_wall', every: 4, side: 'outer', offset: 0, minCurve: 1 / 45 },
    ]);
    const all = placeDressing(t, [{ item: 'tire_wall', every: 4, side: 'outer', offset: 0 }]);
    expect(tires.length).toBeGreaterThan(0);
    expect(tires.length).toBeLessThan(all.length);
  });

  it('серпантин: отбойники вдоль всей трассы, арка растягивается по ширине', () => {
    const t = getTrack('jp_touge');
    const rails = placeDressing(t, defaultDressing(t, false)).filter((d) => d.item === 'guardrail');
    expect(rails.length).toBeGreaterThan(t.length / 4 - 5);
    const [arch] = placeDressing(t, [
      { item: 'start_arch', side: 'both', offset: 0, at: [10], spanWidth: 24 },
    ]);
    expect(arch!.sx).toBeGreaterThan(0.3);
  });
});
