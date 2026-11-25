/**
 * Очки дрифта: угол × скорость × длина цепочки. Цепочка продолжается, если пауза
 * между заносами < CHAIN_GAP; удар о стену сжигает текущую цепочку.
 */
export const CHAIN_GAP = 1.5;
export const MIN_ANGLE_DEG = 12;
export const MIN_SPEED_KMH = 30;
export const MAX_MULTIPLIER = 5;

export interface DriftSnapshot {
  total: number;
  chain: number;
  multiplier: number;
  /** Идёт ли занос прямо сейчас. */
  active: boolean;
  /** Последнее событие: 'banked' (цепочка зачтена) или 'lost' (удар). */
  lastEvent: 'banked' | 'lost' | null;
  lastEventValue: number;
  bestChain: number;
}

export class DriftScorer {
  total = 0;
  chain = 0;
  chainTime = 0;
  gap = 0;
  active = false;
  bestChain = 0;
  lastEvent: 'banked' | 'lost' | null = null;
  lastEventValue = 0;

  get multiplier(): number {
    return Math.min(MAX_MULTIPLIER, 1 + Math.floor(this.chainTime / 2) * 0.5);
  }

  /** dt — шаг, angleDeg — модуль угла заноса, wallHit — касание стены. */
  update(dt: number, angleDeg: number, speedKmh: number, wallHit: boolean): void {
    if (wallHit && this.chain > 0) {
      this.lastEvent = 'lost';
      this.lastEventValue = this.chain;
      this.chain = 0;
      this.chainTime = 0;
      this.active = false;
      this.gap = CHAIN_GAP;
      return;
    }
    this.active = angleDeg >= MIN_ANGLE_DEG && angleDeg < 100 && speedKmh >= MIN_SPEED_KMH;
    if (this.active) {
      const angleF = Math.min(angleDeg, 60) / 10;
      const speedF = speedKmh / 10;
      this.chain += angleF * speedF * dt * this.multiplier;
      this.chainTime += dt;
      this.gap = 0;
    } else if (this.chain > 0) {
      this.gap += dt;
      if (this.gap >= CHAIN_GAP) this.bank();
    }
  }

  /** Зачесть текущую цепочку (финиш, конец заезда). */
  bank(): void {
    if (this.chain <= 0) return;
    const v = Math.round(this.chain);
    this.total += v;
    this.bestChain = Math.max(this.bestChain, v);
    this.lastEvent = 'banked';
    this.lastEventValue = v;
    this.chain = 0;
    this.chainTime = 0;
  }

  snapshot(): DriftSnapshot {
    return {
      total: this.total,
      chain: Math.round(this.chain),
      multiplier: this.multiplier,
      active: this.active,
      lastEvent: this.lastEvent,
      lastEventValue: this.lastEventValue,
      bestChain: this.bestChain,
    };
  }
}
