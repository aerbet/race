import { parseTrackDef } from './schema';

/**
 * Горный перевал (по мотивам японских серпантинов, вымышленный): спринт в гору,
 * 6 «плеч» со шпильками, подъём ~140 м, узкая дорога с отбойниками.
 */
function touge(): [number, number, number, number][] {
  const pts: [number, number, number, number][] = [];
  const legs = 6;
  const span = 170; // полуширина «плеча»
  const dz = 90; // шаг по склону между плечами
  const R = dz / 2; // радиус шпильки
  const rise = 23; // подъём за плечо со шпилькой
  let z = 420;
  let y = 0;
  // Разгон перед первым плечом
  pts.push([span + 70, z, 11, 0], [span + 25, z, 11, 0]);
  for (let k = 0; k < legs; k++) {
    const dir = k % 2 === 0 ? -1 : 1; // направление плеча по X
    for (let t = 0; t <= 4; t++) {
      const x = -dir * span + (t / 4) * 2 * dir * span;
      const wig = t > 0 && t < 4 ? Math.sin(t * 1.7 + k) * 6 : 0;
      pts.push([x, z + wig, 10, y + (t / 4) * rise * 0.8]);
    }
    if (k === legs - 1) break;
    // Шпилька: полукруг на краю плеча
    const cx = dir * span;
    const cz = z - R;
    for (let a = 1; a < 6; a++) {
      const ang = (a / 6) * Math.PI;
      pts.push([
        cx + dir * Math.sin(ang) * R,
        cz + Math.cos(ang) * R,
        13,
        y + rise * (0.8 + 0.2 * (a / 6)),
      ]);
    }
    z -= dz;
    y += rise;
  }
  // Финишная прямая на перевале
  const lastDir = (legs - 1) % 2 === 0 ? -1 : 1;
  pts.push(
    [lastDir * (span + 40), z, 11, y + rise * 0.85],
    [lastDir * (span + 110), z, 11, y + rise * 0.9],
  );
  return pts;
}

export const TOUGE_TRACK = parseTrackDef({
  id: 'jp_touge',
  name: 'Горный перевал',
  type: 'sprint',
  laps: 1,
  closed: false,
  defaultWidth: 10,
  checkpointSpacing: 110,
  walls: true,
  wallOffset: 1,
  groundSize: 1000,
  startS: 50,
  points: touge(),
  ramps: [],
});
