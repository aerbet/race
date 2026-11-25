import { describe, expect, it } from 'vitest';
import { decodeGhost, encodeGhost, type GhostFrame } from './ghost';

describe('ghost compression', () => {
  it('round-trips positions within 2 cm (4 cm step) and quaternions within 1e-4', () => {
    const frames: GhostFrame[] = [];
    for (let i = 0; i < 1200; i++) {
      const a = i * 0.01;
      frames.push({
        x: 100 + Math.cos(a) * 600,
        y: 0.8 + Math.sin(i) * 0.1,
        z: -50 + Math.sin(a) * 300,
        qx: 0,
        qy: Math.sin(a / 2),
        qz: 0,
        qw: Math.cos(a / 2),
      });
    }
    const enc = encodeGhost(frames);
    const dec = decodeGhost(JSON.parse(JSON.stringify(enc)));
    expect(dec.length).toBe(frames.length);
    dec.forEach((d, i) => {
      const f = frames[i]!;
      expect(Math.abs(d.x - f.x)).toBeLessThan(0.02);
      expect(Math.abs(d.z - f.z)).toBeLessThan(0.02);
      expect(Math.abs(d.qy - f.qy)).toBeLessThan(1e-4);
    });
    // 14 байт на кадр
    expect(atob(enc.data).length).toBe(frames.length * 14);
  });
});
