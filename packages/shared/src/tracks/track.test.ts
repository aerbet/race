import { describe, expect, it } from 'vitest';
import { getTrack, trackCoords, nearestSample } from './index';

describe.each(['polygon', 'night_sprint', 'jp_touge'])('track %s', (id) => {
  const t = getTrack(id);

  it('has reasonable length and fits 1 km ground', () => {
    expect(t.length).toBeGreaterThan(1500);
    expect(t.length).toBeLessThan(3500);
    expect(t.bounds.minX).toBeGreaterThan(-500);
    expect(t.bounds.maxX).toBeLessThan(500);
    expect(t.bounds.minZ).toBeGreaterThan(-500);
    expect(t.bounds.maxZ).toBeLessThan(500);
  });

  it('samples are ~2 m apart with unit tangents', () => {
    for (let i = 1; i < t.samples.length; i++) {
      const a = t.samples[i - 1]!,
        b = t.samples[i]!;
      expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThan(2.2);
      expect(Math.hypot(a.tx, a.tz)).toBeCloseTo(1, 5);
    }
  });

  it.skipIf(id !== 'polygon')('last checkpoint is the finish line at start', () => {
    const last = t.checkpoints[t.checkpoints.length - 1]!;
    expect(Math.hypot(last.x - t.samples[0]!.x, last.z - t.samples[0]!.z)).toBeLessThan(3);
  });

  it('track does not self-intersect (far samples keep distance)', () => {
    const S = t.samples;
    for (let i = 0; i < S.length; i += 3) {
      for (let j = i + 40; j < S.length; j += 3) {
        const raw = Math.abs(S[i]!.s - S[j]!.s);
        const ds = t.def.closed ? Math.min(raw, t.length - raw) : raw;
        if (ds < 120) continue;
        const d = Math.hypot(S[i]!.x - S[j]!.x, S[i]!.z - S[j]!.z);
        expect(d, `samples ${i} and ${j}`).toBeGreaterThan((S[i]!.width + S[j]!.width) / 2 + 6);
      }
    }
  });

  it('grid slots are on track, behind the line', () => {
    for (const g of t.grid) {
      const c = trackCoords(t, g.x, g.z);
      expect(Math.abs(c.lateral)).toBeLessThan(6);
      if (t.def.closed) expect(c.s).toBeGreaterThan(t.length - 60);
      else expect(c.s).toBeLessThan(t.def.startS);
    }
  });

  it('nearestSample local search agrees with global', () => {
    const s = t.samples[100]!;
    expect(nearestSample(t, s.x + 1, s.z, 95)).toBe(nearestSample(t, s.x + 1, s.z));
  });
});

describe('touge elevation', () => {
  it('climbs ~140 m with sane grades', () => {
    const t = getTrack('jp_touge');
    expect(t.elevated).toBe(true);
    expect(t.maxY - t.minY).toBeGreaterThan(120);
    for (let i = 1; i < t.samples.length; i++) {
      const a = t.samples[i - 1]!,
        b = t.samples[i]!;
      expect(Math.abs(b.y - a.y) / 2, `grade at ${i}`).toBeLessThan(0.14);
    }
  });
});
