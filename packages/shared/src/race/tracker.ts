import { PHYSICS_HZ } from '../constants';
import type { BuiltTrack, Checkpoint } from '../tracks/build';
import { trackCoords } from '../tracks/build';

export type RacePhase = 'countdown' | 'racing' | 'finished';

export interface RacerState {
  id: string;
  lap: number;
  /** Индекс следующего чекпоинта. */
  nextCp: number;
  finished: boolean;
  /** Время финиша в шагах от старта. */
  finishStep: number;
  /** Время каждого круга в шагах. */
  lapSteps: number[];
  lapStartStep: number;
  bestLapSteps: number;
  /** Монотонный прогресс по трассе (м) — для позиций. */
  progress: number;
  position: number;
  wrongWayTime: number;
  wrongWay: boolean;
  /** Дистанция последнего пройденного чекпоинта — для сброса. */
  respawnS: number;
  hint: number;
  /** Не участвует в гонке (вылетел из сети и т.п.). */
  dnf: boolean;
}

export interface RaceEvent {
  type: 'checkpoint' | 'lap' | 'finish' | 'overtake' | 'start';
  racer: string;
  step: number;
  lap?: number;
  cp?: number;
  lapSteps?: number;
  /** Для overtake: кого обогнали. */
  other?: string;
}

export const COUNTDOWN_STEPS = 3 * PHYSICS_HZ;

/** Пересекает ли отрезок a→b плоскость чекпоинта в прямом направлении. */
export function crossesCheckpoint(
  cp: Checkpoint,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): boolean {
  const da = (ax - cp.x) * cp.tx + (az - cp.z) * cp.tz;
  const db = (bx - cp.x) * cp.tx + (bz - cp.z) * cp.tz;
  if (!(da < 0 && db >= 0)) return false;
  const t = da / (da - db);
  const px = ax + (bx - ax) * t,
    pz = az + (bz - az) * t;
  const lateral = (px - cp.x) * -cp.tz + (pz - cp.z) * cp.tx;
  return Math.abs(lateral) <= cp.halfWidth;
}

/**
 * Гоночная логика: обратный отсчёт, порядок чекпоинтов, круги, финиш, позиции,
 * неправильное направление. Общая для клиента и сервера; время — в шагах физики.
 */
export class RaceTracker {
  phase: RacePhase = 'countdown';
  step = 0;
  /** Шаг, на котором дан старт. */
  startStep = COUNTDOWN_STEPS;
  readonly racers = new Map<string, RacerState>();
  private last = new Map<string, { x: number; z: number }>();
  events: RaceEvent[] = [];
  readonly laps: number;

  constructor(
    readonly track: BuiltTrack,
    laps?: number,
    countdownSteps = COUNTDOWN_STEPS,
  ) {
    this.laps = laps ?? track.def.laps;
    this.startStep = countdownSteps;
    if (countdownSteps === 0) this.phase = 'racing';
  }

  addRacer(id: string, x: number, z: number): RacerState {
    const c = trackCoords(this.track, x, z);
    const r: RacerState = {
      id,
      lap: 0,
      nextCp: 0,
      finished: false,
      finishStep: 0,
      lapSteps: [],
      lapStartStep: this.startStep,
      bestLapSteps: 0,
      progress: this.relS(c.s) - (this.track.def.closed ? this.track.length : 0),
      position: this.racers.size + 1,
      wrongWayTime: 0,
      wrongWay: false,
      respawnS: c.s,
      hint: c.i,
      dnf: false,
    };
    // На кольце решётка стоит ДО линии старта: прогресс отрицательный
    if (this.track.def.closed && r.progress < -this.track.length / 2)
      r.progress += this.track.length;
    this.racers.set(id, r);
    this.last.set(id, { x, z });
    return r;
  }

  removeRacer(id: string): void {
    this.racers.delete(id);
    this.last.delete(id);
  }

  /** Дистанция от линии старта. */
  private relS(s: number): number {
    const L = this.track.length;
    const r = s - this.track.def.startS;
    return this.track.def.closed ? ((r % L) + L) % L : r;
  }

  get countdown(): number {
    return Math.max(0, this.startStep - this.step) / PHYSICS_HZ;
  }

  get raceSteps(): number {
    return Math.max(0, this.step - this.startStep);
  }

  /**
   * Обновление гонщика после шага физики. vx/vz — скорость (для «неправильного направления»).
   */
  updateRacer(id: string, x: number, z: number, vx: number, vz: number): void {
    const r = this.racers.get(id);
    const prev = this.last.get(id);
    if (!r || !prev) return;
    this.last.set(id, { x, z });
    if (this.phase === 'countdown' || r.finished || r.dnf) return;

    const cps = this.track.checkpoints;
    const cp = cps[r.nextCp]!;
    if (crossesCheckpoint(cp, prev.x, prev.z, x, z)) {
      r.respawnS = cp.s;
      this.events.push({
        type: 'checkpoint',
        racer: id,
        step: this.step,
        cp: r.nextCp,
        lap: r.lap,
      });
      r.nextCp++;
      if (r.nextCp >= cps.length) {
        r.nextCp = 0;
        const lapSteps = this.step - r.lapStartStep;
        r.lapSteps.push(lapSteps);
        if (!r.bestLapSteps || lapSteps < r.bestLapSteps) r.bestLapSteps = lapSteps;
        r.lapStartStep = this.step;
        r.lap++;
        this.events.push({ type: 'lap', racer: id, step: this.step, lap: r.lap, lapSteps });
        if (r.lap >= this.laps) {
          r.finished = true;
          r.finishStep = this.step - this.startStep;
          this.events.push({ type: 'finish', racer: id, step: this.step, lapSteps });
        }
      }
    }

    // Прогресс: зажат между предыдущим и следующим чекпоинтом — срезки не дают позиций
    const c = trackCoords(this.track, x, z, r.hint);
    r.hint = c.i;
    const L = this.track.def.closed ? this.track.length : 0;
    const prevCpS = r.nextCp === 0 ? 0 : this.relS(cps[r.nextCp - 1]!.s);
    let nextCpS = this.relS(cp.s);
    if (r.nextCp === cps.length - 1 && this.track.def.closed) nextCpS = this.track.length;
    let s = this.relS(c.s);
    if (r.nextCp === 0 && s > this.track.length * 0.75 && this.track.def.closed)
      s -= this.track.length;
    s = Math.max(prevCpS, Math.min(nextCpS, s));
    r.progress = r.lap * L + s;

    // Неправильное направление
    const sm = this.track.samples[c.i]!;
    const along = vx * sm.tx + vz * sm.tz;
    r.wrongWayTime =
      along < -3 ? r.wrongWayTime + 1 / PHYSICS_HZ : Math.max(0, r.wrongWayTime - 2 / PHYSICS_HZ);
    r.wrongWay = r.wrongWayTime > 1.2;
  }

  /** Шаг гонки (вызывать после updateRacer всех участников). */
  tick(): void {
    this.step++;
    if (this.phase === 'countdown' && this.step >= this.startStep) {
      this.phase = 'racing';
      for (const r of this.racers.values()) r.lapStartStep = this.startStep;
      this.events.push({ type: 'start', racer: '', step: this.step });
    }
    // Позиции
    const before = new Map([...this.racers.values()].map((r) => [r.id, r.position]));
    const order = [...this.racers.values()].sort((a, b) => {
      if (a.dnf !== b.dnf) return a.dnf ? 1 : -1;
      if (a.finished && b.finished) return a.finishStep - b.finishStep;
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      return b.progress - a.progress;
    });
    order.forEach((r, i) => (r.position = i + 1));
    if (this.phase === 'racing') {
      for (const r of order) {
        const was = before.get(r.id)!;
        if (r.position < was && !r.finished) {
          const other = order[r.position]; // тот, кто теперь позади
          if (other)
            this.events.push({ type: 'overtake', racer: r.id, other: other.id, step: this.step });
        }
      }
      const active = order.filter((r) => !r.dnf);
      if (active.length > 0 && active.every((r) => r.finished)) this.phase = 'finished';
    }
  }

  standings(): RacerState[] {
    return [...this.racers.values()].sort((a, b) => a.position - b.position);
  }

  /** Забрать накопленные события. */
  drain(): RaceEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}

export const stepsToTime = (steps: number): number => steps / PHYSICS_HZ;

export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '--:--.---';
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}
