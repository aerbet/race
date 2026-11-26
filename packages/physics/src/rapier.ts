import type RAPIER_NS from '@dimforge/rapier3d-compat';

export type Rapier = typeof RAPIER_NS;
let ready: Promise<Rapier> | null = null;

/**
 * Инициализация WASM Rapier (один раз). Модуль грузится динамически: в клиенте это отдельный
 * файл, который качается в фоне, пока игрок в меню (PLAN_V2 7.0.5).
 */
export function initPhysics(): Promise<Rapier> {
  if (!ready)
    ready = import('@dimforge/rapier3d-compat').then(async (m) => {
      const RAPIER = m.default;
      await RAPIER.init();
      return RAPIER;
    });
  return ready;
}
