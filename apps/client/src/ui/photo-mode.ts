/**
 * Фоторежим (9.5): игра на паузе, HUD спрятан, камера свободно летает вокруг машины
 * (тянуть — вращать, колесо или кнопки — ближе/дальше). «Снимок» сохраняет PNG с подписью,
 * «Поделиться в Telegram» — системное меню «Поделиться» с картинкой (телефон) или ссылка t.me.
 */
import * as THREE from 'three';
import { BRAND, t } from '@sr/shared';

export interface PhotoTarget {
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  /** Отрисовать кадр (вызов сразу перед чтением холста). */
  render: () => void;
  /** Где машина игрока. */
  target: () => THREE.Vector3;
  /** Направление «вперёд» машины — первый ракурс спереди-сбоку. */
  heading: () => number;
}

/** Ссылка «Поделиться в Telegram» (без картинки — её t.me/share не принимает). */
export function telegramShareUrl(url: string, text: string): string {
  return `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
}

/** Ракурс камеры по сферическим координатам вокруг цели — чистая функция (тест). */
export function orbit(
  target: { x: number; y: number; z: number },
  yaw: number,
  pitch: number,
  dist: number,
): { x: number; y: number; z: number } {
  const p = Math.max(0.03, Math.min(1.35, pitch));
  return {
    x: target.x + Math.sin(yaw) * Math.cos(p) * dist,
    y: target.y + Math.sin(p) * dist,
    z: target.z + Math.cos(yaw) * Math.cos(p) * dist,
  };
}

export class PhotoMode {
  private el: HTMLDivElement;
  private yaw: number;
  private pitch = 0.18;
  private dist = 6.5;
  private drag: { x: number; y: number } | null = null;
  private raf = 0;
  private fov: number;
  onExit: () => void = () => {};

  constructor(
    private root: HTMLElement,
    private s: PhotoTarget,
  ) {
    this.yaw = s.heading() + Math.PI * 0.75;
    this.fov = s.camera.fov;
    s.camera.fov = 45;
    s.camera.updateProjectionMatrix();
    document.body.classList.add('photo-mode');
    this.el = document.createElement('div');
    this.el.className = 'photo-ui';
    this.el.innerHTML = `<p class="hint">${t('photo.hint')}</p>
      <div class="btnrow">
        <button class="btn" data-k="out">−</button>
        <button class="btn" data-k="in">+</button>
        <button class="btn primary" data-k="shot">${t('photo.shot')}</button>
        <button class="btn" data-k="share">${t('photo.share')}</button>
        <button class="btn" data-k="exit">${t('photo.exit')}</button>
      </div>
      <p class="sub" data-k="msg"></p>`;
    root.appendChild(this.el);
    const q = (k: string) => this.el.querySelector(`[data-k="${k}"]`) as HTMLElement;
    q('in').onclick = () => this.zoom(-1);
    q('out').onclick = () => this.zoom(1);
    q('shot').onclick = () => void this.save();
    q('share').onclick = () => void this.share();
    q('exit').onclick = () => this.exit();
    const c = s.canvas;
    c.addEventListener('pointerdown', this.down);
    window.addEventListener('pointermove', this.move);
    window.addEventListener('pointerup', this.up);
    c.addEventListener('wheel', this.wheel, { passive: true });
    window.addEventListener('keydown', this.key);
    this.loop();
  }

  private down = (e: PointerEvent) => {
    this.drag = { x: e.clientX, y: e.clientY };
  };
  private move = (e: PointerEvent) => {
    if (!this.drag) return;
    this.yaw -= (e.clientX - this.drag.x) * 0.008;
    this.pitch += (e.clientY - this.drag.y) * 0.006;
    this.pitch = Math.max(0.03, Math.min(1.35, this.pitch));
    this.drag = { x: e.clientX, y: e.clientY };
  };
  private up = () => {
    this.drag = null;
  };
  private wheel = (e: WheelEvent) => this.zoom(Math.sign(e.deltaY));
  private key = (e: KeyboardEvent) => {
    if (e.code === 'Escape') {
      e.stopPropagation();
      this.exit();
    }
  };

  private zoom(dir: number): void {
    this.dist = Math.max(2.6, Math.min(18, this.dist * (dir > 0 ? 1.12 : 1 / 1.12)));
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const tg = this.s
      .target()
      .clone()
      .add(new THREE.Vector3(0, 0.6, 0));
    const p = orbit(tg, this.yaw, this.pitch, this.dist);
    this.s.camera.position.set(p.x, p.y, p.z);
    this.s.camera.lookAt(tg);
  };

  /** Кадр без интерфейса + подпись игры в углу. */
  private async snapshot(): Promise<Blob | null> {
    this.s.render();
    const src = this.s.canvas;
    const out = document.createElement('canvas');
    out.width = src.width;
    out.height = src.height;
    const g = out.getContext('2d')!;
    g.drawImage(src, 0, 0);
    const k = out.height / 720;
    g.font = `italic 900 ${Math.round(28 * k)}px Inter, system-ui, sans-serif`;
    g.textAlign = 'right';
    g.textBaseline = 'bottom';
    g.shadowColor = 'rgba(0,0,0,0.6)';
    g.shadowBlur = 8 * k;
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.fillText(BRAND.title, out.width - 20 * k, out.height - 16 * k);
    return new Promise((res) => out.toBlob((b) => res(b), 'image/png'));
  }

  private fileName(): string {
    return `${BRAND.id}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
  }

  private download(blob: Blob): void {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = this.fileName();
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  private say(text: string): void {
    (this.el.querySelector('[data-k="msg"]') as HTMLElement).textContent = text;
  }

  private async save(): Promise<void> {
    const b = await this.snapshot();
    if (!b) return this.say(t('photo.failed'));
    this.download(b);
    this.say(t('photo.saved'));
  }

  /**
   * Телефон: системное «Поделиться» с картинкой — там есть Telegram.
   * Компьютер: картинка скачивается, открывается t.me/share со ссылкой на игру.
   */
  private async share(): Promise<void> {
    const b = await this.snapshot();
    if (!b) return this.say(t('photo.failed'));
    const text = t('photo.shareText', { brand: BRAND.title });
    const url = location.origin + location.pathname;
    const file = new File([b], this.fileName(), { type: 'image/png' });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({ files: [file], text: `${text} ${url}` });
        return;
      } catch {
        /* отмена — ничего не делаем */
        return;
      }
    }
    this.download(b);
    const link = telegramShareUrl(url, text);
    const tg = (
      window as unknown as { Telegram?: { WebApp?: { openTelegramLink?: (u: string) => void } } }
    ).Telegram?.WebApp;
    if (tg?.openTelegramLink) tg.openTelegramLink(link);
    else window.open(link, '_blank');
    this.say(t('photo.attach'));
  }

  exit(): void {
    cancelAnimationFrame(this.raf);
    const c = this.s.canvas;
    c.removeEventListener('pointerdown', this.down);
    window.removeEventListener('pointermove', this.move);
    window.removeEventListener('pointerup', this.up);
    c.removeEventListener('wheel', this.wheel);
    window.removeEventListener('keydown', this.key);
    this.s.camera.fov = this.fov;
    this.s.camera.updateProjectionMatrix();
    document.body.classList.remove('photo-mode');
    this.el.remove();
    this.onExit();
  }
}
