import { describe, expect, it } from 'vitest';
import { CARS, CarConfigError, parseCarConfig, sampleCurve } from './index';
import coupe from './era2000_coupe.json';

describe('car config', () => {
  it('both starter configs are valid', () => {
    expect(Object.keys(CARS)).toEqual(['era2000_coupe', 'era2026_hatch']);
  });

  it('missing field gives a clear error with a path', () => {
    const bad = structuredClone(coupe) as Record<string, unknown>;
    delete bad.mass;
    expect(() => parseCarConfig(bad, 'bad.json')).toThrow(CarConfigError);
    expect(() => parseCarConfig(bad, 'bad.json')).toThrow(/bad\.json[\s\S]*mass/);
  });

  it('out-of-range nitro boost is rejected', () => {
    const bad = structuredClone(coupe);
    bad.nitro.boost = 0.9;
    expect(() => parseCarConfig(bad)).toThrow(/nitro\.boost/);
  });

  it('unsorted curve is rejected', () => {
    const bad = structuredClone(coupe);
    bad.engine.torqueCurve = [
      [5000, 100],
      [1000, 200],
    ];
    expect(() => parseCarConfig(bad)).toThrow(/engine\.torqueCurve/);
  });

  it('redline below idle is rejected', () => {
    const bad = structuredClone(coupe);
    bad.engine.redlineRpm = 500;
    expect(() => parseCarConfig(bad)).toThrow(/redlineRpm/);
  });

  it('sampleCurve interpolates and clamps', () => {
    const c = [
      [0, 0],
      [10, 100],
    ] as const;
    expect(sampleCurve(c, 5)).toBe(50);
    expect(sampleCurve(c, -1)).toBe(0);
    expect(sampleCurve(c, 99)).toBe(100);
  });
});
