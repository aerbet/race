/**
 * «Радио игры» — собственная генеративная музыка (синтвейв), синтез в WebAudio.
 * Без файлов и чужих записей: трек целиком задаётся числом-зерном, поэтому его можно
 * спокойно играть на стриме. Планировщик ставит ноты на 0,2 с вперёд (lookahead).
 */
import { audio } from './engine-audio';

export interface RadioTrack {
  seed: number;
  bpm: number;
  /** MIDI-нота тоники (бас). */
  root: number;
  /** Ступени минорной гаммы для четырёх аккордов (по 2 такта на аккорд). */
  progression: number[];
  /** Рисунок баса на 16 шестнадцатых: индекс ноты аккорда или -1. */
  bass: number[];
  /** Рисунок арпеджио на 16 шестнадцатых: индекс ноты аккорда (0..3) или -1. */
  arp: number[];
  /** Хэт на каждую восьмую (false) или шестнадцатую (true). */
  hat16: boolean;
  /** Длина трека в тактах. */
  bars: number;
}

/** mulberry32 — детерминированный ГПСЧ. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PROGRESSIONS = [
  [0, 5, 2, 6], // i VI III VII
  [0, 3, 5, 4], // i iv VI v
  [0, 6, 5, 6], // i VII VI VII
  [0, 5, 3, 4], // i VI iv v
  [0, 2, 6, 3], // i III VII iv
];
const BASS = [
  [0, -1, 0, -1, 0, -1, 0, 0, 0, -1, 0, -1, 0, -1, 0, 1],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, -1, -1, 0, -1, -1, 0, -1, 0, -1, -1, 0, -1, -1, 2, -1],
];
const ARPS = [
  [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1, 2, 3],
  [0, 2, 1, 3, 0, 2, 1, 3, 0, 2, 1, 3, 0, 2, 1, 3],
  [0, -1, 2, -1, 3, -1, 2, -1, 0, -1, 2, -1, 3, 2, 1, -1],
  [3, 2, 1, 0, 3, 2, 1, 0, 3, 2, 1, 0, 1, 2, 3, -1],
];

/** Трек по зерну — чистая функция (тест: одно зерно → один трек). */
export function radioTrack(seed: number): RadioTrack {
  const r = rng(seed * 7919 + 13);
  const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)]!;
  return {
    seed,
    bpm: 96 + Math.floor(r() * 27),
    root: 38 + Math.floor(r() * 8),
    progression: pick(PROGRESSIONS),
    bass: pick(BASS),
    arp: pick(ARPS),
    hat16: r() < 0.4,
    bars: 64,
  };
}

const MINOR = [0, 2, 3, 5, 7, 8, 10];
/** Четыре ноты аккорда (терции от ступени) в полутонах от тоники. */
export function chordNotes(degree: number): number[] {
  return [0, 2, 4, 6].map((k) => {
    const i = degree + k;
    return MINOR[i % 7]! + 12 * Math.floor(i / 7);
  });
}

const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

/** Проигрыватель радио. Громкость — свой GainNode, независимо от звука машин. */
export class RadioPlayer {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private timer = 0;
  private step = 0;
  private nextTime = 0;
  private volume = 0.5;
  track: RadioTrack = radioTrack(1);
  playing = false;
  onChange: () => void = () => {};

  private ensure(): boolean {
    if (this.ctx) return true;
    const a = audio();
    if (!a) return false;
    this.ctx = a.ctx;
    this.out = a.ctx.createGain();
    this.out.gain.value = this.volume;
    // Мягкий «ламповый» срез верхов и компрессор, чтобы радио не спорило с мотором
    const lp = a.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 9000;
    const comp = a.ctx.createDynamicsCompressor();
    this.out.connect(lp).connect(comp).connect(a.ctx.destination);
    const len = a.ctx.sampleRate * 0.5;
    this.noise = a.ctx.createBuffer(1, len, a.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    const nr = rng(99);
    for (let i = 0; i < len; i++) d[i] = nr() * 2 - 1;
    return true;
  }

  play(): void {
    if (!this.ensure() || this.playing) return;
    this.playing = true;
    this.nextTime = this.ctx!.currentTime + 0.05;
    this.timer = window.setInterval(() => this.schedule(), 50);
    this.onChange();
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer);
    this.onChange();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  /** Следующий трек: новое зерно. */
  next(): void {
    this.track = radioTrack(this.track.seed + 1);
    this.step = 0;
    this.onChange();
  }

  prev(): void {
    // В начале трека — предыдущий, иначе — этот же с начала
    if (this.step < 32) this.track = radioTrack(Math.max(1, this.track.seed - 1));
    this.step = 0;
    this.onChange();
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.out) this.out.gain.value = this.volume;
  }

  private schedule(): void {
    const ctx = this.ctx!;
    const tr = this.track;
    const dt = 60 / tr.bpm / 4;
    while (this.nextTime < ctx.currentTime + 0.2) {
      this.playStep(this.step, this.nextTime, dt);
      this.nextTime += dt;
      this.step++;
      if (this.step >= tr.bars * 16) this.next();
    }
  }

  private playStep(step: number, t: number, dt: number): void {
    const tr = this.track;
    const s16 = step % 16;
    const bar = Math.floor(step / 16);
    // Вступление: первые 4 такта — без барабанов, последние 4 — только пэд
    const intro = bar < 4;
    const outro = bar >= tr.bars - 4;
    const chord = chordNotes(tr.progression[Math.floor(bar / 2) % 4]!);
    if (!intro && !outro) {
      if (s16 % 4 === 0) this.kick(t);
      if (s16 === 4 || s16 === 12) this.snare(t);
      if (tr.hat16 || s16 % 2 === 0) this.hat(t, s16 % 4 === 2 ? 0.09 : 0.05);
    }
    if (!outro) {
      const b = tr.bass[s16]!;
      if (b >= 0) this.bassNote(t, tr.root + chord[b]!, dt * 0.9);
      const a = tr.arp[s16]!;
      if (a >= 0 && bar >= 2) this.arpNote(t, tr.root + 24 + chord[a]!, dt * 0.8);
    }
    if (s16 === 0 && bar % 2 === 0)
      this.pad(
        t,
        chord.map((n) => tr.root + 12 + n),
        dt * 32,
      );
  }

  private env(t: number, peak: number, attack: number, release: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
    g.connect(this.out!);
    return g;
  }

  private osc(type: OscillatorType, hz: number, t: number, dur: number, dest: AudioNode): void {
    const o = this.ctx!.createOscillator();
    o.type = type;
    o.frequency.value = hz;
    o.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private kick(t: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    o.connect(this.env(t, 0.9, 0.003, 0.25));
    o.start(t);
    o.stop(t + 0.3);
  }

  private noiseHit(t: number, peak: number, release: number, type: BiquadFilterType, hz: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = hz;
    src.connect(f).connect(this.env(t, peak, 0.002, release));
    src.start(t);
    src.stop(t + release + 0.05);
  }

  private snare(t: number): void {
    this.noiseHit(t, 0.35, 0.18, 'bandpass', 1800);
    this.osc('triangle', 190, t, 0.08, this.env(t, 0.2, 0.002, 0.08));
  }

  private hat(t: number, peak: number): void {
    this.noiseHit(t, peak, 0.04, 'highpass', 8000);
  }

  private bassNote(t: number, midi: number, dur: number): void {
    const f = this.ctx!.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(200, t + dur);
    f.connect(this.env(t, 0.32, 0.005, dur));
    this.osc('sawtooth', midiHz(midi), t, dur, f);
  }

  private arpNote(t: number, midi: number, dur: number): void {
    const g = this.env(t, 0.07, 0.004, dur);
    this.osc('square', midiHz(midi), t, dur, g);
  }

  private pad(t: number, notes: number[], dur: number): void {
    const f = this.ctx!.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1400;
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + dur * 0.25);
    g.gain.setValueAtTime(0.06, t + dur * 0.75);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f.connect(g).connect(this.out!);
    for (const n of notes)
      for (const det of [-7, 7]) {
        const o = this.ctx!.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midiHz(n);
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 0.05);
      }
  }
}

export const radio = new RadioPlayer();
