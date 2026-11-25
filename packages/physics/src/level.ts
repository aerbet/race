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
}

export interface LevelWedge {
  kind: 'ramp';
  /** Вершины выпуклой оболочки в мировых координатах. */
  vertices: number[];
}

export interface LevelGeometry {
  boxes: LevelBox[];
  wedges: LevelWedge[];
}

export const WALL_HEIGHT = 1.4;
export const WALL_THICKNESS = 1.2;

/** Описание статической геометрии уровня — общее для физики и рендера. */
export function levelGeometry(track: BuiltTrack): LevelGeometry {
  const def = track.def;
  const boxes: LevelBox[] = [];
  const half = def.groundSize / 2;
  boxes.push({ kind: 'ground', x: 0, y: -0.5, z: 0, hx: half, hy: 0.5, hz: half, yaw: 0 });

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
        boxes.push({
          kind: 'wall',
          x: (ax + bx) / 2,
          y: WALL_HEIGHT / 2,
          z: (az + bz) / 2,
          hx: WALL_THICKNESS / 2,
          hy: WALL_HEIGHT / 2,
          hz: len / 2 + 0.35,
          yaw: Math.atan2(bx - ax, bz - az),
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
  return { boxes, wedges };
}
