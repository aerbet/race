/**
 * osm-to-city: OpenStreetMap → упрощённая дорожная сеть → блоки 256 м → glTF.
 *
 *   pnpm --filter osm-to-city build -- --synth --id moscow_synth --name "Москва (процедурная)"
 *   pnpm --filter osm-to-city build -- --bbox 55.743,37.581,55.761,37.613 --id moscow_arbat --name "Москва, Арбат"
 *   pnpm --filter osm-to-city build -- --in data/arbat.json --id moscow_arbat --name "Москва, Арбат"
 *
 * Результат: apps/client/public/cities/<id>/city.json + tiles/*.glb
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOverpass, type OverpassJson } from './osm';
import { buildCity } from './build';
import { synthDistrict } from './synth';

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
  const q = `[out:json][timeout:120];(way["highway"](${s},${w},${n},${e});way["building"](${s},${w},${n},${e}););(._;>;);out body;`;
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
if (args.includes('--synth')) {
  data = synthDistrict(Number(arg('seed') ?? 1), half * 0.9);
  attribution = 'Процедурный район (собственные данные)';
} else if (arg('bbox')) {
  data = await fetchOverpass(arg('bbox')!);
  writeFileSync(join(root, 'tools/osm-to-city/data', `${id}.json`), JSON.stringify(data));
} else if (arg('in')) {
  data = JSON.parse(readFileSync(resolve(arg('in')!), 'utf8')) as OverpassJson;
} else {
  console.error('нужен --synth, --bbox s,w,n,e или --in файл.json');
  process.exit(1);
}

const parsed = parseOverpass(data);
const { city, files } = buildCity(parsed.roads, parsed.buildings, {
  id,
  name,
  half,
  origin: { lat: parsed.lat0, lon: parsed.lon0 },
  attribution,
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
