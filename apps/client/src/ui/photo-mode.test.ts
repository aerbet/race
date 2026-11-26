import { describe, expect, it } from 'vitest';
import { orbit, telegramShareUrl } from './photo-mode';

describe('фоторежим (9.5)', () => {
  it('камера на заданном расстоянии и не уходит под землю', () => {
    const tg = { x: 10, y: 1, z: -5 };
    for (const [yaw, pitch] of [
      [0, 0.2],
      [2, -1],
      [4, 3],
    ] as const) {
      const p = orbit(tg, yaw, pitch, 6);
      expect(Math.hypot(p.x - tg.x, p.y - tg.y, p.z - tg.z)).toBeCloseTo(6, 6);
      expect(p.y).toBeGreaterThan(tg.y);
    }
  });

  it('ссылка t.me/share кодирует адрес и текст', () => {
    const u = telegramShareUrl('https://game.example/play', 'Мой заезд & рекорд');
    expect(u.startsWith('https://t.me/share/url?url=https%3A%2F%2Fgame.example%2Fplay&text=')).toBe(
      true,
    );
    expect(decodeURIComponent(u.split('text=')[1]!)).toBe('Мой заезд & рекорд');
  });
});
