import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CARS } from '../cars/index';
import { parseCarConfig } from '../cars/schema';
import { PART_CATEGORIES, applyTuning, computePI, piClass, type PartLevels } from './tuning';

const FULL: PartLevels = Object.fromEntries(PART_CATEGORIES.map((c) => [c, 4]));
const CASES: { car: string; parts: PartLevels }[] = [];
for (const car of Object.keys(CARS)) {
  CASES.push({ car, parts: {} });
  CASES.push({ car, parts: { engine: 2, tires: 1 } });
  CASES.push({ car, parts: { engine: 4, turbo: 3, weight: 2, nitro: 1 } });
  CASES.push({ car, parts: FULL });
}
const fixturePath = new URL('./pi-fixtures.json', import.meta.url);

describe('tuning', () => {
  it('stock cars are class D; fully tuned: 2000-era reaches A, 2026 reaches B', () => {
    for (const c of Object.values(CARS)) expect(piClass(computePI(c))).toBe('D');
    expect(piClass(computePI(applyTuning(CARS.era2000_coupe!, FULL)))).toBe('A');
    expect(piClass(computePI(applyTuning(CARS.era2026_hatch!, FULL)))).toBe('B');
  });

  it('tuned config is still valid and every part raises PI or keeps it', () => {
    for (const c of Object.values(CARS)) {
      expect(() => parseCarConfig(applyTuning(c, FULL))).not.toThrow();
      const base = computePI(c);
      for (const cat of PART_CATEGORIES)
        expect(computePI(applyTuning(c, { [cat]: 4 }))).toBeGreaterThanOrEqual(base);
    }
  });

  it('era 2000 has more tuning headroom than era 2026', () => {
    const gain = (id: string) => computePI(applyTuning(CARS[id]!, FULL)) - computePI(CARS[id]!);
    expect(gain('era2000_coupe')).toBeGreaterThan(gain('era2026_hatch'));
  });

  it('matches the cross-language fixture (Java PiCalculator uses the same file)', () => {
    const actual = CASES.map((k) => ({ ...k, pi: computePI(applyTuning(CARS[k.car]!, k.parts)) }));
    if (process.env.UPDATE_FIXTURES || !existsSync(fixturePath))
      writeFileSync(fixturePath, JSON.stringify(actual, null, 2) + '\n');
    expect(JSON.parse(readFileSync(fixturePath, 'utf8'))).toEqual(actual);
  });
});
