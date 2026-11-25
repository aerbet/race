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
    const lines = [`устройство: ${this.input.device}`];
    for (const d of ['keyboard', 'gamepad', 'touch'] as const) {
      const r = this.input.raw[d];
      lines.push(
        `${d.padEnd(8)} газ${f(r.throttle)} торм${f(r.brake)} руль${f(r.steer)} руч${f(r.handbrake)} N₂O${f(r.nitro)}`,
      );
    }
    if (this.input.gamepad.connected) lines.push(`геймпад: ${this.input.gamepad.id.slice(0, 40)}`);
    this.el.textContent = lines.join('\n');
  }
}
