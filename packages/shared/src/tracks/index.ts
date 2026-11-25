export * from './schema';
export * from './build';
export * from './polygon';
export * from './sprint';
export * from './touge';

import { buildTrack } from './build';
import { POLYGON_TRACK } from './polygon';
import { SPRINT_TRACK } from './sprint';
import { TOUGE_TRACK } from './touge';
import type { BuiltTrack, TrackDef } from './index';

export const TRACKS: Record<string, TrackDef> = {
  polygon: POLYGON_TRACK,
  night_sprint: SPRINT_TRACK,
  jp_touge: TOUGE_TRACK,
};

const cache = new Map<string, BuiltTrack>();
/** Зарегистрировать трассу во время работы (трассы городов приходят из city.json). */
export function registerTrack(def: TrackDef): void {
  TRACKS[def.id] = def;
  cache.delete(def.id);
}

export function getTrack(id: string): BuiltTrack {
  let t = cache.get(id);
  if (!t) {
    const def = TRACKS[id];
    if (!def) throw new Error(`Неизвестная трасса: ${id}`);
    t = buildTrack(def);
    cache.set(id, t);
  }
  return t;
}
