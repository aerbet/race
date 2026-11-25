/** Состояние управления на один шаг физики. throttle/brake/handbrake/nitro 0..1, steer −1..1. */
export interface InputFrame {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: number;
  nitro: number;
  /** Ручная коробка: +1 повышение, −1 понижение (импульс на один шаг). */
  shift: number;
  reset: number;
}

export const emptyInput = (): InputFrame => ({
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: 0,
  nitro: 0,
  shift: 0,
  reset: 0,
});

const q = (v: number, lo: number) =>
  Math.round(((Math.min(1, Math.max(lo, v)) - lo) / (1 - lo)) * 255);
const dq = (b: number, lo: number) => lo + (b / 255) * (1 - lo);
/** Руль кодируется симметрично: 0 → ровно 0. */
const qs = (v: number) => Math.round(Math.min(1, Math.max(-1, v)) * 127) + 128;
const dqs = (b: number) => (b - 128) / 127;

/** Квантование до байта — запись ввода компактная и воспроизводится бит в бит. */
export function quantizeInput(f: InputFrame): InputFrame {
  return {
    throttle: dq(q(f.throttle, 0), 0),
    brake: dq(q(f.brake, 0), 0),
    steer: dqs(qs(f.steer)),
    handbrake: dq(q(f.handbrake, 0), 0),
    nitro: dq(q(f.nitro, 0), 0),
    shift: Math.sign(f.shift),
    reset: f.reset > 0.5 ? 1 : 0,
  };
}

const BYTES = 6;

/** Запись ввода по шагам. Каждый шаг — 6 байт. */
export class InputRecorder {
  private buf = new Uint8Array(BYTES * 1024);
  length = 0;

  push(f: InputFrame): void {
    if ((this.length + 1) * BYTES > this.buf.length) {
      const nb = new Uint8Array(this.buf.length * 2);
      nb.set(this.buf);
      this.buf = nb;
    }
    const o = this.length * BYTES;
    this.buf[o] = q(f.throttle, 0);
    this.buf[o + 1] = q(f.brake, 0);
    this.buf[o + 2] = qs(f.steer);
    this.buf[o + 3] = q(f.handbrake, 0);
    this.buf[o + 4] = q(f.nitro, 0);
    this.buf[o + 5] = (f.shift > 0 ? 1 : 0) | (f.shift < 0 ? 2 : 0) | (f.reset > 0.5 ? 4 : 0);
    this.length++;
  }

  toBytes(): Uint8Array {
    return this.buf.slice(0, this.length * BYTES);
  }

  static frameAt(bytes: Uint8Array, i: number): InputFrame {
    const o = i * BYTES;
    const flags = bytes[o + 5] ?? 0;
    return {
      throttle: dq(bytes[o] ?? 0, 0),
      brake: dq(bytes[o + 1] ?? 0, 0),
      steer: dqs(bytes[o + 2] ?? 128),
      handbrake: dq(bytes[o + 3] ?? 0, 0),
      nitro: dq(bytes[o + 4] ?? 0, 0),
      shift: flags & 1 ? 1 : flags & 2 ? -1 : 0,
      reset: flags & 4 ? 1 : 0,
    };
  }

  static frameCount(bytes: Uint8Array): number {
    return Math.floor(bytes.length / BYTES);
  }
}

/** Воспроизведение записи. */
export class InputPlayer {
  i = 0;
  constructor(private readonly bytes: Uint8Array) {}
  get done(): boolean {
    return this.i >= InputRecorder.frameCount(this.bytes);
  }
  next(): InputFrame {
    if (this.done) return emptyInput();
    return InputRecorder.frameAt(this.bytes, this.i++);
  }
}

export function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]!);
  return btoa(s);
}
export function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
