import type { InputFrame } from '@sr/shared';

const DEADZONE = 0.12;
const dz = (v: number) =>
  Math.abs(v) < DEADZONE ? 0 : (Math.sign(v) * (Math.abs(v) - DEADZONE)) / (1 - DEADZONE);

/** Gamepad API, стандартная раскладка: левый стик — руль, R2 — газ, L2 — тормоз, A/X — ручник, B — нитро. */
export class GamepadInput {
  private prevButtons: boolean[] = [];
  connected = false;
  id = '';

  sample(): Partial<InputFrame> | null {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = Array.from(pads).find((p) => p && p.connected);
    this.connected = !!pad;
    if (!pad) return null;
    this.id = pad.id;
    const b = (i: number) => pad.buttons[i]?.value ?? 0;
    const pressed = (i: number) => !!pad.buttons[i]?.pressed;
    const edge = (i: number) => pressed(i) && !this.prevButtons[i];
    const raw = dz(pad.axes[0] ?? 0);
    // Нелинейность: точнее в центре
    const steer = Math.sign(raw) * Math.pow(Math.abs(raw), 1.5);
    const out: Partial<InputFrame> = {
      throttle: b(7),
      brake: b(6),
      steer,
      handbrake: Math.max(b(0), b(2)) > 0.5 ? 1 : 0,
      nitro: Math.max(b(1), b(5)) > 0.5 ? 1 : 0,
      shift: edge(3) ? 1 : edge(4) ? -1 : 0,
      reset: pressed(8) ? 1 : 0,
    };
    this.prevButtons = pad.buttons.map((x) => x.pressed);
    return out;
  }

  /** Есть ли на геймпаде активность (для автопереключения устройства). */
  get active(): boolean {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = Array.from(pads).find((p) => p && p.connected);
    if (!pad) return false;
    return pad.buttons.some((x) => x.value > 0.1) || pad.axes.some((a) => Math.abs(a) > 0.3);
  }
}
