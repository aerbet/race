/**
 * Симулятор плохой сети для dev-режима. WebSocket работает поверх TCP, поэтому
 * «потеря» пакета проявляется как задержка на повторную передачу с блокировкой
 * очереди (head-of-line), а не как исчезновение сообщения.
 */
export interface NetConditions {
  /** Задержка в одну сторону, мс. */
  latency: number;
  /** Разброс задержки ±, мс. */
  jitter: number;
  /** Вероятность потери пакета, 0..1. */
  loss: number;
}

export const GOOD_NETWORK: NetConditions = { latency: 0, jitter: 0, loss: 0 };

export class DelayedChannel<T> {
  private lastDelivery = 0;
  private rnd: () => number;

  constructor(
    public cond: NetConditions,
    private readonly deliver: (msg: T) => void,
    private readonly now: () => number = () => performance.now(),
    private readonly schedule: (fn: () => void, ms: number) => void = (fn, ms) =>
      void setTimeout(fn, ms),
    seed = 1,
  ) {
    let s = seed >>> 0 || 1;
    this.rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  }

  get active(): boolean {
    return this.cond.latency > 0 || this.cond.jitter > 0 || this.cond.loss > 0;
  }

  send(msg: T): void {
    if (!this.active) {
      this.deliver(msg);
      return;
    }
    const t = this.now();
    let delay = this.cond.latency + (this.rnd() * 2 - 1) * this.cond.jitter;
    // Потеря → повторная передача: +RTO (≈ 2·RTT, минимум 200 мс)
    if (this.rnd() < this.cond.loss) delay += Math.max(200, this.cond.latency * 4);
    // TCP доставляет по порядку: не раньше предыдущего
    const at = Math.max(t + Math.max(0, delay), this.lastDelivery);
    this.lastDelivery = at;
    this.schedule(() => this.deliver(msg), at - t);
  }
}

/** Разбор условий из строки запроса: ?lag=150&jitter=30&loss=2 (loss в процентах). */
export function parseNetConditions(params: URLSearchParams): NetConditions {
  const n = (k: string) => Math.max(0, Number(params.get(k) ?? 0) || 0);
  return { latency: n('lag'), jitter: n('jitter'), loss: Math.min(1, n('loss') / 100) };
}
