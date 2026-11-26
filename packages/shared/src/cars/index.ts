import coupe from './era2000_coupe.json';
import hatch from './era2026_hatch.json';
import kaizen from './kaizen_rx34.json';
import { parseCarConfig, type CarConfig } from './schema';

export * from './schema';

export const CARS: Record<string, CarConfig> = {
  era2000_coupe: parseCarConfig(coupe, 'era2000_coupe.json'),
  era2026_hatch: parseCarConfig(hatch, 'era2026_hatch.json'),
  kaizen_rx34: parseCarConfig(kaizen, 'kaizen_rx34.json'),
};

export const CAR_IDS = Object.keys(CARS);

export function getCar(id: string): CarConfig {
  const c = CARS[id];
  if (!c) throw new Error(`Неизвестная машина: ${id}`);
  return c;
}

/** Глубокая копия — для тюнинга «на лету» без порчи исходника. */
export function cloneCar(c: CarConfig): CarConfig {
  return structuredClone(c);
}
