import { describe, expect, it } from 'vitest';
import { resolveSecrets } from './server';

describe('секреты сервера (PLAN_V2 7.0.2)', () => {
  const good = { JWT_SECRET: 'x'.repeat(48), INTERNAL_KEY: 'k'.repeat(32) };

  it('в разработке работают значения по умолчанию', () => {
    expect(resolveSecrets({}).jwtSecret.length).toBeGreaterThanOrEqual(32);
  });

  it('в production без секретов или с dev-значениями — отказ запуска', () => {
    expect(() => resolveSecrets({ NODE_ENV: 'production' })).toThrow(/JWT_SECRET/);
    expect(() =>
      resolveSecrets({
        NODE_ENV: 'production',
        ...good,
        JWT_SECRET: 'dev-only-secret-change-me-0123456789abcdef',
      }),
    ).toThrow(/JWT_SECRET/);
    expect(() =>
      resolveSecrets({ NODE_ENV: 'production', ...good, INTERNAL_KEY: 'dev-internal-key' }),
    ).toThrow(/INTERNAL_KEY/);
    expect(() => resolveSecrets({ NODE_ENV: 'production', ...good, JWT_SECRET: 'short' })).toThrow(
      /JWT_SECRET/,
    );
  });

  it('в production с настоящими секретами — запуск', () => {
    expect(resolveSecrets({ NODE_ENV: 'production', ...good })).toEqual({
      jwtSecret: good.JWT_SECRET,
      internalKey: good.INTERNAL_KEY,
    });
  });
});
