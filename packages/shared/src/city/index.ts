export * from './schema';
import brands from './brands.json';

/** Вымышленный бренд для щитов города (только свои названия, без реальных марок). */
export interface CityBrand {
  name: string;
  tag: string;
  bg: string;
  fg: string;
}
/** Бренды на щитах по набору модулей города (kit). */
export const CITY_BRANDS = brands as Record<string, CityBrand[]>;

/**
 * Настил мостов-ориентиров (art/scripts/city/landmarks.py): полудлина по X, полуширина,
 * низ и толщина плиты. Опоры уже есть в коллайдерах блока, настил добавляет физика.
 */
export const LANDMARK_DECKS: Record<string, { hx: number; hz: number; y0: number; h: number }> = {
  arch_bridge: { hx: 30, hz: 7, y0: 9, h: 1.4 },
  pylon_bridge: { hx: 34, hz: 8, y0: 10, h: 1.4 },
};

/** Коробки настилов: [cx, cz, hx, hz, yaw, h, y0] — как коллайдеры блока, но с высотой низа. */
export function deckColliders(
  landmarks: { id: string; x: number; z: number; yaw: number }[],
): [number, number, number, number, number, number, number][] {
  return landmarks.flatMap((l) => {
    const d = LANDMARK_DECKS[l.id];
    return d
      ? [
          [l.x, l.z, d.hx, d.hz, l.yaw, d.h, d.y0] as [
            number,
            number,
            number,
            number,
            number,
            number,
            number,
          ],
        ]
      : [];
  });
}
