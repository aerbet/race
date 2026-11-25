import type { CarConfig } from '@sr/shared';

type EngineType = CarConfig['engine']['sound'];

/** Базовые обороты «сэмплов» — 4 петли, между ними кроссфейд. */
const SAMPLE_RPMS = [1000, 2500, 4500, 7000];

const CYL: Record<EngineType, number> = { i4: 4, v6: 6, v8: 8, rotary: 4, electric: 0 };

/**
 * Собственные «записи» двигателя: петля 1 с, синтезированная заранее в OfflineAudioContext.
 * Гармоники частоты зажигания + неровность цилиндров + шум впуска — характер по типу мотора.
 */
async function renderLoop(type: EngineType, rpm: number, sampleRate: number): Promise<AudioBuffer> {
  const len = sampleRate; // 1 с — целое число периодов, бесшовная петля
  const ctx = new OfflineAudioContext(1, len, sampleRate);
  const buf = ctx.createBuffer(1, len, sampleRate);
  const d = buf.getChannelData(0);
  if (type === 'electric') {
    // Электромотор: тональный вой инвертора + лёгкий шум
    const f = Math.round((rpm / 60) * 6);
    for (let i = 0; i < len; i++) {
      const t = i / sampleRate;
      d[i] =
        0.35 * Math.sin(2 * Math.PI * f * t) +
        0.15 * Math.sin(2 * Math.PI * f * 2 * t) +
        0.08 * Math.sin(2 * Math.PI * Math.round(f * 3.01) * t);
    }
  } else {
    const cyl = CYL[type];
    const crank = rpm / 60;
    const fire = Math.max(1, Math.round((crank * cyl) / 2)); // частота зажигания, целая
    const sub = Math.max(1, Math.round(crank / 2)); // цикл двигателя (2 оборота)
    const harm =
      type === 'v8'
        ? [1, 0.7, 0.35, 0.2, 0.12, 0.08]
        : type === 'rotary'
          ? [1, 0.9, 0.7, 0.5, 0.35, 0.25, 0.15]
          : type === 'v6'
            ? [1, 0.55, 0.4, 0.22, 0.12]
            : [1, 0.6, 0.3, 0.25, 0.1, 0.06];
    let seed = 1234 + rpm;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
    let noiseLp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sampleRate;
      let v = 0;
      harm.forEach((a, k) => (v += a * Math.sin(2 * Math.PI * fire * (k + 1) * t + k * 0.7)));
      // Неровность: модуляция циклом двигателя (рокот, особенно V8)
      const rough = type === 'v8' ? 0.45 : type === 'i4' ? 0.2 : 0.25;
      v *= 1 + rough * Math.sin(2 * Math.PI * sub * t);
      // Шум впуска/выпуска
      noiseLp += (rnd() - noiseLp) * 0.15;
      v += noiseLp * (0.3 + rpm / 20000);
      d[i] = v * 0.22;
    }
    // Гладкий шов петли
    const fade = 256;
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      d[i] = d[i]! * k + d[len - fade + i]! * (1 - k);
    }
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
  return ctx.startRendering();
}

function noiseBuffer(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

const cache = new Map<string, Promise<AudioBuffer[]>>();

export function engineSamples(ctx: AudioContext, type: EngineType): Promise<AudioBuffer[]> {
  const key = `${type}:${ctx.sampleRate}`;
  let p = cache.get(key);
  if (!p) {
    p = Promise.all(SAMPLE_RPMS.map((r) => renderLoop(type, r, ctx.sampleRate)));
    cache.set(key, p);
  }
  return p;
}

export interface EngineInputs {
  rpm: number;
  throttle: number;
  /** Макс. проскальзывание колёс 0..1+. */
  slip: number;
  nitro: boolean;
  speedKmh: number;
  wallHit: boolean;
  grounded: boolean;
}

/** Звук машины: мотор (кроссфейд 4 петель), турбо-сброс, визг шин, нитро, удары. */
export class CarAudio {
  private voices: { src: AudioBufferSourceNode; gain: GainNode; base: number }[] = [];
  private engineOut: GainNode;
  private filter: BiquadFilterNode;
  private tireGain: GainNode;
  private tireFilter: BiquadFilterNode;
  private nitroGain: GainNode;
  readonly out: GainNode;
  private prevThrottle = 0;
  private hitCooldown = 0;
  private ready = false;
  private noise: AudioBuffer;
  private started: AudioBufferSourceNode[] = [];

  constructor(
    readonly ctx: AudioContext,
    readonly type: EngineType,
    destination: AudioNode,
    readonly volume = 1,
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = volume;
    this.out.connect(destination);
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 2000;
    this.engineOut = ctx.createGain();
    this.engineOut.gain.value = 0.6;
    this.engineOut.connect(this.filter).connect(this.out);
    this.noise = noiseBuffer(ctx, 2);

    // Шины: шум через полосовой фильтр
    this.tireFilter = ctx.createBiquadFilter();
    this.tireFilter.type = 'bandpass';
    this.tireFilter.frequency.value = 1400;
    this.tireFilter.Q.value = 3;
    this.tireGain = ctx.createGain();
    this.tireGain.gain.value = 0;
    this.tireFilter.connect(this.tireGain).connect(this.out);
    const tn = ctx.createBufferSource();
    tn.buffer = this.noise;
    tn.loop = true;
    tn.connect(this.tireFilter);
    tn.start();
    this.started.push(tn);

    // Нитро: шипение
    const nf = ctx.createBiquadFilter();
    nf.type = 'highpass';
    nf.frequency.value = 2500;
    this.nitroGain = ctx.createGain();
    this.nitroGain.gain.value = 0;
    nf.connect(this.nitroGain).connect(this.out);
    const nn = ctx.createBufferSource();
    nn.buffer = this.noise;
    nn.loop = true;
    nn.connect(nf);
    nn.start();
    this.started.push(nn);

    void engineSamples(ctx, type).then((bufs) => {
      bufs.forEach((b, i) => {
        const src = ctx.createBufferSource();
        src.buffer = b;
        src.loop = true;
        const g = ctx.createGain();
        g.gain.value = 0;
        src.connect(g).connect(this.engineOut);
        src.start();
        this.voices.push({ src, gain: g, base: SAMPLE_RPMS[i]! });
        this.started.push(src);
      });
      this.ready = true;
    });
  }

  update(s: EngineInputs, dt: number): void {
    const t = this.ctx.currentTime;
    const tc = 0.04;
    if (this.ready) {
      // Кроссфейд между двумя ближайшими петлями (равная мощность)
      const rpm = Math.max(600, s.rpm);
      let lo = 0;
      while (lo < SAMPLE_RPMS.length - 2 && rpm > SAMPLE_RPMS[lo + 1]!) lo++;
      const a = SAMPLE_RPMS[lo]!,
        b = SAMPLE_RPMS[lo + 1]!;
      const k = Math.max(0, Math.min(1, (rpm - a) / (b - a)));
      this.voices.forEach((v, i) => {
        let g = 0;
        if (i === lo) g = Math.cos((k * Math.PI) / 2);
        if (i === lo + 1) g = Math.sin((k * Math.PI) / 2);
        v.gain.gain.setTargetAtTime(g, t, tc);
        v.src.playbackRate.setTargetAtTime(rpm / v.base, t, tc);
      });
    }
    // Нагрузка: на газу ярче и громче
    const load = 0.35 + 0.65 * s.throttle;
    this.filter.frequency.setTargetAtTime(700 + 5500 * load + s.rpm * 0.25, t, 0.05);
    this.engineOut.gain.setTargetAtTime(0.35 + 0.35 * load, t, 0.05);

    // Турбо-сброс: резкий сброс газа на высоких оборотах
    if (this.prevThrottle > 0.7 && s.throttle < 0.2 && s.rpm > 3800 && this.type !== 'electric')
      this.blowOff();
    this.prevThrottle = s.throttle;

    const squeal = s.grounded
      ? Math.max(0, Math.min(1, (s.slip - 0.25) * 1.4)) * Math.min(1, s.speedKmh / 25)
      : 0;
    this.tireGain.gain.setTargetAtTime(squeal * 0.35, t, 0.05);
    this.tireFilter.frequency.setTargetAtTime(1100 + squeal * 700, t, 0.1);
    this.nitroGain.gain.setTargetAtTime(s.nitro ? 0.18 : 0, t, 0.08);

    this.hitCooldown -= dt;
    if (s.wallHit && this.hitCooldown <= 0 && s.speedKmh > 15) {
      this.hit(Math.min(1, s.speedKmh / 120));
      this.hitCooldown = 0.4;
    }
  }

  private blowOff(): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 3200;
    f.Q.value = 1.5;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    f.frequency.exponentialRampToValueAtTime(1800, t + 0.45);
    src.connect(f).connect(g).connect(this.out);
    src.start(t, Math.random());
    src.stop(t + 0.5);
  }

  private hit(strength: number): void {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.6 * strength, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.32);
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.25 * strength, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    n.connect(ng).connect(this.out);
    n.start(t, Math.random());
    n.stop(t + 0.16);
  }

  setVolume(v: number): void {
    this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
  }

  dispose(): void {
    for (const s of this.started) {
      try {
        s.stop();
      } catch {
        /* уже остановлен */
      }
    }
    this.out.disconnect();
  }
}

let shared: AudioContext | null = null;
let master: GainNode | null = null;

/** Общий AudioContext (создаётся по жесту пользователя). */
export function audio(): { ctx: AudioContext; master: GainNode } | null {
  try {
    if (!shared) {
      shared = new AudioContext();
      master = shared.createGain();
      master.gain.value = 0.7;
      master.connect(shared.destination);
    }
    if (shared.state === 'suspended') void shared.resume();
    return { ctx: shared, master: master! };
  } catch {
    return null;
  }
}
