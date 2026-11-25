import { describe, expect, it } from 'vitest';
import { FixedStepLoop } from './loop';

function simulate(fps: number, seconds: number): number {
  const loop = new FixedStepLoop(() => {});
  const frames = Math.round(fps * seconds);
  for (let i = 0; i < frames; i++) loop.advance(1 / fps);
  return loop.steps;
}

describe('FixedStepLoop', () => {
  it.each([30, 60, 144, 120, 75])('10 s at %i fps gives 600 steps', (fps) => {
    expect(simulate(fps, 10)).toBe(600);
  });

  it('alpha is in [0,1)', () => {
    const loop = new FixedStepLoop(() => {});
    for (let i = 0; i < 100; i++) {
      loop.advance(1 / 144);
      expect(loop.alpha).toBeGreaterThanOrEqual(0);
      expect(loop.alpha).toBeLessThan(1);
    }
  });

  it('pause stops steps', () => {
    const loop = new FixedStepLoop(() => {});
    loop.paused = true;
    loop.advance(1);
    expect(loop.steps).toBe(0);
  });

  it('caps huge frame gaps', () => {
    const loop = new FixedStepLoop(() => {});
    expect(loop.advance(10)).toBe(8);
  });
});
