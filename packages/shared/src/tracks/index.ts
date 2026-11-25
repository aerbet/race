export * from './schema';
export * from './build';
export * from './polygon';

import { buildTrack } from './build';
import { POLYGON_TRACK } from './polygon';
import type { BuiltTrack, TrackDef } from './index';

export const TRACKS: Record<string, TrackDef> = { polygon: POLYGON_TRACK };

const cache = new Map<string, BuiltTrack>();
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
