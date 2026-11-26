/**
 * car-validate: проверка glTF-машин по ART_BRIEF.
 *
 *   pnpm art:validate                       # все машины в apps/client/public/cars и art/export/cars
 *   pnpm art:validate -- path/to/base.glb   # конкретные файлы
 *
 * Код выхода 1 — есть ошибки.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateGlb, validateWheelGlb } from './validate';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function defaults(): string[] {
  const out: string[] = [];
  for (const dir of ['apps/client/public/cars', 'art/export/cars']) {
    const abs = join(root, dir);
    if (!existsSync(abs)) continue;
    for (const id of readdirSync(abs)) {
      for (const f of ['base.glb', 'base.min.glb']) {
        const p = join(abs, id, f);
        if (existsSync(p)) out.push(p);
      }
    }
  }
  for (const dir of ['apps/client/public/wheels', 'art/export/wheels']) {
    const abs = join(root, dir);
    if (existsSync(abs))
      for (const f of readdirSync(abs)) if (f.endsWith('.glb')) out.push(join(abs, f));
  }
  return out;
}

const files = process.argv.slice(2).filter((a) => a !== '--');
const list = files.length ? files.map((f) => resolve(f)) : defaults();
if (!list.length) {
  console.log('Нет моделей для проверки');
  process.exit(0);
}
let failed = 0;
for (const f of list) {
  const buf = new Uint8Array(readFileSync(f));
  const isWheel = f.split(sep).join('/').includes('/wheels/');
  const r = isWheel ? validateWheelGlb(buf) : validateGlb(buf);
  const s = r.stats;
  const ok = r.errors.length === 0;
  if (!ok) failed++;
  if (isWheel) {
    console.log(
      `${ok ? 'OK  ' : 'FAIL'} ${relative(root, f)} — колесо ${s.lod0}/${s.lod1}/${s.lod2} тр., тормоз ${s.wheels[0]}; ` +
        `Ø ${s.size[1]!.toFixed(3)} м` +
        (s.textures.length ? `; ${s.textures.join(', ')}` : ''),
    );
    for (const e of r.errors) console.log(`   ✗ ${e}`);
    for (const w of r.warnings) console.log(`   ! ${w}`);
    continue;
  }
  console.log(
    `${ok ? 'OK  ' : 'FAIL'} ${relative(root, f)} — LOD0 ${s.lod0}, LOD1 ${s.lod1}, LOD2 ${s.lod2} тр.; ` +
      `${s.size.map((v) => v.toFixed(2)).join('×')} м; колёса ${s.wheels.join('/')}` +
      (s.textures.length ? `; текстуры: ${s.textures.join(', ')}` : ''),
  );
  for (const e of r.errors) console.log(`   ✗ ${e}`);
  for (const w of r.warnings) console.log(`   ! ${w}`);
}
process.exit(failed ? 1 : 0);
