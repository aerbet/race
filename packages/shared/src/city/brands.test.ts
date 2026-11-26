import { describe, expect, it } from 'vitest';
import { CITY_BRANDS } from './index';

describe('бренды на щитах (хвост 10.x)', () => {
  it('по 6 вымышленных брендов на набор, без реальных марок и запрещённых слов', () => {
    // Реальные бренды, которые легко «случайно» написать на щите
    const real = [
      'coca',
      'pepsi',
      'red bull',
      'monster',
      'shell',
      'pirelli',
      'michelin',
      'bridgestone',
      'yokohama',
      'sony',
      'nissan',
      'toyota',
      'honda',
      'bmw',
      'lada',
      'yandex',
      'сбер',
      'need for speed',
      'nfs',
      'underground',
    ];
    for (const kit of ['moscow', 'tokyo']) {
      const list = CITY_BRANDS[kit]!;
      expect(list.length).toBe(6);
      for (const b of list) {
        expect(b.bg).toMatch(/^#[0-9a-f]{6}$/);
        expect(b.fg).toMatch(/^#[0-9a-f]{6}$/);
        const s = `${b.name} ${b.tag}`.toLowerCase();
        for (const w of real) expect(s, b.name).not.toContain(w);
      }
    }
  });
});
