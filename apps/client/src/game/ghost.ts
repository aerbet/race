import { fromBase64, toBase64 } from '@sr/shared';

/** Частота записи призрака, Гц (каждый 3-й шаг физики). */
export const GHOST_HZ = 20;
export const GHOST_EVERY = 60 / GHOST_HZ;
const POS_SCALE = 25; // 4 см, диапазон ±1,3 км
const Q_SCALE = 32767;

export interface GhostFrame {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

/**
 * Запись призрака: позиция (int16, шаг 4 см, дельта от первой точки) +
 * кватернион (int16). 14 байт на кадр, 20 кадров в секунду → ~17 КБ на минуту.
 */
export class GhostRecorder {
  private frames: GhostFrame[] = [];

  push(f: GhostFrame): void {
    this.frames.push(f);
  }

  get length(): number {
    return this.frames.length;
  }

  /** Отрезать запись до кадров [from, to). */
  slice(from: number, to = this.frames.length): GhostData {
    return encodeGhost(this.frames.slice(from, to));
  }

  reset(): void {
    this.frames = [];
  }
}

export interface GhostData {
  /** base64 */
  data: string;
  frames: number;
  ox: number;
  oy: number;
  oz: number;
}

export function encodeGhost(frames: GhostFrame[]): GhostData {
  const f0 = frames[0] ?? { x: 0, y: 0, z: 0 };
  const buf = new Int16Array(frames.length * 7);
  const clamp16 = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v)));
  frames.forEach((f, i) => {
    buf.set(
      [
        clamp16((f.x - f0.x) * POS_SCALE),
        clamp16((f.y - f0.y) * POS_SCALE),
        clamp16((f.z - f0.z) * POS_SCALE),
        clamp16(f.qx * Q_SCALE),
        clamp16(f.qy * Q_SCALE),
        clamp16(f.qz * Q_SCALE),
        clamp16(f.qw * Q_SCALE),
      ],
      i * 7,
    );
  });
  return {
    data: toBase64(new Uint8Array(buf.buffer)),
    frames: frames.length,
    ox: f0.x,
    oy: f0.y,
    oz: f0.z,
  };
}

export function decodeGhost(g: GhostData): GhostFrame[] {
  const bytes = fromBase64(g.data);
  const buf = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
  const out: GhostFrame[] = [];
  for (let i = 0; i < g.frames; i++) {
    const o = i * 7;
    out.push({
      x: g.ox + buf[o]! / POS_SCALE,
      y: g.oy + buf[o + 1]! / POS_SCALE,
      z: g.oz + buf[o + 2]! / POS_SCALE,
      qx: buf[o + 3]! / Q_SCALE,
      qy: buf[o + 4]! / Q_SCALE,
      qz: buf[o + 5]! / Q_SCALE,
      qw: buf[o + 6]! / Q_SCALE,
    });
  }
  return out;
}

export interface StoredGhost {
  ghost: GhostData;
  /** Время круга, шаги физики. */
  lapSteps: number;
  car: string;
  date: string;
}

const key = (track: string, car: string) => `sr:ghost:${track}:${car}`;

export function loadGhost(track: string, car: string): StoredGhost | null {
  try {
    const raw = localStorage.getItem(key(track, car));
    return raw ? (JSON.parse(raw) as StoredGhost) : null;
  } catch {
    return null;
  }
}

export function saveGhost(track: string, car: string, g: StoredGhost): void {
  try {
    localStorage.setItem(key(track, car), JSON.stringify(g));
  } catch {
    /* хранилище недоступно — призрак просто не сохранится */
  }
}
