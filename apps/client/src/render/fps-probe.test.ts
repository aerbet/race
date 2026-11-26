import { describe, expect, it } from 'vitest';
import { FpsProbe } from './fps-probe';

const run = (fps: number, seconds = 5) => {
  const p = new FpsProbe();
  let fired = 0;
  for (let i = 0; i < fps * seconds; i++) if (p.tick(1 / fps)) fired++;
  return { p, fired };
};

describe('FpsProbe', () => {
  it('slow device: fires once after warmup + 3 s', () => {
    const { p, fired } = run(25);
    expect(fired).toBe(1);
    expect(p.fps).toBeCloseTo(25, 0);
  });
  it('fast device: never fires', () => {
    expect(run(60).fired).toBe(0);
    expect(run(144).fired).toBe(0);
  });
  it('ignores a long first frame (loading hitch)', () => {
    const p = new FpsProbe();
    p.tick(0.45);
    let fired = false;
    for (let i = 0; i < 60 * 4; i++) fired ||= p.tick(1 / 60);
    expect(fired).toBe(false);
    expect(p.fps).toBeGreaterThan(55);
  });
});
