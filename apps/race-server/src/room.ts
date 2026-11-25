import {
  BOT_FILL_SECONDS,
  CAR_IDS,
  CarFlags,
  MAX_PLAYERS,
  Msg,
  PHYSICS_HZ,
  PROTOCOL_VERSION,
  RaceEventType,
  RaceTracker,
  SERVER_TICK_HZ,
  checkSector,
  checkState,
  encodeServer,
  getCar,
  getTrack,
  newPlayerTrack,
  emptyInput,
  type BuiltTrack,
  type CarConfig,
  type CarState,
  type ClientMsg,
  type LobbyPlayer,
  type PlayerTrack,
  type RaceEvent,
  type RoomPhase,
  type ServerMsg,
  type SnapshotEntry,
} from '@sr/shared';
import { Bot, Sim, type ProxyCar, type Rapier, type Vehicle } from '@sr/physics';

const STEPS_PER_TICK = PHYSICS_HZ / SERVER_TICK_HZ;
/** Минимум участников, до которого добиваем ботами. */
const MIN_RACERS = 4;
/** После финиша последнего человека ждём ботов не дольше, шагов. */
const FINISH_GRACE_STEPS = 20 * PHYSICS_HZ;
/** Подряд отклонённых пакетов до схода с гонки. */
const MAX_REJECTS = 90;
/** Насколько клиент может «опережать» сервер по шагам (задержка, джиттер). */
const AHEAD_TOLERANCE = 45;

const BOT_NAMES = ['Вега', 'Шторм', 'Кира', 'Марат', 'Нова', 'Рэй', 'Ли', 'Оскар'];

export interface HumanPlayer {
  id: number;
  name: string;
  carId: string;
  cfg: CarConfig;
  ready: boolean;
  send: (data: Uint8Array) => void;
  pt: PlayerTrack;
  state: CarState | null;
  /** Последний принятый шаг клиента. */
  clientStep: number;
  rejects: number;
  sectorStrikes: number;
  lastCpStep: number;
  lastCpS: number;
  proxy: ProxyCar | null;
  dnf: boolean;
  slot: number;
  /** Пользователь API (проверенный JWT) и его машина из гаража; null — гость. */
  userId: string | null;
  ownedCarId: string | null;
}

/** Итог гонки для API (награды, рейтинг). */
export interface RaceReport {
  raceId: string;
  ranked: boolean;
  rows: { userId: string; ownedCarId: string | null; position: number; finished: boolean }[];
}

interface BotPlayer {
  id: number;
  name: string;
  carId: string;
  vehicle: Vehicle;
  bot: Bot;
  slot: number;
}

export interface RoomOptions {
  trackId?: string;
  laps?: number;
  isPrivate?: boolean;
  botFillSeconds?: number;
  /** Город, по улицам которого идёт трасса. */
  cityId?: string;
  /** До скольких участников добивать ботами (вызов фарами — 2, без ботов). */
  minRacers?: number;
  /** Куда отправить итог гонки (API). */
  report?: (r: RaceReport) => void;
}

export class Room {
  phase: RoomPhase = 'lobby';
  readonly humans = new Map<number, HumanPlayer>();
  readonly bots: BotPlayer[] = [];
  readonly track: BuiltTrack;
  readonly laps: number;
  readonly isPrivate: boolean;
  private readonly report?: (r: RaceReport) => void;
  raceId = '';
  readonly cityId: string;
  readonly minRacers: number;
  readonly botFillSteps: number;
  tracker: RaceTracker | null = null;
  sim: Sim | null = null;
  /** Шаги ожидания в лобби. */
  lobbySteps = 0;
  hostId = 0;
  private finishGrace = -1;
  private resultsSent = false;
  private lastLobbyBroadcast = -1;
  private ids = 0;

  constructor(
    readonly R: Rapier,
    readonly code: string,
    opts: RoomOptions = {},
  ) {
    this.track = getTrack(opts.trackId ?? 'polygon');
    this.cityId = opts.cityId ?? '';
    this.minRacers = opts.minRacers ?? MIN_RACERS;
    this.laps = opts.laps ?? this.track.def.laps;
    this.isPrivate = !!opts.isPrivate;
    this.report = opts.report;
    this.botFillSteps = (opts.botFillSeconds ?? BOT_FILL_SECONDS) * PHYSICS_HZ;
  }

  get size(): number {
    return this.humans.size + this.bots.length;
  }

  get joinable(): boolean {
    return this.phase === 'lobby' && this.size < MAX_PLAYERS;
  }

  join(
    name: string,
    carId: string,
    send: (d: Uint8Array) => void,
    identity: { userId: string; ownedCarId: string | null } | null = null,
  ): HumanPlayer | null {
    if (!this.joinable) return null;
    const id = ++this.ids;
    const cfg = CAR_IDS.includes(carId) ? getCar(carId) : getCar(CAR_IDS[0]!);
    const p: HumanPlayer = {
      id,
      name: (name || `Игрок ${id}`).slice(0, 16),
      carId: cfg.id,
      cfg,
      ready: false,
      send,
      pt: newPlayerTrack(),
      state: null,
      clientStep: 0,
      rejects: 0,
      sectorStrikes: 0,
      lastCpStep: 0,
      lastCpS: 0,
      proxy: null,
      dnf: false,
      slot: this.size,
      userId: identity?.userId ?? null,
      ownedCarId: identity?.ownedCarId ?? null,
    };
    this.humans.set(id, p);
    if (!this.hostId) this.hostId = id;
    this.sendTo(p, {
      type: Msg.Welcome,
      version: PROTOCOL_VERSION,
      playerId: id,
      room: this.code,
      trackId: this.track.def.id,
      laps: this.laps,
      city: this.cityId,
    });
    this.broadcastLobby();
    return p;
  }

  leave(id: number): void {
    const p = this.humans.get(id);
    if (!p) return;
    this.humans.delete(id);
    if (p.proxy && this.sim) this.sim.removeProxy(p.proxy);
    if (this.tracker) {
      const r = this.tracker.racers.get(String(id));
      if (r && !r.finished) {
        r.dnf = true;
        this.broadcast({
          type: Msg.RaceEvent,
          event: RaceEventType.Dnf,
          playerId: id,
          step: this.tracker.step,
          value: 0,
        });
      }
    }
    if (this.hostId === id) this.hostId = [...this.humans.keys()][0] ?? 0;
    if (this.phase === 'lobby') this.reslot();
    this.broadcastLobby();
  }

  get empty(): boolean {
    return this.humans.size === 0;
  }

  private reslot(): void {
    let i = 0;
    for (const p of this.humans.values()) p.slot = i++;
  }

  handle(id: number, m: ClientMsg): void {
    const p = this.humans.get(id);
    if (!p) return;
    switch (m.type) {
      case Msg.Ready:
        p.ready = m.ready;
        this.broadcastLobby();
        this.maybeStart();
        break;
      case Msg.StartNow:
        if (id === this.hostId && this.phase === 'lobby') this.startCountdown();
        break;
      case Msg.Ping:
        this.sendTo(p, { type: Msg.Pong, t: m.t, serverStep: this.tracker?.step ?? 0 });
        break;
      case Msg.State:
        this.onState(p, m.step, m.car);
        break;
      case Msg.Leave:
        this.leave(id);
        break;
      case Msg.Hello:
        break;
    }
  }

  private maybeStart(): void {
    if (this.phase !== 'lobby') return;
    const hs = [...this.humans.values()];
    if (hs.length >= 2 && hs.every((p) => p.ready)) this.startCountdown();
  }

  /** Старт: добиваем ботами, строим физику, запускаем отсчёт. */
  startCountdown(): void {
    if (this.phase !== 'lobby' || this.humans.size === 0) return;
    this.sim = new Sim(this.R, this.track);
    const sim = this.sim;
    this.reslot();
    const toAdd = Math.max(0, Math.min(MAX_PLAYERS, this.minRacers) - this.humans.size);
    let slot = this.humans.size;
    for (let i = 0; i < toAdd; i++) {
      const carId = CAR_IDS[i % CAR_IDS.length]!;
      const vehicle = sim.addCar(getCar(carId), slot);
      const bot = new Bot(vehicle, this.track, { level: 'medium', lane: ((i % 3) - 1) * 2.5 });
      this.bots.push({
        id: 1000 + i,
        name: BOT_NAMES[i % BOT_NAMES.length]!,
        carId,
        vehicle,
        bot,
        slot,
      });
      slot++;
    }
    this.tracker = new RaceTracker(this.track, this.laps);
    for (const p of this.humans.values()) {
      const g = this.track.grid[p.slot]!;
      p.proxy = sim.addProxy(p.cfg, g.x, g.z);
      p.state = null;
      p.pt = newPlayerTrack();
      this.tracker.addRacer(String(p.id), g.x, g.z);
    }
    for (const b of this.bots) {
      const pos = b.vehicle.position;
      this.tracker.addRacer(String(b.id), pos.x, pos.z);
    }
    const others = [...sim.cars, ...sim.proxies];
    for (const b of this.bots) b.bot.others = others;
    this.phase = 'countdown';
    this.raceId = `${this.code}-${Date.now().toString(36)}`;
    this.broadcastLobby();
    this.broadcast({
      type: Msg.RaceEvent,
      event: RaceEventType.Countdown,
      playerId: 0,
      step: 0,
      value: this.tracker.startStep,
    });
  }

  private onState(p: HumanPlayer, step: number, car: CarState): void {
    const t = this.tracker;
    if (!t || p.dnf || (this.phase !== 'countdown' && this.phase !== 'racing')) return;
    // Клиент не может жить «в будущем»
    const tooEarly = step > t.step + AHEAD_TOLERANCE;
    const v = tooEarly
      ? { ok: false as const, reason: 'clock' }
      : checkState(p.pt, car, step, p.cfg, this.track);
    // В отсчёте машина должна стоять
    const movedInCountdown = t.phase === 'countdown' && Math.hypot(car.vx, car.vz) > 2;
    if (!v.ok || movedInCountdown) {
      p.rejects++;
      if (p.pt.last)
        this.sendTo(p, {
          type: Msg.Correction,
          reason: v.ok ? 'countdown' : v.reason,
          car: p.pt.last,
        });
      if (p.rejects > MAX_REJECTS) this.disqualify(p);
      return;
    }
    p.rejects = 0;
    p.pt.last = car;
    p.pt.lastStep = step;
    p.state = car;
    p.clientStep = step;
    t.updateRacer(String(p.id), car.x, car.z, car.vx, car.vz);
  }

  private disqualify(p: HumanPlayer): void {
    if (p.dnf) return;
    p.dnf = true;
    const r = this.tracker?.racers.get(String(p.id));
    if (r) r.dnf = true;
    this.broadcast({
      type: Msg.RaceEvent,
      event: RaceEventType.Dnf,
      playerId: p.id,
      step: this.tracker?.step ?? 0,
      value: 1,
    });
  }

  /** Тик сервера (30 Гц): 2 шага физики ботов, гоночная логика, снимок. */
  tick(): void {
    if (this.phase === 'lobby') {
      if (this.humans.size > 0) this.lobbySteps += STEPS_PER_TICK;
      if (this.lobbySteps >= this.botFillSteps) this.startCountdown();
      const sec = Math.floor(this.lobbySteps / PHYSICS_HZ);
      if (sec !== this.lastLobbyBroadcast) {
        this.lastLobbyBroadcast = sec;
        this.broadcastLobby();
      }
      return;
    }
    const t = this.tracker!;
    const sim = this.sim!;
    for (let k = 0; k < STEPS_PER_TICK; k++) {
      for (const p of this.humans.values()) {
        if (p.proxy && p.state) {
          const s = p.state;
          sim.moveProxy(
            p.proxy,
            { x: s.x, y: s.y, z: s.z },
            { x: s.qx, y: s.qy, z: s.qz, w: s.qw },
          );
        }
      }
      const inputs = this.bots.map((b) => {
        const r = t.racers.get(String(b.id))!;
        if (t.phase === 'countdown') return { ...emptyInput(), handbrake: 1 };
        if (r.finished) return { ...emptyInput(), brake: 0.3 };
        return b.bot.think();
      });
      sim.tick(inputs);
      for (const b of this.bots) {
        const pos = b.vehicle.position;
        const v = b.vehicle.body.linvel();
        t.updateRacer(String(b.id), pos.x, pos.z, v.x, v.z);
      }
      t.tick();
      for (const e of t.drain()) this.onRaceEvent(e);
    }
    if (t.phase === 'racing' && this.phase === 'countdown') this.phase = 'racing';
    this.broadcastSnapshot();

    // Завершение: все люди финишировали/сошли → ждём ботов ограниченное время
    const humansDone = [...this.humans.values()].every((p) => {
      const r = t.racers.get(String(p.id));
      return !r || r.finished || r.dnf;
    });
    if (this.phase === 'racing' && (t.phase === 'finished' || humansDone)) {
      if (this.finishGrace < 0) this.finishGrace = t.phase === 'finished' ? 0 : FINISH_GRACE_STEPS;
      this.finishGrace -= STEPS_PER_TICK;
      if (this.finishGrace <= 0 || t.phase === 'finished') this.finish();
    }
  }

  private onRaceEvent(e: RaceEvent): void {
    const id = e.racer ? Number(e.racer) : 0;
    const t = this.tracker!;
    const human = this.humans.get(id);
    switch (e.type) {
      case 'start':
        this.broadcast({
          type: Msg.RaceEvent,
          event: RaceEventType.Start,
          playerId: 0,
          step: e.step,
          value: 0,
        });
        break;
      case 'checkpoint': {
        if (human) {
          const cp = this.track.checkpoints[e.cp!]!;
          const from = human.lastCpStep || t.startStep;
          const fromS = human.lastCpStep ? human.lastCpS : this.track.def.startS;
          const v = checkSector(fromS, cp.s, e.step - from, human.cfg, this.track);
          if (!v.ok) {
            human.sectorStrikes++;
            if (human.sectorStrikes >= 2) this.disqualify(human);
          }
          human.lastCpStep = e.step;
          human.lastCpS = cp.s;
        }
        this.broadcast({
          type: Msg.RaceEvent,
          event: RaceEventType.Checkpoint,
          playerId: id,
          step: e.step,
          value: e.cp!,
        });
        break;
      }
      case 'lap':
        this.broadcast({
          type: Msg.RaceEvent,
          event: RaceEventType.Lap,
          playerId: id,
          step: e.step,
          value: e.lapSteps!,
        });
        break;
      case 'finish':
        this.broadcast({
          type: Msg.RaceEvent,
          event: RaceEventType.Finish,
          playerId: id,
          step: e.step,
          value: t.racers.get(e.racer)!.finishStep,
        });
        break;
      case 'overtake':
        this.broadcast({
          type: Msg.RaceEvent,
          event: RaceEventType.Overtake,
          playerId: id,
          step: e.step,
          value: Number(e.other),
        });
        break;
    }
  }

  private finish(): void {
    if (this.resultsSent) return;
    this.resultsSent = true;
    this.phase = 'finished';
    const t = this.tracker!;
    const rows = t.standings().map((r) => {
      const id = Number(r.id);
      const bot = this.bots.find((b) => b.id === id);
      const human = this.humans.get(id);
      return {
        id,
        name: bot?.name ?? human?.name ?? '—',
        position: r.position,
        finishSteps: r.finished ? r.finishStep : 0,
        bestLapSteps: r.bestLapSteps,
        bot: !!bot,
      };
    });
    this.broadcast({ type: Msg.Results, rows });
    this.broadcastLobby();
    // Итог — в API: награды всем вошедшим, рейтинг — в открытых гонках от 2 человек с аккаунтом
    const authed = [...this.humans.values()].filter((h) => h.userId);
    if (this.report && authed.length > 0) {
      this.report({
        raceId: this.raceId,
        ranked: !this.isPrivate && authed.length >= 2,
        rows: authed.map((h) => {
          const r = t.racers.get(String(h.id))!;
          return {
            userId: h.userId!,
            ownedCarId: h.ownedCarId,
            position: r.position,
            finished: r.finished,
          };
        }),
      });
    }
  }

  private snapshotEntries(): SnapshotEntry[] {
    const t = this.tracker!;
    const out: SnapshotEntry[] = [];
    for (const p of this.humans.values()) {
      if (!p.state) continue;
      const r = t.racers.get(String(p.id));
      out.push({ id: p.id, car: p.state, lap: r?.lap ?? 0, position: r?.position ?? 0 });
    }
    for (const b of this.bots) {
      const v = b.vehicle;
      const pos = v.position;
      const q = v.rotation;
      const lv = v.body.linvel();
      const tel = v.telemetry();
      const r = t.racers.get(String(b.id));
      const inp = v.lastInput;
      out.push({
        id: b.id,
        lap: r?.lap ?? 0,
        position: r?.position ?? 0,
        car: {
          x: pos.x,
          y: pos.y,
          z: pos.z,
          qx: q.x,
          qy: q.y,
          qz: q.z,
          qw: q.w,
          vx: lv.x,
          vy: lv.y,
          vz: lv.z,
          steer: v.steerAngle / ((v.cfg.steering.maxAngleDeg * Math.PI) / 180),
          rpm: tel.rpm,
          flags:
            (inp && inp.brake > 0.1 ? CarFlags.Brake : 0) | (tel.nitroActive ? CarFlags.Nitro : 0),
        },
      });
    }
    return out;
  }

  private broadcastSnapshot(): void {
    const t = this.tracker!;
    this.broadcast({
      type: Msg.Snapshot,
      step: t.step,
      startStep: t.startStep,
      entries: this.snapshotEntries(),
    });
  }

  lobbyPlayers(): LobbyPlayer[] {
    const list: LobbyPlayer[] = [...this.humans.values()]
      .sort((a, b) => a.slot - b.slot)
      .map((p) => ({
        id: p.id,
        name: p.name,
        carId: p.carId,
        ready: p.ready,
        bot: false,
        ping: 0,
      }));
    for (const b of this.bots)
      list.push({ id: b.id, name: b.name, carId: b.carId, ready: true, bot: true, ping: 0 });
    return list;
  }

  broadcastLobby(): void {
    this.broadcast({
      type: Msg.Lobby,
      phase: this.phase,
      timer:
        this.phase === 'lobby'
          ? Math.max(0, (this.botFillSteps - this.lobbySteps) / PHYSICS_HZ)
          : 0,
      hostId: this.hostId,
      players: this.lobbyPlayers(),
    });
  }

  private sendTo(p: HumanPlayer, m: ServerMsg): void {
    p.send(encodeServer(m));
  }

  broadcast(m: ServerMsg): void {
    const data = encodeServer(m);
    for (const p of this.humans.values()) p.send(data);
  }

  dispose(): void {
    this.sim?.dispose();
    this.sim = null;
  }
}
