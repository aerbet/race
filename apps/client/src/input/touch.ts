import type { InputFrame } from '@sr/shared';

type Btn = 'left' | 'right' | 'brake' | 'gas' | 'drift' | 'nitro';

/**
 * Сенсорное управление: кнопки руля слева, тормоз/дрифт/нитро справа.
 * Автогаз (по умолчанию включён) и опциональный наклон.
 */
export class TouchInput {
  readonly el: HTMLDivElement;
  private held = new Set<Btn>();
  private steer = 0;
  autoGas = true;
  tilt = false;

  /** Загрузить и сохранить настройки сенсора. */
  loadPrefs(): void {
    try {
      const p = JSON.parse(localStorage.getItem('sr:touch') ?? '{}') as {
        autoGas?: boolean;
        tilt?: boolean;
      };
      if (typeof p.autoGas === 'boolean') this.autoGas = p.autoGas;
      if (typeof p.tilt === 'boolean') this.tilt = p.tilt;
    } catch {
      /* без хранилища — значения по умолчанию */
    }
  }

  savePrefs(): void {
    try {
      localStorage.setItem('sr:touch', JSON.stringify({ autoGas: this.autoGas, tilt: this.tilt }));
    } catch {
      /* без хранилища */
    }
    this.el.classList.toggle('autogas', this.autoGas);
  }

  /** Наклон на iOS требует разрешения по жесту пользователя. */
  async enableTilt(on: boolean): Promise<void> {
    const DOE = (
      window as unknown as {
        DeviceOrientationEvent?: { requestPermission?: () => Promise<string> };
      }
    ).DeviceOrientationEvent;
    if (on && DOE?.requestPermission) {
      try {
        if ((await DOE.requestPermission()) !== 'granted') on = false;
      } catch {
        on = false;
      }
    }
    this.tilt = on;
    this.savePrefs();
  }
  private tiltValue = 0;
  visible = false;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'touch-controls hidden';
    const mk = (id: Btn, label: string, cls: string) => {
      const b = document.createElement('button');
      b.className = `tbtn ${cls}`;
      b.textContent = label;
      b.dataset.btn = id;
      const on = (e: Event) => {
        e.preventDefault();
        this.held.add(id);
        b.classList.add('on');
      };
      const off = (e: Event) => {
        e.preventDefault();
        this.held.delete(id);
        b.classList.remove('on');
      };
      b.addEventListener('touchstart', on, { passive: false });
      b.addEventListener('touchend', off, { passive: false });
      b.addEventListener('touchcancel', off, { passive: false });
      b.addEventListener('pointerdown', (e) => e.pointerType === 'mouse' && on(e));
      b.addEventListener('pointerup', (e) => e.pointerType === 'mouse' && off(e));
      b.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && off(e));
      this.el.appendChild(b);
    };
    mk('left', '◀', 'left');
    mk('right', '▶', 'right');
    mk('brake', 'ТОРМ', 'brake');
    mk('drift', 'ДРИФТ', 'drift');
    mk('nitro', 'N₂O', 'nitro');
    mk('gas', 'ГАЗ', 'gas');
    parent.appendChild(this.el);
    window.addEventListener('deviceorientation', (e) => {
      if (!this.tilt || e.gamma == null) return;
      const landscape = Math.abs(window.orientation as number) === 90;
      const raw = landscape ? (e.beta ?? 0) * Math.sign(window.orientation as number) : e.gamma;
      this.tiltValue = Math.max(-1, Math.min(1, raw / 25));
    });
  }

  show(v: boolean): void {
    this.visible = v;
    this.el.classList.toggle('hidden', !v);
    this.el.classList.toggle('autogas', this.autoGas);
    document.body.classList.toggle('touch-ui', v);
  }

  get active(): boolean {
    return this.held.size > 0;
  }

  sample(dt: number): Partial<InputFrame> {
    let target = (this.held.has('right') ? 1 : 0) - (this.held.has('left') ? 1 : 0);
    if (this.tilt) target = this.tiltValue;
    const rate = 4;
    this.steer +=
      Math.sign(target - this.steer) * Math.min(Math.abs(target - this.steer), rate * dt);
    const brake = this.held.has('brake');
    const gas = this.autoGas ? !brake : this.held.has('gas');
    return {
      throttle: gas || this.held.has('gas') ? 1 : 0,
      brake: brake ? 1 : 0,
      steer: this.steer,
      // Автодрифт: кнопка «ДРИФТ» = короткий ручник
      handbrake: this.held.has('drift') ? 1 : 0,
      nitro: this.held.has('nitro') ? 1 : 0,
      shift: 0,
      reset: 0,
    };
  }
}

export const isTouchDevice = (): boolean =>
  'ontouchstart' in window || navigator.maxTouchPoints > 0;
