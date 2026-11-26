import { describe, expect, it } from 'vitest';
import { signsForModule, type ModuleBox } from './kit-signs';

const box: ModuleBox = { minX: -18, maxX: 18, maxZ: 6, height: 40 };

describe('вывески модульных городов (хвост 10.x)', () => {
  it('одно и то же место — одни и те же вывески', () => {
    expect(signsForModule(box, 10, 20, 0.5, 1, 1, 1, 'tokyo')).toEqual(
      signsForModule(box, 10, 20, 0.5, 1, 1, 1, 'tokyo'),
    );
  });

  it('вывеска — на фасаде к улице (+Z модуля), развёрнута как модуль', () => {
    // Найдём место, где вывеска есть
    let found = null;
    for (let i = 0; i < 200 && !found; i++) {
      const s = signsForModule(box, i * 3.1, 7, Math.PI / 2, 1, 1, 1, 'tokyo');
      if (s.length) found = { s, x: i * 3.1 };
    }
    expect(found).not.toBeNull();
    const [h] = found!.s;
    // yaw = 90°: локальная +Z модуля смотрит в мировую +X
    expect(h!.x).toBeCloseTo(found!.x + box.maxZ + 0.2, 5);
    expect(h!.z).toBeCloseTo(7, 5);
    expect(h!.yaw).toBeCloseTo(Math.PI / 2);
    expect(h!.w).toBeLessThanOrEqual(12);
  });

  it('низкие и узкие модули — без вывесок; в Москве реже, чем в Токио', () => {
    expect(signsForModule({ ...box, height: 6 }, 0, 0, 0, 1, 1, 1, 'tokyo')).toEqual([]);
    expect(signsForModule({ ...box, minX: -2, maxX: 2 }, 0, 0, 0, 1, 1, 1, 'tokyo')).toEqual([]);
    let tokyo = 0;
    let moscow = 0;
    for (let i = 0; i < 400; i++) {
      tokyo += signsForModule(box, i * 5.3, i * 2.1, 0, 1, 1, 1, 'tokyo').length ? 1 : 0;
      moscow += signsForModule(box, i * 5.3, i * 2.1, 0, 1, 1, 1, 'moscow').length ? 1 : 0;
    }
    expect(tokyo).toBeGreaterThan(moscow);
    expect(moscow).toBeGreaterThan(0);
  });
});
