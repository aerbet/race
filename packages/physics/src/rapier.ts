import RAPIER from '@dimforge/rapier3d-compat';

export type Rapier = typeof RAPIER;
let ready: Promise<Rapier> | null = null;

/** Инициализация WASM Rapier (один раз). */
export function initPhysics(): Promise<Rapier> {
  if (!ready) ready = RAPIER.init().then(() => RAPIER);
  return ready;
}
export { RAPIER };
