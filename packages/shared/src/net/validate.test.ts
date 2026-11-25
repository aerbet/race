import { describe, expect, it } from 'vitest';
import { CARS } from '../cars/index';
import { getTrack } from '../tracks/index';
import { CarFlags, type CarState } from './protocol';
import { checkSector, checkState, maxPlausibleSpeed, newPlayerTrack } from './validate';

const cfg = CARS.era2000_coupe!;
const track = getTrack('polygon');
const s0 = track.samples[0]!;
const base = (p: Partial<CarState> = {}): CarState => ({
  x: s0.x,
  y: 0.8,
  z: s0.z,
  qx: 0,
  qy: 0,
  qz: 0,
  qw: 1,
  vx: 0,
  vy: 0,
  vz: -30,
  steer: 0,
  rpm: 5000,
  flags: 0,
  ...p,
});

describe('plausibility checks (forged packets)', () => {
  it('accepts normal movement', () => {
    const pt = newPlayerTrack();
    expect(checkState(pt, base(), 100, cfg, track).ok).toBe(true);
    pt.last = base();
    pt.lastStep = 100;
    expect(checkState(pt, base({ z: s0.z - 1 }), 102, cfg, track).ok).toBe(true);
  });

  it('rejects impossible speed', () => {
    const v = maxPlausibleSpeed(cfg) * 1.2;
    expect(checkState(newPlayerTrack(), base({ vz: -v }), 1, cfg, track)).toEqual({
      ok: false,
      reason: 'speed',
    });
  });

  it('rejects teleports', () => {
    const pt = newPlayerTrack();
    pt.last = base();
    pt.lastStep = 100;
    expect(checkState(pt, base({ z: s0.z - 200 }), 102, cfg, track)).toEqual({
      ok: false,
      reason: 'teleport',
    });
  });

  it('allows reset onto the road but not off it', () => {
    const pt = newPlayerTrack();
    pt.last = base();
    pt.lastStep = 100;
    const onRoad = track.samples[200]!;
    expect(
      checkState(pt, base({ x: onRoad.x, z: onRoad.z, flags: CarFlags.Reset }), 102, cfg, track).ok,
    ).toBe(true);
    expect(
      checkState(pt, base({ x: 450, z: 450, flags: CarFlags.Reset }), 102, cfg, track),
    ).toEqual({
      ok: false,
      reason: 'reset-off-track',
    });
  });

  it('rejects NaN, out-of-world and replayed steps', () => {
    expect(checkState(newPlayerTrack(), base({ x: NaN }), 1, cfg, track).ok).toBe(false);
    expect(checkState(newPlayerTrack(), base({ x: 5000 }), 1, cfg, track).ok).toBe(false);
    const pt = newPlayerTrack();
    pt.last = base();
    pt.lastStep = 100;
    expect(checkState(pt, base(), 100, cfg, track)).toEqual({ ok: false, reason: 'step-order' });
  });

  it('sector time below theoretical minimum is rejected', () => {
    // 500 м за 1 секунду — невозможно
    expect(checkSector(0, 500, 60, cfg, track).ok).toBe(false);
    // 500 м за 15 секунд — нормально
    expect(checkSector(0, 500, 60 * 15, cfg, track).ok).toBe(true);
  });
});
