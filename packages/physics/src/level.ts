import type { BuiltTrack } from '@sr/shared';
import { sampleAt } from '@sr/shared';

export interface LevelBox {
  kind: 'wall' | 'ground';
  /** Центр. */
  x: number;
  y: number;
  z: number;
  /** Половинные размеры. */
  hx: number;
  hy: number;
  hz: number;
  yaw: number;
  /** Наклон вдоль длинной оси (серпантин), рад. */
  pitch?: number;
}

export interface LevelWedge {
  kind: 'ramp';
  /** Вершины выпуклой оболочки в мировых координатах. */
  vertices: number[];
}

export interface LevelGeometry {
  boxes: LevelBox[];
  wedges: LevelWedge[];
  /** Полотно дороги с перепадом высот (trimesh); на плоских трассах — нет. */
  road?: { vertices: number[]; indices: number[] };
}

/** Кватернион поворота: сначала наклон (вокруг X), затем рыскание (вокруг Y). */
export function yawPitchQuat(
  yaw: number,
  pitch = 0,
): { x: number; y: number; z: number; w: number } {
  const sy = Math.sin(yaw / 2),
    cy = Math.cos(yaw / 2);
  const sx = Math.sin(pitch / 2),
    cx = Math.cos(pitch / 2);
  return { x: cy * sx, y: sy * cx, z: -sy * sx, w: cy * cx };
}

export const WALL_HEIGHT = 1.4;
export const WALL_THICKNESS = 1.2;

/** Описание статической геометрии уровня — общее для физики и рендера. */
export function levelGeometry(track: BuiltTrack): LevelGeometry {
  const def = track.def;
  const boxes: LevelBox[] = [];
  const half = def.groundSize / 2;
  // На серпантине земля глубоко внизу: кто вылетел за отбойник — сбрасывается
  const groundY = track.elevated ? track.minY - 30 : 0;
  boxes.push({ kind: 'ground', x: 0, y: groundY - 0.5, z: 0, hx: half, hy: 0.5, hz: half, yaw: 0 });

  if (def.walls) {
    const S = track.samples;
    const N = S.length;
    const count = def.closed ? N : N - 1;
    for (const side of [-1, 1]) {
      // Пропускаем шаг через один — сегменты по ~4 м, меньше коллайдеров
      for (let i = 0; i < count; i += 2) {
        const a = S[i]!;
        const b = S[(i + 2) % N] ?? S[N - 1]!;
        const offA = side * (a.width / 2 + def.wallOffset + WALL_THICKNESS / 2);
        const offB = side * (b.width / 2 + def.wallOffset + WALL_THICKNESS / 2);
        const ax = a.x - a.tz * offA,
          az = a.z + a.tx * offA;
        const bx = b.x - b.tz * offB,
          bz = b.z + b.tx * offB;
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.01) continue;
        const dy = b.y - a.y;
        boxes.push({
          kind: 'wall',
          x: (ax + bx) / 2,
          y: (a.y + b.y) / 2 + WALL_HEIGHT / 2,
          z: (az + bz) / 2,
          hx: WALL_THICKNESS / 2,
          hy: WALL_HEIGHT / 2,
          hz: Math.hypot(len, dy) / 2 + 0.35,
          yaw: Math.atan2(bx - ax, bz - az),
          pitch: -Math.atan2(dy, len),
        });
      }
    }
  }

  const wedges: LevelWedge[] = [];
  for (const r of def.ramps) {
    const sm = sampleAt(track, r.s);
    const fx = sm.tx,
      fz = sm.tz;
    const rx = -sm.tz,
      rz = sm.tx;
    const cx = sm.x + rx * r.offset,
      cz = sm.z + rz * r.offset;
    const v: number[] = [];
    const hw = r.width / 2;
    for (const side of [-1, 1]) {
      const px = cx + rx * hw * side,
        pz = cz + rz * hw * side;
      // начало (на земле), конец низ, конец верх
      v.push(px - (fx * r.length) / 2, 0, pz - (fz * r.length) / 2);
      v.push(px + (fx * r.length) / 2, 0, pz + (fz * r.length) / 2);
      v.push(px + (fx * r.length) / 2, r.height, pz + (fz * r.length) / 2);
    }
    wedges.push({ kind: 'ramp', vertices: v });
  }
  let road: LevelGeometry['road'];
  if (track.elevated) {
    const S = track.samples;
    const n = S.length + (def.closed ? 1 : 0);
    const vertices: number[] = [];
    const indices: number[] = [];
    // Полотно шире проезжей части на отступ до отбойника — колёса не проваливаются у края
    for (let k = 0; k < n; k++) {
      const sm = S[k % S.length]!;
      const hw = sm.width / 2 + def.wallOffset + WALL_THICKNESS;
      vertices.push(
        sm.x + sm.tz * hw,
        sm.y,
        sm.z - sm.tx * hw,
        sm.x - sm.tz * hw,
        sm.y,
        sm.z + sm.tx * hw,
      );
      if (k > 0) {
        const i = (k - 1) * 2;
        indices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
      }
    }
    road = { vertices, indices };
  }
  return { boxes, wedges, road };
}
