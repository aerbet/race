import { describe, expect, it } from 'vitest';
import { LOOKS, RARITIES, SHOP, SHOP_TABS, resolveVisual, tabOfSlot } from './shop';

describe('витрина (9.4)', () => {
  it('у каждого предмета есть редкость и вкладка, id уникальны', () => {
    const ids = new Set<string>();
    for (const c of SHOP.cosmetics) {
      expect(RARITIES, c.id).toContain(c.rarity);
      expect(Object.keys(SHOP_TABS)).toContain(tabOfSlot(c.slot));
      expect(ids.has(c.id), c.id).toBe(false);
      ids.add(c.id);
    }
    // В каждой вкладке есть что показать
    for (const tab of Object.keys(SHOP_TABS))
      expect(
        SHOP.cosmetics.some((c) => tabOfSlot(c.slot) === tab),
        tab,
      ).toBe(true);
  });

  it('образы: легендарные, значения слотов есть в каталоге или свободны', () => {
    const free = new Set(['livery:none', 'rims:five', 'kit:street', 'kit:stock']);
    for (const l of LOOKS) {
      expect(SHOP.cosmetics.find((c) => c.id === `look_${l.id}`)?.rarity).toBe('legendary');
      for (const [slot, value] of Object.entries(l.set)) {
        if (slot === 'paint2' || value.startsWith('#')) continue;
        const known =
          free.has(`${slot}:${value}`) ||
          SHOP.cosmetics.some((c) => c.slot === slot && c.value === value);
        expect(known, `${l.id}.${slot}=${value}`).toBe(true);
      }
    }
  });

  it('образ перекрывает отдельные слоты, vinyl читается как livery', () => {
    expect(resolveVisual({ vinyl: 'tribal' }).livery).toBe('tribal');
    const v = resolveVisual({ paint: '#ffffff', rims: 'five', look: 'sakura' });
    expect(v.paint).toBe('#ffb7d0');
    expect(v.kit).toBe('drift');
    expect(resolveVisual({ paint: '#ffffff', look: 'none' }).paint).toBe('#ffffff');
  });

  it('без чужих брендов и запрещённых слов', () => {
    const all = JSON.stringify(SHOP).toLowerCase();
    for (const w of ['need for speed', 'nfs', 'underground']) expect(all).not.toContain(w);
  });
});
