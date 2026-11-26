import { emptyInput, quantizeInput, type InputFrame } from '@sr/shared';
import { KeyboardInput } from './keyboard';
import { GamepadInput } from './gamepad';
import { TouchInput, isTouchDevice } from './touch';

export type DeviceName = 'keyboard' | 'gamepad' | 'touch';

/** Единый слой ввода: берёт значения с последнего активного устройства. */
export class InputManager {
  readonly keyboard: KeyboardInput;
  readonly gamepad = new GamepadInput();
  readonly touch: TouchInput;
  device: DeviceName = 'keyboard';
  /** Последние сырые значения каждого устройства (для отладочной панели). */
  readonly raw: Record<DeviceName, Partial<InputFrame>> = { keyboard: {}, gamepad: {}, touch: {} };
  steerRate = 7;
  steerReturn = 10;

  constructor(uiRoot: HTMLElement) {
    this.keyboard = new KeyboardInput();
    this.touch = new TouchInput(uiRoot);
    this.touch.loadPrefs();
    if (isTouchDevice()) this.device = 'touch';
  }

  /** Вызывается один раз на шаг физики. Значения квантуются — запись совпадает бит в бит. */
  sample(dt: number): InputFrame {
    this.raw.keyboard = this.keyboard.sample(dt, this.steerRate, this.steerReturn);
    this.raw.gamepad = this.gamepad.sample() ?? {};
    this.raw.touch = this.touch.sample(dt, this.steerRate, this.steerReturn);
    if (this.keyboard.active) this.device = 'keyboard';
    else if (this.gamepad.active) this.device = 'gamepad';
    else if (this.touch.active) this.device = 'touch';
    const src = this.raw[this.device];
    return quantizeInput({ ...emptyInput(), ...src });
  }
}
