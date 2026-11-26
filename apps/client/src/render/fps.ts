/** Счётчик FPS и времени кадра. */
export class FpsCounter {
  readonly el: HTMLDivElement;
  private frames = 0;
  private acc = 0;
  fps = 0;
  frameMs = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'fps';
    parent.appendChild(this.el);
  }

  tick(dt: number, extra = ''): void {
    this.frames++;
    this.acc += dt;
    this.frameMs = this.frameMs * 0.9 + dt * 1000 * 0.1;
    if (this.acc >= 0.5) {
      this.fps = Math.round(this.frames / this.acc);
      this.frames = 0;
      this.acc = 0;
      this.el.textContent = `${this.fps} fps · ${this.frameMs.toFixed(1)} ms ${extra}`;
    }
  }
}
