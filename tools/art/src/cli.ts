/**
 * Конвейер 3D (docs/BLENDER_PLAN.md): Блендер в фоне → glb → сжатие → валидатор → игра.
 *
 *   pnpm art:car <id> [--publish] [--no-render]   # собрать машину по art/specs/cars/<id>.json
 *   pnpm art:car:all                              # все машины
 *   pnpm art:render <id>                          # только рендеры (из art/source/cars/<id>.blend)
 *   pnpm art:wheels | pnpm art:city <kit>         # этапы B1 / B5
 *
 * --publish копирует сжатую модель в apps/client/public/cars/<id>/base.glb —
 * только после утверждения владельцем (кроме тестовой модели).
 * Путь к Блендеру — переменная BLENDER_BIN; без неё ищем в стандартных папках.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateGlb } from '../../car-validate/src/validate';
import { findBlender } from './blender';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const argv = process.argv.slice(2).filter((a) => a !== '--');
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const [cmd, ...rest] = argv.filter((a) => !a.startsWith('--'));

function run(bin: string, args: string[], label: string): void {
  console.log(`▶ ${label}`);
  const r = spawnSync(bin, args, { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`✗ ${label}: код ${r.status ?? r.error?.message}`);
    process.exit(1);
  }
}

function blender(script: string, args: string[], label: string): void {
  const bin = findBlender();
  if (!bin) {
    console.error(
      'Блендер не найден. Задай BLENDER_BIN (BLENDER_PLAN, раздел 1), например:\n' +
        '  setx BLENDER_BIN "C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe"',
    );
    process.exit(1);
  }
  run(bin, ['-b', '--factory-startup', '-P', join(root, script), '--', ...args], label);
}

function gltfTransform(args: string[], label: string): void {
  run(
    process.execPath,
    [join(root, 'node_modules/@gltf-transform/cli/bin/cli.js'), ...args],
    label,
  );
}

function hasTool(name: string): boolean {
  const r = spawnSync(name, ['--version'], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
  return r.status === 0;
}

function car(id: string): void {
  const spec = join(root, 'art/specs/cars', `${id}.json`);
  if (!existsSync(spec)) {
    console.error(`Нет спецификации ${spec}`);
    process.exit(1);
  }
  const extra = flags.has('--no-render') ? ['--no-render'] : [];
  blender('art/scripts/cars/build_car.py', ['--spec', spec, ...extra], `Блендер: ${id}`);

  const dir = join(root, 'art/export/cars', id);
  const raw = join(dir, 'base.glb');
  const min = join(dir, 'base.min.glb');
  gltfTransform(['meshopt', raw, min, '--level', 'medium'], 'Сжатие геометрии (meshopt)');
  const json = JSON.parse(readGlbJson(min)) as { images?: unknown[] };
  if (json.images?.length) {
    if (hasTool('toktx')) {
      gltfTransform(
        ['etc1s', min, min, '--slots', '{baseColorTexture,emissiveTexture,occlusionTexture}'],
        'KTX2 ETC1S (цвет)',
      );
      gltfTransform(['uastc', min, min, '--slots', 'normalTexture'], 'KTX2 UASTC (нормали)');
    } else {
      console.warn('! toktx не найден — текстуры не сжаты в KTX2 (BLENDER_PLAN, раздел 1, п. 5)');
    }
  }
  const kb = (f: string) => `${(statSync(f).size / 1024).toFixed(0)} КБ`;
  console.log(`  ${raw}: ${kb(raw)} → ${kb(min)}`);

  const r = validateGlb(new Uint8Array(readFileSync(min)));
  for (const e of r.errors) console.log(`  ✗ ${e}`);
  for (const w of r.warnings) console.log(`  ! ${w}`);
  console.log(`  LOD0 ${r.stats.lod0} / LOD1 ${r.stats.lod1} / LOD2 ${r.stats.lod2} треугольников`);
  if (r.errors.length) {
    console.error(`✗ Валидатор: ${r.errors.length} ошибок`);
    process.exit(1);
  }
  if (flags.has('--publish')) {
    const out = join(root, 'apps/client/public/cars', id);
    mkdirSync(out, { recursive: true });
    copyFileSync(min, join(out, 'base.glb'));
    console.log(`✓ В игре: apps/client/public/cars/${id}/base.glb`);
  }
  console.log(`✓ ${id}: рендеры — art/renders/${id}/sheet.png`);
}

function readGlbJson(file: string): string {
  const b = readFileSync(file);
  const len = b.readUInt32LE(12);
  return b.subarray(20, 20 + len).toString('utf8');
}

switch (cmd) {
  case 'car':
    if (!rest[0]) {
      console.error('Укажи id машины: pnpm art:car <id>');
      process.exit(1);
    }
    car(rest[0]);
    break;
  case 'car:all':
    for (const f of readdirSync(join(root, 'art/specs/cars')).filter((f) => f.endsWith('.json')))
      car(f.replace(/\.json$/, ''));
    break;
  case 'render': {
    const id = rest[0];
    if (!id) process.exit(1);
    blender(
      'art/scripts/cars/build_car.py',
      ['--spec', join(root, 'art/specs/cars', `${id}.json`), '--render-only'],
      `Рендеры: ${id}`,
    );
    break;
  }
  case 'wheels':
    console.error('Колёса — этап B1, генератор ещё не написан (art/scripts/cars/wheels.py)');
    process.exit(1);
    break;
  case 'city':
    console.error('Город — этап B5, генератор ещё не написан (art/scripts/city/)');
    process.exit(1);
    break;
  case 'blender':
    console.log(findBlender() ?? 'Блендер не найден');
    break;
  default:
    console.error('Команды: car <id> | car:all | render <id> | wheels | city <kit> | blender');
    process.exit(1);
}
