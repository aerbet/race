import type { InputFrame } from '@sr/shared';

/** Клавиатура: дискретные клавиши → плавное доведение руля. */
export class KeyboardInput {
  private down = new Set<string>();
  private shiftQueued = 0;
  private steer = 0;
  enabled = true;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.down.add(e.code);
      if (e.code === 'KeyE') this.shiftQueued = 1;
      if (e.code === 'KeyQ') this.shiftQueued = -1;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code))
        e.preventDefault();
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.down.clear());
  }

  private has(...codes: string[]) {
    return codes.some((c) => this.down.has(c));
  }

  get active(): boolean {
    return this.down.size > 0;
  }

  /** rate/returnRate — из конфига машины (1/с). */
  sample(dt: number, rate: number, returnRate: number): Partial<InputFrame> {
    const left = this.has('ArrowLeft', 'KeyA');
    const right = this.has('ArrowRight', 'KeyD');
    const target = (right ? 1 : 0) - (left ? 1 : 0);
    if (target !== 0) {
      // встречное направление — быстрее, как возврат
      const r = Math.sign(target) !== Math.sign(this.steer) && this.steer !== 0 ? returnRate : rate;
      this.steer +=
        Math.sign(target - this.steer) * Math.min(Math.abs(target - this.steer), r * dt);
    } else {
      this.steer -= Math.sign(this.steer) * Math.min(Math.abs(this.steer), returnRate * dt);
    }
    const shift = this.shiftQueued;
    this.shiftQueued = 0;
    return {
      throttle: this.has('ArrowUp', 'KeyW') ? 1 : 0,
      brake: this.has('ArrowDown', 'KeyS') ? 1 : 0,
      steer: this.steer,
      handbrake: this.has('Space') ? 1 : 0,
      nitro: this.has('ShiftLeft', 'ShiftRight', 'KeyN') ? 1 : 0,
      shift,
      reset: this.has('KeyR') ? 1 : 0,
    };
  }

  pressed(code: string): boolean {
    return this.down.has(code);
  }
}
