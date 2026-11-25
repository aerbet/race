import {
  CAR_IDS,
  CarFlags,
  MAX_FREEROAM,
  Msg,
  PHYSICS_HZ,
  PROTOCOL_VERSION,
  SERVER_TICK_HZ,
  buildTrack,
  distanceToRoad,
  encodeServer,
  getCar,
  maxPlausibleSpeed,
  type CarConfig,
  type CarState,
  type City,
  type ClientMsg,
  type ServerMsg,
} from '@sr/shared';

const STEPS_PER_TICK = PHYSICS_HZ / SERVER_TICK_HZ;
/** Дистанция, с которой можно вызвать на гонку фарами, м. */
export const CHALLENGE_RANGE = 45;
/** Приглашение действует, шагов. */
const INVITE_STEPS = 12 * PHYSICS_HZ;
const MAX_REJECTS = 90;

interface FRPlayer {
  id: number;
  name: string;
  carId: string;
  cfg: CarConfig;
  send: (d: Uint8Array) => void;
  state: CarState | null;
  lastStep: number;
  rejects: number;
  /** Входящее приглашение: от кого, на какую трассу, до какого шага. */
  invite: { from: number; trackId: string; until: number } | null;
}

export type RaceFactory = (trackId: string, cityId: string) => { code: string };

/**
 * Свободная езда по городу: до 16 игроков, снимки 30 Гц, проверки правдоподобия,
 * вызов на гонку фарами → приватная комната на ближайшей городской трассе.
 */
export class FreeRoam {
  readonly players = new Map<number, FRPlayer>();
  step = 0;
  private ids = 0;

  constructor(
    readonly city: City,
    readonly code: string,
    private readonly makeRace: RaceFactory,
  ) {}

  get full(): boolean {
    return this.players.size >= MAX_FREEROAM;
  }

  get empty(): boolean {
    return this.players.size === 0;
  }

  join(name: string, carId: string, send: (d: Uint8Array) => void): FRPlayer | null {
    if (this.full) return null;
    const id = ++this.ids;
    const cfg = CAR_IDS.includes(carId) ? getCar(carId) : getCar(CAR_IDS[0]!);
    const p: FRPlayer = {
      id,
      name: (name || `Игрок ${id}`).slice(0, 16),
      carId: cfg.id,
      cfg,
      send,
      state: null,
      lastStep: 0,
      rejects: 0,
      invite: null,
    };
    this.players.set(id, p);
    this.sendTo(p, {
      type: Msg.Welcome,
      version: PROTOCOL_VERSION,
      playerId: id,
      room: this.code,
      trackId: this.city.tracks[0]?.id ?? '',
      laps: 0,
      city: this.city.id,
    });
    this.broadcastLobby();
    return p;
  }

  leave(id: number): void {
    if (!this.players.delete(id)) return;
    this.broadcastLobby();
  }

  handle(id: number, m: ClientMsg): void {
    const p = this.players.get(id);
    if (!p) return;
    switch (m.type) {
      case Msg.State:
        this.onState(p, m.step, m.car);
        break;
      case Msg.Ping:
        this.sendTo(p, { type: Msg.Pong, t: m.t, serverStep: this.step });
        break;
      case Msg.Challenge:
        this.challenge(p, m.target);
        break;
      case Msg.ChallengeReply:
        this.reply(p, m.from, m.accept);
        break;
      case Msg.Leave:
        this.leave(id);
        break;
      default:
        break;
    }
  }

  /** Проверки: числа, скорость, перемещение; сброс разрешён только на улицу. */
  private verdict(p: FRPlayer, s: CarState, step: number): string | null {
    const vals = [s.x, s.y, s.z, s.vx, s.vy, s.vz, s.qx, s.qy, s.qz, s.qw];
    if (!vals.every(Number.isFinite)) return 'nan';
    if (Math.hypot(s.vx, s.vy, s.vz) > maxPlausibleSpeed(p.cfg)) return 'speed';
    const b = this.city.bounds;
    if (s.x < b.minX - 300 || s.x > b.maxX + 300 || s.z < b.minZ - 300 || s.z > b.maxZ + 300)
      return 'out-of-world';
    if (!p.state) return null;
    if (step <= p.lastStep) return 'step-order';
    const dt = (step - p.lastStep) / PHYSICS_HZ;
    const dist = Math.hypot(s.x - p.state.x, s.z - p.state.z);
    if (dist > maxPlausibleSpeed(p.cfg) * dt * 1.25 + 1.5) {
      if (!(s.flags & CarFlags.Reset)) return 'teleport';
      if (distanceToRoad(this.city, s.x, s.z) > 3) return 'reset-off-road';
    }
    return null;
  }

  private onState(p: FRPlayer, step: number, car: CarState): void {
    const bad = this.verdict(p, car, step);
    if (bad) {
      p.rejects++;
      if (p.state) this.sendTo(p, { type: Msg.Correction, reason: bad, car: p.state });
      if (p.rejects > MAX_REJECTS) {
        this.sendTo(p, {
          type: Msg.Error,
          code: 'kick',
          message: 'слишком много некорректных данных',
        });
        this.leave(p.id);
      }
      return;
    }
    p.rejects = 0;
    p.state = car;
    p.lastStep = step;
  }

  /** Трасса для вызова: та городская трасса, чья решётка ближе всего к вызывающему. */
  private trackFor(x: number, z: number): string {
    let best = '';
    let bestD = Infinity;
    for (const def of this.city.tracks) {
      const g = buildTrack(def).grid[0]!;
      const d = Math.hypot(g.x - x, g.z - z);
      if (d < bestD) {
        bestD = d;
        best = def.id;
      }
    }
    return best;
  }

  private challenge(p: FRPlayer, targetId: number): void {
    const t = this.players.get(targetId);
    if (!t || t === p || !p.state || !t.state) return;
    if (Math.hypot(p.state.x - t.state.x, p.state.z - t.state.z) > CHALLENGE_RANGE) return;
    if (t.invite && t.invite.until > this.step) return;
    const trackId = this.trackFor(p.state.x, p.state.z);
    if (!trackId) return;
    t.invite = { from: p.id, trackId, until: this.step + INVITE_STEPS };
    this.sendTo(t, { type: Msg.ChallengeInvite, from: p.id, name: p.name, trackId });
  }

  private reply(p: FRPlayer, from: number, accept: boolean): void {
    const inv = p.invite;
    p.invite = null;
    if (!inv || inv.from !== from || inv.until < this.step || !accept) return;
    const challenger = this.players.get(from);
    if (!challenger) return;
    const race = this.makeRace(inv.trackId, this.city.id);
    const msg: ServerMsg = { type: Msg.ChallengeStart, room: race.code, trackId: inv.trackId };
    this.sendTo(p, msg);
    this.sendTo(challenger, msg);
  }

  tick(): void {
    this.step += STEPS_PER_TICK;
    const entries = [...this.players.values()]
      .filter((p) => p.state)
      .map((p) => ({ id: p.id, car: p.state!, lap: 0, position: 0 }));
    this.broadcast({ type: Msg.Snapshot, step: this.step, startStep: 0, entries });
  }

  private broadcastLobby(): void {
    this.broadcast({
      type: Msg.Lobby,
      phase: 'freeroam',
      timer: 0,
      hostId: 0,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        carId: p.carId,
        ready: true,
        bot: false,
        ping: 0,
      })),
    });
  }

  private sendTo(p: FRPlayer, m: ServerMsg): void {
    p.send(encodeServer(m));
  }

  private broadcast(m: ServerMsg): void {
    const d = encodeServer(m);
    for (const p of this.players.values()) p.send(d);
  }
}
