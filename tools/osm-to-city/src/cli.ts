/**
 * osm-to-city: OpenStreetMap → упрощённая дорожная сеть → блоки 256 м → glTF.
 *
 *   pnpm --filter osm-to-city build -- --synth --id moscow_synth --name "Москва (процедурная)" --kit moscow
 *   pnpm --filter osm-to-city build -- --bbox 55.751,37.596,55.769,37.628 --id moscow_center --name "Москва, центр" --kit moscow --auto-tracks mskc
 *   (скачанный район кэшируется в tools/osm-to-city/data/<id>.json; --style tokyo — неон)
 *   pnpm --filter osm-to-city build -- --in data/arbat.json --id moscow_arbat --name "Москва, Арбат"
 *
 * Результат: apps/client/public/cities/<id>/city.json + tiles/*.glb
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOverpass, type OverpassJson } from './osm';
import { buildCity } from './build';
import { autoTracks } from './routes';
import type { ModuleCatalog } from './modules';
import { synthDistrict, synthTracks } from './synth';
import { synthTokyo, tokyoTracks } from './synth-tokyo';
import type { TrackDef } from '@sr/shared';

const args = process.argv.slice(2);
const arg = (k: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const id = arg('id') ?? 'city';
const name = arg('name') ?? id;
const half = Number(arg('half') ?? 1000);

async function fetchOverpass(bbox: string): Promise<OverpassJson> {
  const [s, w, n, e] = bbox.split(',').map(Number);
  const q = `[out:json][timeout:120];(way["highway"](${s},${w},${n},${e});way["building"](${s},${w},${n},${e});relation["building"](${s},${w},${n},${e}););(._;>;);out body;`;
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: new URLSearchParams({ data: q }),
    headers: { 'user-agent': 'osm-to-city/0.1' },
  });
  if (!res.ok) throw new Error(`Overpass: HTTP ${res.status}`);
  return (await res.json()) as OverpassJson;
}

let data: OverpassJson;
let attribution: string | undefined;
let tracks: TrackDef[] = [];
let origin: { lat: number; lon: number } | undefined;
let style: 'moscow' | 'tokyo' = 'moscow';
if (arg('synth') === 'tokyo') {
  data = synthTokyo(Number(arg('seed') ?? 7), half * 0.76);
  attribution = 'Процедурный квартал (собственные данные)';
  tracks = tokyoTracks(half * 0.76);
  origin = { lat: 35.68, lon: 139.76 };
  style = 'tokyo';
} else if (args.includes('--synth')) {
  data = synthDistrict(Number(arg('seed') ?? 1), half * 0.9);
  attribution = 'Процедурный район (собственные данные)';
  tracks = synthTracks(half * 0.9);
  origin = { lat: 55.75, lon: 37.6 };
} else if (arg('bbox')) {
  // Кэш: повторная сборка не скачивает район заново (данные © участники OpenStreetMap, ODbL)
  const cached = join(root, 'tools/osm-to-city/data', `${id}.json`);
  data =
    existsSync(cached) && !args.includes('--refresh')
      ? (JSON.parse(readFileSync(cached, 'utf8')) as OverpassJson)
      : await fetchOverpass(arg('bbox')!);
  if (!existsSync(cached) || args.includes('--refresh'))
    writeFileSync(cached, JSON.stringify(data));
  if (arg('style') === 'tokyo') style = 'tokyo';
} else if (arg('in')) {
  data = JSON.parse(readFileSync(resolve(arg('in')!), 'utf8')) as OverpassJson;
} else {
  console.error('нужен --synth, --bbox s,w,n,e или --in файл.json');
  process.exit(1);
}

if (arg('tracks')) tracks = JSON.parse(readFileSync(resolve(arg('tracks')!), 'utf8')) as TrackDef[];
// Библиотека модулей зданий (pnpm art:city <kit> публикует её в apps/client/public/cities/kits/<kit>)
const kitId = arg('kit');
let modules: ModuleCatalog | undefined;
if (kitId) {
  const f = join(root, 'apps/client/public/cities/kits', kitId, 'modules.json');
  if (!existsSync(f)) {
    console.error(`нет ${f} — сначала pnpm art:city ${kitId}`);
    process.exit(1);
  }
  modules = JSON.parse(readFileSync(f, 'utf8')) as ModuleCatalog;
}
const parsed = parseOverpass(data, origin);
// Реальный район без готовых трасс: кольцо, спринт и дрифт по его улицам (10.2)
if (!tracks.length && arg('auto-tracks')) {
  tracks = autoTracks(parsed.roads, half, arg('auto-tracks')!);
  console.log(`трассы: ${tracks.map((t) => t.id).join(', ')}`);
}
const { city, files } = buildCity(parsed.roads, parsed.buildings, {
  id,
  name,
  half,
  origin: { lat: parsed.lat0, lon: parsed.lon0 },
  attribution,
  tracks,
  style,
  modules,
});
const out = join(root, 'apps/client/public/cities', id);
mkdirSync(join(out, 'tiles'), { recursive: true });
writeFileSync(join(out, 'city.json'), JSON.stringify(city));
let bytes = 0;
for (const [f, b] of files) {
  writeFileSync(join(out, f), b);
  bytes += b.length;
}
console.log(
  `${city.name}: дорог ${city.roads.length}, зданий ${parsed.buildings.length}, блоков ${city.tiles.length}, ` +
    `${(bytes / 1024 / 1024).toFixed(2)} МБ glb → ${out}`,
);
