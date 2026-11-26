/**
 * Конвейер 3D (docs/BLENDER_PLAN.md): Блендер в фоне → glb → сжатие → валидатор → игра.
 *
 *   pnpm art:car <id> [--publish] [--no-render]   # собрать машину по art/specs/cars/<id>.json
 *   pnpm art:car:all                              # все машины
 *   pnpm art:silhouette <id>                      # схема силуэта (шаг 1 конвейера машины)
 *   pnpm art:render <id>                          # только рендеры (из art/source/cars/<id>.blend)
 *   pnpm art:wheels [<id>] [--publish]            # диски (art/specs/wheels), этап B1
 *   pnpm track:export <id|all>                     # сплайн трассы → art/specs/track/<id>.json (B7)
 *   pnpm art:city <kit> [--no-render]             # набор зданий: атлас, модули, рендер улицы (B5)
 *
 * --publish копирует сжатую модель в apps/client/public/cars/<id>/base.glb —
 * только после утверждения владельцем (кроме тестовой модели).
 * Путь к Блендеру — переменная BLENDER_BIN; без неё ищем в стандартных папках.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateGlb, validateKitGlb, validateWheelGlb } from '../../car-validate/src/validate';
import { findBlender } from './blender';
import { writeExports } from './track-export';

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
  // Кузовные киты (BLENDER_PLAN 5.4): kit_<kit>.glb рядом с базой
  const kits = readdirSync(dir).filter((f) => /^kit_[a-z0-9_]+\.glb$/.test(f));
  const kitMin: string[] = [];
  for (const f of kits) {
    const kraw = join(dir, f);
    const kmin = join(dir, f.replace(/\.glb$/, '.min.glb'));
    gltfTransform(['meshopt', kraw, kmin, '--level', 'medium'], `Сжатие ${f}`);
    const kr = validateKitGlb(new Uint8Array(readFileSync(kmin)));
    console.log(
      `  ${kr.errors.length ? '✗' : '✓'} ${f}: ${kr.stats.lod0}/${kr.stats.lod1}/${kr.stats.lod2} тр., ${kb(kmin)}`,
    );
    for (const e of kr.errors) console.log(`    ✗ ${e}`);
    if (kr.errors.length) {
      console.error(`✗ Валидатор: кит ${f}`);
      process.exit(1);
    }
    kitMin.push(kmin);
  }
  if (flags.has('--publish')) {
    const out = join(root, 'apps/client/public/cars', id);
    mkdirSync(out, { recursive: true });
    copyFileSync(min, join(out, 'base.glb'));
    for (const k of kitMin) copyFileSync(k, join(out, basename(k).replace('.min', '')));
    console.log(
      `✓ В игре: apps/client/public/cars/${id}/base.glb${kitMin.length ? ` + ${kitMin.length} кита` : ''}`,
    );
  }
  console.log(`✓ ${id}: рендеры — art/renders/${id}/sheet.png`);
}

/** Колёса: все диски × диаметры (art/specs/wheels/w*.json), сжатие, валидатор. */
function wheels(only?: string): void {
  const args = [
    ...(only ? ['--only', only] : []),
    ...(flags.has('--no-render') ? ['--no-render'] : []),
  ];
  blender('art/scripts/cars/wheels.py', args, `Блендер: колёса${only ? ` ${only}` : ''}`);
  const dir = join(root, 'art/export/wheels');
  const files = readdirSync(dir).filter(
    (f) => f.endsWith('.glb') && !f.endsWith('.min.glb') && (!only || f.startsWith(`${only}_`)),
  );
  const ktx = hasTool('toktx');
  if (!ktx)
    console.warn(
      '! toktx не найден — карта нормалей шины остаётся PNG (BLENDER_PLAN, раздел 1, п. 5)',
    );
  let failed = 0;
  for (const f of files) {
    const raw = join(dir, f);
    const min = join(dir, f.replace(/\.glb$/, '.min.glb'));
    gltfTransform(['meshopt', raw, min, '--level', 'medium'], `Сжатие ${f}`);
    if (ktx) gltfTransform(['uastc', min, min, '--slots', 'normalTexture'], `KTX2 ${f}`);
    const r = validateWheelGlb(new Uint8Array(readFileSync(min)));
    const kb = (statSync(min).size / 1024).toFixed(0);
    console.log(
      `  ${r.errors.length ? '✗' : '✓'} ${f}: ${r.stats.lod0}/${r.stats.lod1}/${r.stats.lod2} тр., ${kb} КБ`,
    );
    for (const e of r.errors) console.log(`    ✗ ${e}`);
    for (const w of r.warnings) console.log(`    ! ${w}`);
    if (r.errors.length) failed++;
    else if (flags.has('--publish')) {
      const out = join(root, 'apps/client/public/wheels');
      mkdirSync(out, { recursive: true });
      copyFileSync(min, join(out, f));
    }
  }
  if (failed) {
    console.error(`✗ Валидатор: ${failed} колёс с ошибками`);
    process.exit(1);
  }
  console.log('✓ Колёса: рендеры — art/renders/wheels/sheet.png');
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
    wheels(rest[0]);
    break;
  case 'silhouette': {
    const id = rest[0];
    if (!id) {
      console.error('Укажи id машины: pnpm art:silhouette <id>');
      process.exit(1);
    }
    blender(
      'art/scripts/cars/silhouette.py',
      ['--spec', join(root, 'art/specs/cars', `${id}.json`)],
      `Силуэт: ${id}`,
    );
    console.log(`✓ art/renders/${id}/silhouette.png и silhouette.svg`);
    break;
  }
  case 'city': {
    // Набор зданий (BLENDER_PLAN 6): атлас + модули → meshopt → apps/client/public/cities/kits/<kit>
    const kit = rest[0] ?? 'moscow';
    blender(
      flags.has('--no-render')
        ? 'art/scripts/city/build_modules.py'
        : 'art/scripts/city/render_street.py',
      ['--kit', kit],
      `Блендер: набор зданий ${kit}`,
    );
    const dir = join(root, 'art/export/city', kit);
    const min = join(dir, 'modules.min.glb');
    gltfTransform(
      ['meshopt', join(dir, 'modules.glb'), min, '--level', 'medium'],
      'Сжатие модулей',
    );
    const out = join(root, 'apps/client/public/cities/kits', kit);
    mkdirSync(out, { recursive: true });
    copyFileSync(min, join(out, 'modules.glb'));
    copyFileSync(join(dir, 'modules.json'), join(out, 'modules.json'));
    const lmin = join(dir, 'landmarks.min.glb');
    gltfTransform(
      ['meshopt', join(dir, 'landmarks.glb'), lmin, '--level', 'medium'],
      'Сжатие ориентиров',
    );
    copyFileSync(lmin, join(out, 'landmarks.glb'));
    console.log(
      `✓ ${kit}: ${(statSync(min).size / 1024).toFixed(0)} КБ → apps/client/public/cities/kits/${kit}`,
    );
    if (!flags.has('--no-render'))
      console.log(`✓ рендер: art/renders/city_${kit}/street_night.png`);
    break;
  }
  case 'track:export': {
    const files = writeExports(root, rest[0] ?? 'all');
    if (!files.length) {
      console.error(`Нет трассы ${rest[0]}`);
      process.exit(1);
    }
    for (const f of files) console.log(`✓ ${f}`);
    break;
  }
  case 'track': {
    // pnpm art:track maps — карты трасс для меню (7.3); terrain <id> — рельеф (7.2); dressing — оформление (7.1)
    const sub = rest[0] ?? 'maps';
    writeExports(root, 'all');
    const script = { maps: 'map.py', terrain: 'terrain.py', dressing: 'dressing.py' }[sub];
    if (!script) {
      console.error('pnpm art:track maps | terrain <id> | dressing');
      process.exit(1);
    }
    blender(`art/scripts/track/${script}`, rest.slice(1), `Блендер: трассы — ${sub}`);
    if (sub === 'dressing' || sub === 'terrain') {
      // Сжатие и публикация: apps/client/public/tracks/
      const dir = join(root, 'art/export/tracks');
      const out = join(root, 'apps/client/public/tracks');
      mkdirSync(out, { recursive: true });
      for (const f of readdirSync(dir).filter(
        (f) => f.endsWith('.glb') && !f.endsWith('.min.glb'),
      )) {
        const min = join(dir, f.replace(/\.glb$/, '.min.glb'));
        gltfTransform(['meshopt', join(dir, f), min, '--level', 'medium'], `Сжатие ${f}`);
        copyFileSync(min, join(out, f));
      }
      for (const f of readdirSync(dir).filter((f) => f.endsWith('.json')))
        copyFileSync(join(dir, f), join(out, f));
      console.log('✓ apps/client/public/tracks');
    }
    break;
  }
  case 'blender':
    console.log(findBlender() ?? 'Блендер не найден');
    break;
  default:
    console.error('Команды: car <id> | car:all | render <id> | wheels | city <kit> | blender');
    process.exit(1);
}
