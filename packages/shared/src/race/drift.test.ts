import { describe, expect, it } from 'vitest';
import { DriftScorer } from './drift';

const run = (d: DriftScorer, seconds: number, angle: number, speed: number, wall = false) => {
  for (let i = 0; i < seconds * 60; i++) d.update(1 / 60, angle, speed, wall);
};

describe('DriftScorer', () => {
  it('more angle and speed give more points', () => {
    const a = new DriftScorer();
    run(a, 2, 20, 60);
    const b = new DriftScorer();
    run(b, 2, 40, 90);
    expect(b.chain).toBeGreaterThan(a.chain * 2);
  });

  it('multiplier grows with chain length and banks after a gap', () => {
    const d = new DriftScorer();
    run(d, 5, 35, 80);
    expect(d.multiplier).toBeGreaterThan(1);
    const chain = d.chain;
    run(d, 2, 0, 80);
    expect(d.total).toBe(Math.round(chain));
    expect(d.chain).toBe(0);
  });

  it('short pause keeps the chain', () => {
    const d = new DriftScorer();
    run(d, 3, 35, 80);
    run(d, 1, 0, 80);
    run(d, 1, 35, 80);
    expect(d.total).toBe(0);
    expect(d.chain).toBeGreaterThan(0);
  });

  it('wall hit loses the chain', () => {
    const d = new DriftScorer();
    run(d, 3, 35, 80);
    d.update(1 / 60, 35, 80, true);
    expect(d.chain).toBe(0);
    expect(d.lastEvent).toBe('lost');
    run(d, 3, 0, 80);
    expect(d.total).toBe(0);
  });

  it('no points below min speed', () => {
    const d = new DriftScorer();
    run(d, 3, 40, 20);
    expect(d.chain).toBe(0);
  });
});
