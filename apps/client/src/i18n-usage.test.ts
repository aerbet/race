import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DICTS } from '@sr/shared';

const ROOT = new URL('.', import.meta.url).pathname;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return files(p);
    return p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [];
  });
}

/** Код без комментариев (строки внутри кавычек не трогаем). */
function stripComments(src: string): string {
  return src.replace(
    /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (m, str: string | undefined) => str ?? '',
  );
}

describe('тексты клиента (7.3)', () => {
  const src = files(ROOT).map((f) => [f.slice(ROOT.length), readFileSync(f, 'utf8')] as const);

  it('в коде нет кириллицы вне комментариев — всё в i18n', () => {
    const bad = src.flatMap(([f, s]) =>
      stripComments(s)
        .split('\n')
        .filter((l) => /\p{Script=Cyrillic}/u.test(l))
        .map((l) => `${f}: ${l.trim()}`),
    );
    expect(bad).toEqual([]);
  });

  it('каждый t("…") с буквальным ключом есть в словаре', () => {
    const missing: string[] = [];
    for (const [f, s] of src)
      for (const m of s.matchAll(/\bt[n]?\(\s*'([a-zA-Z0-9_.]+)'/g)) {
        const k = m[1]!;
        const ok = k in DICTS.ru || `${k}.other` in DICTS.ru;
        if (!ok) missing.push(`${f}: ${k}`);
      }
    expect(missing).toEqual([]);
  });
});
