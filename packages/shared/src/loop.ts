import { FIXED_DT, MAX_STEPS_PER_FRAME } from './constants';

/**
 * Фиксированный шаг физики с аккумулятором времени.
 * advance(realDt) вызывается из кадра рендера; step() — ровно 60 раз в секунду
 * модельного времени, независимо от частоты кадров. alpha — доля до следующего шага
 * для интерполяции рендера.
 */
export class FixedStepLoop {
  private acc = 0;
  steps = 0;
  alpha = 0;
  paused = false;

  constructor(
    private readonly step: (dt: number, stepIndex: number) => void,
    readonly dt = FIXED_DT,
    private readonly maxSteps = MAX_STEPS_PER_FRAME,
  ) {}

  /** Возвращает число выполненных шагов за этот кадр. */
  advance(realDt: number): number {
    if (this.paused) return 0;
    // Защита от больших провалов (вкладка была скрыта и т.п.)
    this.acc += Math.min(Math.max(realDt, 0), this.dt * this.maxSteps);
    let n = 0;
    // Небольшой эпсилон, чтобы ошибки плавающей точки не теряли шаг
    while (this.acc + 1e-9 >= this.dt && n < this.maxSteps) {
      this.step(this.dt, this.steps);
      this.steps++;
      this.acc -= this.dt;
      n++;
    }
    if (this.acc < 0) this.acc = 0;
    this.alpha = this.acc / this.dt;
    return n;
  }

  reset(): void {
    this.acc = 0;
    this.steps = 0;
    this.alpha = 0;
  }
}
