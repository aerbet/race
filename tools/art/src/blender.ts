/** Поиск Блендера: BLENDER_BIN, затем стандартные папки установки (самая новая версия). */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Самая новая версия по номеру в имени папки («Blender 5.3» > «Blender 4.2»). */
export function newest(dirs: string[]): string | undefined {
  const ver = (d: string) => (/(\d+)\.(\d+)/.exec(d) ?? [0, 0, 0]).slice(1).map(Number);
  return [...dirs].sort((a, b) => {
    const [a1, a2] = ver(a);
    const [b1, b2] = ver(b);
    return b1! - a1! || b2! - a2!;
  })[0];
}

export function findBlender(env = process.env): string | null {
  if (env.BLENDER_BIN && existsSync(env.BLENDER_BIN)) return env.BLENDER_BIN;
  if (process.platform === 'darwin') {
    const mac = '/Applications/Blender.app/Contents/MacOS/Blender';
    return existsSync(mac) ? mac : null;
  }
  const bases =
    process.platform === 'win32'
      ? [
          'C:\\Program Files\\Blender Foundation',
          'D:\\Blender Foundation',
          'D:\\Program Files\\Blender Foundation',
        ]
      : ['/opt', '/usr/local'];
  for (const base of bases) {
    if (!existsSync(base)) continue;
    const dirs = readdirSync(base).filter((d) => /blender/i.test(d));
    const exe = process.platform === 'win32' ? 'blender.exe' : 'blender';
    const found = newest(dirs.filter((d) => existsSync(join(base, d, exe))));
    if (found) return join(base, found, exe);
  }
  return null;
}
