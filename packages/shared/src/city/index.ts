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
