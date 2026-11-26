import { t, formatTime, type BuiltTrack, type City, type DriftSnapshot } from '@sr/shared';

export interface HudState {
  speedKmh: number;
  gear: number;
  rpm: number;
  redline: number;
  nitro: number;
  nitroActive: boolean;
  position: number;
  total: number;
  lap: number;
  laps: number;
  time: number;
  lapTime: number;
  bestLap: number;
  ghostBest: number;
  countdown: number;
  racing: boolean;
  wrongWay: boolean;
  drift: DriftSnapshot | null;
  mode: string;
  manual: boolean;
}

export interface MinimapDot {
  x: number;
  z: number;
  color: string;
  player?: boolean;
}

/**
 * HUD в собственном стиле: «скошенные» панели, циан/маджента, моноширинные цифры.
 */
export class Hud {
  readonly el: HTMLDivElement;
  private speed!: HTMLElement;
  private gear!: HTMLElement;
  private rpmCanvas!: HTMLCanvasElement;
  private nitroFill!: HTMLElement;
  private pos!: HTMLElement;
  private lap!: HTMLElement;
  private time!: HTMLElement;
  private best!: HTMLElement;
  private center!: HTMLElement;
  private banner!: HTMLElement;
  private driftBox!: HTMLElement;
  private toast!: HTMLElement;
  private map!: HTMLCanvasElement;
  private mapBg: HTMLCanvasElement | null = null;
  private mapScale = 1;
  private mapOx = 0;
  private mapOz = 0;
  private toastTimer = 0;
  private lastCount = -1;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="hud-tl">
        <div class="hud-pos"><span class="v">-</span></div>
        <div class="hud-lap"></div>
        <div class="hud-time"></div>
        <div class="hud-best"></div>
      </div>
      <canvas class="hud-map" width="180" height="180"></canvas>
      <div class="hud-br">
        <canvas class="hud-rpm" width="220" height="120"></canvas>
        <div class="hud-speed"><span class="v">0</span><span class="u">${t('hud.kmh')}</span></div>
        <div class="hud-gear">N</div>
        <div class="hud-nitro"><div class="fill"></div><span>N₂O</span></div>
      </div>
      <div class="hud-center"></div>
      <div class="hud-banner hidden"></div>
      <div class="hud-drift hidden"></div>
      <div class="hud-toast hidden"></div>`;
    parent.appendChild(this.el);
    const q = <T extends HTMLElement>(s: string) => this.el.querySelector(s) as T;
    this.speed = q('.hud-speed .v');
    this.gear = q('.hud-gear');
    this.rpmCanvas = q('.hud-rpm');
    this.nitroFill = q('.hud-nitro .fill');
    this.pos = q('.hud-pos');
    this.lap = q('.hud-lap');
    this.time = q('.hud-time');
    this.best = q('.hud-best');
    this.center = q('.hud-center');
    this.banner = q('.hud-banner');
    this.driftBox = q('.hud-drift');
    this.toast = q('.hud-toast');
    this.map = q('.hud-map');
  }

  setTrack(track: BuiltTrack, city: City | null = null): void {
    const size = 180;
    const pad = 12;
    const bb = track.bounds;
    const w = bb.maxX - bb.minX;
    const h = bb.maxZ - bb.minZ;
    this.mapScale = (size - pad * 2) / Math.max(w, h);
    this.mapOx = pad + (size - pad * 2 - w * this.mapScale) / 2 - bb.minX * this.mapScale;
    this.mapOz = pad + (size - pad * 2 - h * this.mapScale) / 2 - bb.minZ * this.mapScale;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d')!;
    if (city) {
      // Улицы города — тонкими линиями под трассой
      g.strokeStyle = 'rgba(140,150,180,0.35)';
      g.lineCap = 'round';
      for (const r of city.roads) {
        g.lineWidth = Math.max(1, r.width * this.mapScale);
        g.beginPath();
        r.points.forEach(([x, z], i) => {
          const px = this.mapOx + x * this.mapScale;
          const pz = this.mapOz + z * this.mapScale;
          if (i === 0) g.moveTo(px, pz);
          else g.lineTo(px, pz);
        });
        g.stroke();
      }
      let attr = this.el.querySelector('.hud-attr') as HTMLElement | null;
      if (!attr) {
        attr = document.createElement('div');
        attr.className = 'hud-attr';
        this.el.appendChild(attr);
      }
      attr.textContent = city.attribution.includes('OpenStreetMap')
        ? t('osm.attribution')
        : city.attribution;
    }
    g.lineJoin = 'round';
    const path = () => {
      g.beginPath();
      track.samples.forEach((s, i) => {
        const x = this.mapOx + s.x * this.mapScale,
          y = this.mapOz + s.z * this.mapScale;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      if (track.def.closed) g.closePath();
    };
    g.strokeStyle = 'rgba(41,224,255,0.25)';
    g.lineWidth = 7;
    path();
    g.stroke();
    g.strokeStyle = 'rgba(230,240,255,0.85)';
    g.lineWidth = 2.5;
    path();
    g.stroke();
    // Финиш
    const fin = track.checkpoints[track.checkpoints.length - 1]!;
    g.fillStyle = '#ff2bd6';
    g.fillRect(
      this.mapOx + fin.x * this.mapScale - 3,
      this.mapOz + fin.z * this.mapScale - 3,
      6,
      6,
    );
    this.mapBg = c;
  }

  showToast(text: string, seconds = 2.5, cls = ''): void {
    this.toast.textContent = text;
    this.toast.className = `hud-toast ${cls}`;
    this.toastTimer = seconds;
  }

  update(s: HudState, dots: MinimapDot[], dt: number): void {
    this.speed.textContent = String(Math.round(s.speedKmh));
    this.gear.textContent = s.gear === -1 ? 'R' : s.gear === 0 ? 'N' : String(s.gear);
    this.gear.classList.toggle('manual', s.manual);
    this.nitroFill.style.width = `${Math.round(s.nitro * 100)}%`;
    this.nitroFill.parentElement!.classList.toggle('active', s.nitroActive);
    this.drawRpm(s.rpm, s.redline);

    const showRace = s.mode !== 'free';
    this.pos.style.display = s.total > 1 ? '' : 'none';
    this.pos.innerHTML = `<span class="v">${s.position}</span><span class="of">/${s.total}</span>`;
    this.lap.textContent = showRace
      ? t('hud.lap', { n: Math.min(s.lap + 1, s.laps), of: s.laps })
      : t('hud.free');
    this.time.textContent = showRace ? formatTime(s.time) : formatTime(s.lapTime);
    const bestTxt = s.bestLap > 0 ? t('hud.best', { time: formatTime(s.bestLap) }) : '';
    const ghostTxt =
      s.ghostBest > 0 ? ` · ${t('hud.ghost', { time: formatTime(s.ghostBest) })}` : '';
    this.best.textContent = bestTxt + ghostTxt;

    // Обратный отсчёт
    if (!s.racing && s.countdown > 0) {
      const n = Math.ceil(s.countdown);
      if (n !== this.lastCount) {
        this.center.textContent = String(n);
        this.center.className = 'hud-center pop';
        void this.center.offsetWidth;
        this.center.className = 'hud-center pop go-anim';
        this.lastCount = n;
      }
    } else if (this.lastCount > 0 && s.racing) {
      this.center.textContent = t('hud.go');
      this.center.className = 'hud-center pop go go-anim';
      this.lastCount = 0;
      setTimeout(() => (this.center.textContent = ''), 900);
    }

    this.banner.classList.toggle('hidden', !s.wrongWay);
    this.banner.textContent = t('hud.wrongWay');

    if (s.drift) {
      this.driftBox.classList.remove('hidden');
      const d = s.drift;
      this.driftBox.innerHTML = `<div class="total">${d.total.toLocaleString('ru-RU')}</div>
        <div class="chain ${d.active ? 'on' : ''}">${d.chain > 0 ? `+${d.chain.toLocaleString('ru-RU')} <b>×${d.multiplier}</b>` : ''}</div>`;
    }

    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      this.toast.classList.remove('hidden');
      if (this.toastTimer <= 0) this.toast.classList.add('hidden');
    }

    this.drawMap(dots);
  }

  private drawRpm(rpm: number, red: number): void {
    const c = this.rpmCanvas;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    const cx = 110,
      cy = 112,
      r = 96;
    const a0 = Math.PI * 1.05,
      a1 = Math.PI * 1.95;
    const frac = Math.min(1, rpm / (red * 1.05));
    g.lineWidth = 10;
    g.lineCap = 'butt';
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.beginPath();
    g.arc(cx, cy, r, a0, a1);
    g.stroke();
    const redFrom = a0 + (a1 - a0) * (0.88 / 1.05);
    g.strokeStyle = 'rgba(255,43,80,0.35)';
    g.beginPath();
    g.arc(cx, cy, r, redFrom, a1);
    g.stroke();
    const grad = g.createLinearGradient(0, 0, 220, 0);
    grad.addColorStop(0, '#29e0ff');
    grad.addColorStop(0.75, '#ff2bd6');
    grad.addColorStop(1, '#ff3050');
    g.strokeStyle = grad;
    g.beginPath();
    g.arc(cx, cy, r, a0, a0 + (a1 - a0) * frac);
    g.stroke();
    // Риски
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 2;
    const steps = Math.ceil(red / 1000);
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (a1 - a0) * Math.min(1, (i * 1000) / (red * 1.05));
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * (r - 14), cy + Math.sin(a) * (r - 14));
      g.lineTo(cx + Math.cos(a) * (r - 6), cy + Math.sin(a) * (r - 6));
      g.stroke();
    }
  }

  private drawMap(dots: MinimapDot[]): void {
    const g = this.map.getContext('2d')!;
    g.clearRect(0, 0, 180, 180);
    if (this.mapBg) g.drawImage(this.mapBg, 0, 0);
    for (const d of dots) {
      g.fillStyle = d.color;
      g.beginPath();
      g.arc(
        this.mapOx + d.x * this.mapScale,
        this.mapOz + d.z * this.mapScale,
        d.player ? 5 : 3.5,
        0,
        Math.PI * 2,
      );
      g.fill();
      if (d.player) {
        g.strokeStyle = '#fff';
        g.lineWidth = 1.5;
        g.stroke();
      }
    }
  }

  dispose(): void {
    this.el.remove();
  }
}
