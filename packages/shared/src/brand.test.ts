import { describe, expect, it } from 'vitest';
import { BRAND, FIXED_DT, PHYSICS_HZ } from './index';

describe('shared', () => {
  it('brand id is kebab-case', () => {
    expect(BRAND.id).toMatch(/^[a-z-]+$/);
  });
  it('fixed step is 60 Hz', () => {
    expect(PHYSICS_HZ * FIXED_DT).toBeCloseTo(1);
  });
});
