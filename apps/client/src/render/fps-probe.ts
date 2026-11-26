/**
 * Замер FPS в начале заезда (PLAN_V2 7.1б): первые 0,5 с пропускаем (догрузка блоков, шейдеры),
 * следующие 3 с считаем средний FPS. Ниже порога — надо переходить на лёгкую графику.
 */
export class FpsProbe {
  private t = 0;
  private frames = 0;
  private measured = 0;
  done = false;
  fps = 0;

  constructor(
    readonly threshold = 40,
    readonly warmup = 0.5,
    readonly window = 3,
  ) {}

  /** dt кадра в секундах. Возвращает true один раз — когда замер закончен и FPS ниже порога. */
  tick(dt: number): boolean {
    if (this.done) return false;
    this.t += dt;
    if (this.t <= this.warmup) return false;
    this.frames++;
    this.measured += dt;
    if (this.measured < this.window) return false;
    this.done = true;
    this.fps = this.frames / this.measured;
    return this.fps < this.threshold;
  }
}
