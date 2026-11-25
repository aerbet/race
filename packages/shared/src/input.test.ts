import { describe, expect, it } from 'vitest';
import {
  InputPlayer,
  InputRecorder,
  fromBase64,
  quantizeInput,
  toBase64,
  type InputFrame,
} from './input';

function rnd(seed: number) {
  return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

describe('input recording', () => {
  it('record → play gives the same (quantized) stream', () => {
    const r = rnd(42);
    const rec = new InputRecorder();
    const src: InputFrame[] = [];
    for (let i = 0; i < 5000; i++) {
      const f: InputFrame = {
        throttle: r(),
        brake: r(),
        steer: r() * 2 - 1,
        handbrake: r() > 0.9 ? 1 : 0,
        nitro: r(),
        shift: r() > 0.98 ? 1 : r() > 0.98 ? -1 : 0,
        reset: 0,
      };
      src.push(quantizeInput(f));
      rec.push(f);
    }
    const bytes = fromBase64(toBase64(rec.toBytes()));
    const p = new InputPlayer(bytes);
    for (const f of src) expect(p.next()).toEqual(f);
    expect(p.done).toBe(true);
  });

  it('zero steer stays exactly zero', () => {
    expect(
      quantizeInput({ throttle: 0, brake: 0, steer: 0, handbrake: 0, nitro: 0, shift: 0, reset: 0 })
        .steer,
    ).toBe(0);
  });

  it('quantization is idempotent', () => {
    const f = quantizeInput({
      throttle: 0.33,
      brake: 0,
      steer: -0.71,
      handbrake: 1,
      nitro: 0,
      shift: 0,
      reset: 0,
    });
    expect(quantizeInput(f)).toEqual(f);
  });
});
