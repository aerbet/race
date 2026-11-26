import type { InputManager } from '../input/input';

/** Отладочная панель: значения всех устройств ввода. */
export class InputDebug {
  readonly el: HTMLDivElement;
  constructor(
    parent: HTMLElement,
    private readonly input: InputManager,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'debug-input';
    parent.appendChild(this.el);
  }
  update(): void {
    const f = (v: number | undefined) => (v ?? 0).toFixed(2).padStart(5);
    const lines = [`device: ${this.input.device}`];
    for (const d of ['keyboard', 'gamepad', 'touch'] as const) {
      const r = this.input.raw[d];
      lines.push(
        `${d.padEnd(8)} thr${f(r.throttle)} brk${f(r.brake)} str${f(r.steer)} hb${f(r.handbrake)} N₂O${f(r.nitro)}`,
      );
    }
    if (this.input.gamepad.connected) lines.push(`gamepad: ${this.input.gamepad.id.slice(0, 40)}`);
    this.el.textContent = lines.join('\n');
  }
}
