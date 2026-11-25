import GUI from 'lil-gui';
import { cloneCar, getCar, parseCarConfig, type CarConfig } from '@sr/shared';
import type { Vehicle } from '@sr/physics';

/** Диапазоны для известных полей (остальные — от значения). */
const RANGES: Record<string, [number, number, number]> = {
  mass: [600, 3000, 10],
  inertiaScale: [0.3, 3, 0.05],
  awdRearShare: [0, 1, 0.01],
  stiffness: [10000, 150000, 500],
  damping: [500, 15000, 100],
  antiRoll: [0, 50000, 500],
  restLength: [0.15, 0.7, 0.01],
  travel: [0.05, 0.5, 0.01],
  frontGrip: [0.3, 2, 0.01],
  rearGrip: [0.3, 2, 0.01],
  maxAngleDeg: [10, 60, 0.5],
  minAngleDeg: [1, 40, 0.5],
  speedRefKmh: [50, 350, 5],
  yawAccel: [0, 8, 0.05],
  rearGripScale: [0.1, 1, 0.01],
  minSpeedKmh: [0, 120, 1],
  attackRate: [0.5, 20, 0.1],
  strength: [0, 60, 0.5],
  speedKeep: [0, 1, 0.01],
  recoverRate: [0.2, 10, 0.1],
  yawDamp: [0, 10, 0.1],
  friction: [0, 1.5, 0.01],
  restitution: [0, 1, 0.01],
  seconds: [1, 10, 0.5],
  boost: [0.25, 0.4, 0.01],
  capacity: [2, 4, 0.1],
  drag: [0, 2, 0.01],
  downforce: [0, 5, 0.05],
  maxForce: [2000, 40000, 100],
  handbrakeForce: [0, 20000, 100],
  frontBias: [0, 1, 0.01],
  shiftTime: [0, 0.6, 0.01],
  engineBrake: [0, 300, 5],
};

/**
 * Панель «ощущений»: все параметры машины на лету + сохранение пресета в JSON.
 */
export class DebugPanel {
  gui!: GUI;
  private cfg: CarConfig;
  readonly telemetry: TelemetryGraph;

  constructor(
    private readonly vehicle: Vehicle,
    parent: HTMLElement,
  ) {
    this.cfg = cloneCar(vehicle.cfg);
    this.createGui();
    this.telemetry = new TelemetryGraph(parent);
  }

  private createGui(): void {
    this.gui = new GUI({ title: `Настройка: ${this.cfg.name}`, width: 320 });
    this.gui.domElement.style.zIndex = '40';
    this.build(this.gui, this.cfg as unknown as Record<string, unknown>, '');
    const actions = {
      save: () => this.download(),
      reset: () => {
        this.cfg = cloneCar(getCar(this.vehicle.cfg.id));
        this.vehicle.setConfig(cloneCar(this.cfg));
        this.gui.destroy();
        this.createGui();
      },
    };
    this.gui.add(actions, 'save').name('💾 Сохранить JSON');
    this.gui.add(actions, 'reset').name('↺ Сбросить к исходному');
  }

  private build(folder: GUI, obj: Record<string, unknown>, path: string): void {
    for (const [k, v] of Object.entries(obj)) {
      const p = path ? `${path}.${k}` : k;
      if (typeof v === 'number') {
        const r = RANGES[k];
        const ctrl = r ? folder.add(obj, k, r[0], r[1], r[2]) : folder.add(obj, k);
        ctrl.onChange(() => this.apply());
      } else if (typeof v === 'boolean') {
        folder.add(obj, k).onChange(() => this.apply());
      } else if (Array.isArray(v)) {
        if (v.every((x) => typeof x === 'number')) {
          const f = folder.addFolder(k);
          f.close();
          v.forEach((_x, i) =>
            f.add(v as unknown as Record<string, number>, String(i)).onChange(() => this.apply()),
          );
        } else if (v.every((x) => Array.isArray(x))) {
          const f = folder.addFolder(`${k} (кривая)`);
          f.close();
          (v as number[][]).forEach((pt) =>
            f
              .add(pt as unknown as Record<string, number>, '1')
              .name(`@ ${pt[0]}`)
              .onChange(() => this.apply()),
          );
        }
      } else if (v && typeof v === 'object') {
        const f = folder.addFolder(k);
        if (path) f.close();
        this.build(f, v as Record<string, unknown>, p);
      }
    }
  }

  private apply(): void {
    try {
      this.vehicle.setConfig(parseCarConfig(cloneCar(this.cfg), 'панель отладки'));
      this.gui.domElement.style.outline = '';
    } catch (e) {
      // Невалидное значение — подсвечиваем и не применяем
      this.gui.domElement.style.outline = '2px solid #ff3050';
      console.warn(e);
    }
  }

  private download(): void {
    const blob = new Blob([JSON.stringify(this.cfg, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.cfg.id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  update(): void {
    this.telemetry.push(this.vehicle);
  }

  dispose(): void {
    this.gui.destroy();
    this.telemetry.dispose();
  }
}

const N = 300;
const SERIES = [
  { key: 'speed', label: 'скорость, км/ч', color: '#29e0ff', max: 300 },
  { key: 'rpm', label: 'обороты', color: '#ff2bd6', max: 9000 },
  { key: 'slip', label: 'угол заноса, °', color: '#ffb02b', max: 90 },
  { key: 'lf', label: 'нагр. ПЛ', color: '#8cff3a', max: 12000 },
  { key: 'rf', label: 'нагр. ПП', color: '#5bd46a', max: 12000 },
  { key: 'lr', label: 'нагр. ЗЛ', color: '#c7a6ff', max: 12000 },
  { key: 'rr', label: 'нагр. ЗП', color: '#9f86ff', max: 12000 },
] as const;

/** Телеметрия поверх экрана: скорость, обороты, угол заноса, нагрузка на колёса. */
export class TelemetryGraph {
  readonly canvas: HTMLCanvasElement;
  private data: Record<string, Float32Array> = {};
  private i = 0;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 360;
    this.canvas.height = 170;
    Object.assign(this.canvas.style, {
      position: 'fixed',
      left: '8px',
      bottom: '8px',
      zIndex: '21',
      background: 'rgba(4,6,14,.72)',
      border: '1px solid rgba(120,140,200,.3)',
      pointerEvents: 'none',
    });
    parent.appendChild(this.canvas);
    for (const s of SERIES) this.data[s.key] = new Float32Array(N);
  }

  push(v: Vehicle): void {
    const t = v.telemetry();
    const vals: Record<string, number> = {
      speed: t.speedKmh,
      rpm: t.rpm,
      slip: Math.abs(t.slipAngleDeg),
      lf: v.wheels[0]!.load,
      rf: v.wheels[1]!.load,
      lr: v.wheels[2]!.load,
      rr: v.wheels[3]!.load,
    };
    for (const s of SERIES) this.data[s.key]![this.i % N] = vals[s.key]!;
    this.i++;
    this.draw(vals, t.gear, t.driftFactor);
  }

  private draw(cur: Record<string, number>, gear: number, df: number): void {
    const g = this.canvas.getContext('2d')!;
    const W = this.canvas.width,
      H = this.canvas.height;
    g.clearRect(0, 0, W, H);
    const top = 64;
    g.strokeStyle = 'rgba(255,255,255,.08)';
    for (const y of [20, 40, 60]) {
      g.beginPath();
      g.moveTo(0, top + y);
      g.lineTo(W, top + y);
      g.stroke();
    }
    // Полоса 20–55° для угла заноса
    g.fillStyle = 'rgba(255,176,43,.08)';
    g.fillRect(0, H - 4 - (55 / 90) * (H - top - 8), W, ((55 - 20) / 90) * (H - top - 8));
    for (const s of SERIES) {
      const d = this.data[s.key]!;
      g.strokeStyle = s.color;
      g.lineWidth = s.key.length === 2 ? 1 : 1.6;
      g.beginPath();
      for (let k = 0; k < N; k++) {
        const val = d[(this.i + k) % N]!;
        const x = (k / (N - 1)) * W;
        const y = H - 4 - Math.min(1, val / s.max) * (H - top - 8);
        if (k === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.font = '11px ui-monospace, monospace';
    SERIES.forEach((s, k) => {
      g.fillStyle = s.color;
      const col = k < 3 ? 0 : 1;
      const row = k < 3 ? k : k - 3;
      g.fillText(`${s.label}: ${Math.round(cur[s.key]!)}`, 6 + col * 180, 14 + row * 14);
    });
    g.fillStyle = '#fff';
    g.fillText(`передача ${gear}  дрифт ${df.toFixed(2)}`, 6, 56);
  }

  dispose(): void {
    this.canvas.remove();
  }
}
