import type { App } from '../app';

/** Онлайн-режим (фаза 3) — заполняется в задачах 3.x. */
export function startOnline(app: App): void {
  alert('Онлайн-режим появится в фазе 3');
  app.menu();
}
