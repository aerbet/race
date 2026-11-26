import coupe from './era2000_coupe.json';
import hatch from './era2026_hatch.json';
import kaizen from './kaizen_rx34.json';
import takumoraiden from './takumo_raiden.json';
import hoshivortex from './hoshi_vortex.json';
import tsurugirs4 from './tsurugi_rs4.json';
import vosskleiner from './voss_kleiner.json';
import brawler500 from './brawler_500.json';
import vossimperator from './voss_imperator.json';
import falknerheck from './falkner_heck.json';
import raijintempest from './raijin_tempest.json';
import hoshikaze from './hoshi_kaze.json';
import nimbuse1 from './nimbus_e1.json';
import ferrocuneo from './ferro_cuneo.json';
import { parseCarConfig, type CarConfig } from './schema';

export * from './schema';

export const CARS: Record<string, CarConfig> = {
  era2000_coupe: parseCarConfig(coupe, 'era2000_coupe.json'),
  era2026_hatch: parseCarConfig(hatch, 'era2026_hatch.json'),
  kaizen_rx34: parseCarConfig(kaizen, 'kaizen_rx34.json'),
  takumo_raiden: parseCarConfig(takumoraiden, 'takumo_raiden.json'),
  hoshi_vortex: parseCarConfig(hoshivortex, 'hoshi_vortex.json'),
  tsurugi_rs4: parseCarConfig(tsurugirs4, 'tsurugi_rs4.json'),
  voss_kleiner: parseCarConfig(vosskleiner, 'voss_kleiner.json'),
  brawler_500: parseCarConfig(brawler500, 'brawler_500.json'),
  voss_imperator: parseCarConfig(vossimperator, 'voss_imperator.json'),
  falkner_heck: parseCarConfig(falknerheck, 'falkner_heck.json'),
  raijin_tempest: parseCarConfig(raijintempest, 'raijin_tempest.json'),
  hoshi_kaze: parseCarConfig(hoshikaze, 'hoshi_kaze.json'),
  nimbus_e1: parseCarConfig(nimbuse1, 'nimbus_e1.json'),
  ferro_cuneo: parseCarConfig(ferrocuneo, 'ferro_cuneo.json'),
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
