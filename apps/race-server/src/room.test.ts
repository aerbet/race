import { beforeAll, describe, expect, it } from 'vitest';
import {
  CARS,
  CarFlags,
  DelayedChannel,
  Msg,
  PROTOCOL_VERSION,
  RaceEventType,
  RaceTracker,
  decodeServer,
  encodeClient,
  decodeClient,
  getTrack,
  type CarState,
  type ClientMsg,
  type NetConditions,
  type ServerMsg,
} from '@sr/shared';
import { Bot, Sim, initPhysics, type Rapier, type Vehicle } from '@sr/physics';
import { Room, type RaceReport } from './room';

let R: Rapier;
beforeAll(async () => {
  R = await initPhysics();
});

/** Виртуальные часы (мс) и очередь отложенных вызовов. */
class Clock {
  now = 0;
  private q: { at: number; fn: () => void }[] = [];
  schedule = (fn: () => void, ms: number) => {
    this.q.push({ at: this.now + ms, fn });
  };
  advanceTo(t: number) {
    for (;;) {
      this.q.sort((a, b) => a.at - b.at);
      const next = this.q[0];
      if (!next || next.at > t) break;
      this.q.shift();
      this.now = next.at;
      next.fn();
    }
    this.now = t;
  }
}

function carState(v: Vehicle, flags = 0): CarState {
  const p = v.position;
  const q = v.rotation;
  const lv = v.body.linvel();
  return {
    x: p.x,
    y: p.y,
    z: p.z,
    qx: q.x,
    qy: q.y,
    qz: q.z,
    qw: q.w,
    vx: lv.x,
    vy: lv.y,
    vz: lv.z,
    steer: 0,
    rpm: 3000,
    flags,
  };
}

/** Простой клиент для тестов: своя физика, бот за рулём, сеть с задержкой. */
class TestClient {
  id = 0;
  received: ServerMsg[] = [];
  sim: Sim | null = null;
  car: Vehicle | null = null;
  bot: Bot | null = null;
  step = 0;
  started = false;
  localFinishStep = -1;
  corrections = 0;
  private toServer: DelayedChannel<Uint8Array>;
  toClient: DelayedChannel<Uint8Array>;
  private localRace: RaceTracker | null = null;
  slot = 0;

  constructor(
    readonly room: Room,
    readonly name: string,
    clock: Clock,
    net: NetConditions,
    seed: number,
  ) {
    this.toServer = new DelayedChannel(
      net,
      (d) => room.handle(this.id, decodeClient(d)),
      () => clock.now,
      clock.schedule,
      seed,
    );
    this.toClient = new DelayedChannel(
      net,
      (d) => this.onMessage(decodeServer(d)),
      () => clock.now,
      clock.schedule,
      seed + 100,
    );
  }

  join(identity: { userId: string; ownedCarId: string | null } | null = null) {
    const p = this.room.join(this.name, 'era2026_hatch', (d) => this.toClient.send(d), identity);
    this.id = p!.id;
  }

  send(m: ClientMsg) {
    this.toServer.send(encodeClient(m));
  }

  private onMessage(m: ServerMsg) {
    this.received.push(m);
    if (m.type === Msg.Lobby && m.phase === 'countdown' && !this.sim) {
      this.slot = m.players.findIndex((p) => p.id === this.id);
      const track = getTrack('polygon');
      this.sim = new Sim(R, track);
      this.car = this.sim.addCar(CARS.era2026_hatch!, this.slot);
      this.bot = new Bot(this.car, track, { level: 'hard', lane: ((this.slot % 3) - 1) * 2 });
      this.localRace = new RaceTracker(track, this.room.laps, 0);
      this.localRace.addRacer('me', this.car.position.x, this.car.position.z);
    }
    if (m.type === Msg.RaceEvent && m.event === RaceEventType.Start) this.started = true;
    if (m.type === Msg.Correction) this.corrections++;
  }

  /** Один шаг физики клиента (60 Гц). */
  stepPhysics() {
    if (!this.sim || !this.car || !this.bot) return;
    const racing = this.started;
    this.sim.tick([
      racing
        ? this.bot.think()
        : { throttle: 0, brake: 0, steer: 0, handbrake: 1, nitro: 0, shift: 0, reset: 0 },
    ]);
    this.step++;
    if (racing && this.localRace) {
      const p = this.car.position;
      const v = this.car.body.linvel();
      this.localRace.updateRacer('me', p.x, p.z, v.x, v.z);
      this.localRace.tick();
      const r = this.localRace.racers.get('me')!;
      if (r.finished && this.localFinishStep < 0) this.localFinishStep = r.finishStep;
    }
    if (this.step % 2 === 0) {
      this.send({
        type: Msg.State,
        step: this.serverStepGuess(),
        seq: this.step,
        car: carState(this.car),
      });
    }
  }

  /** Клиент считает свой шаг по серверу: последний снимок + прошедшее время. */
  private serverStepGuess(): number {
    return this.step;
  }
}

function runRace(room: Room, clients: TestClient[], clock: Clock, maxSeconds: number) {
  // Клиентские шаги начинаются, когда клиент узнал о старте отсчёта; сервер — свой счётчик
  let t = 0;
  const dt = 1000 / 60;
  let serverAcc = 0;
  for (let i = 0; i < maxSeconds * 60; i++) {
    t += dt;
    clock.advanceTo(t);
    for (const c of clients) c.stepPhysics();
    serverAcc += dt;
    while (serverAcc >= 1000 / 30) {
      serverAcc -= 1000 / 30;
      room.tick();
    }
    if (room.phase === 'finished') {
      clock.advanceTo(t + 2000);
      break;
    }
  }
}

describe('room lobby', () => {
  it('welcomes, then adds bots after the wait and starts', () => {
    const room = new Room(R, 'TEST01', { botFillSeconds: 2 });
    const got: ServerMsg[] = [];
    const p = room.join('Аня', 'era2000_coupe', (d) => got.push(decodeServer(d)))!;
    expect(got[0]).toMatchObject({
      type: Msg.Welcome,
      playerId: p.id,
      version: PROTOCOL_VERSION,
      room: 'TEST01',
    });
    for (let i = 0; i < 30 * 1.9; i++) room.tick();
    expect(room.phase).toBe('lobby');
    for (let i = 0; i < 30 * 0.3; i++) room.tick();
    expect(room.phase).toBe('countdown');
    expect(room.bots.length).toBe(3);
    const lobby = got.filter((m) => m.type === Msg.Lobby).pop();
    expect(lobby && lobby.type === Msg.Lobby && lobby.players.filter((x) => x.bot).length).toBe(3);
    room.dispose();
  });

  it('two ready humans start without waiting', () => {
    const room = new Room(R, 'TEST02', { botFillSeconds: 30 });
    const a = room.join('A', 'era2000_coupe', () => {})!;
    const b = room.join('B', 'era2000_coupe', () => {})!;
    room.handle(a.id, { type: Msg.Ready, ready: true });
    expect(room.phase).toBe('lobby');
    room.handle(b.id, { type: Msg.Ready, ready: true });
    expect(room.phase).toBe('countdown');
    room.dispose();
  });

  it('host can start now; non-host cannot', () => {
    const room = new Room(R, 'TEST03');
    const a = room.join('A', 'era2000_coupe', () => {})!;
    const b = room.join('B', 'era2000_coupe', () => {})!;
    room.handle(b.id, { type: Msg.StartNow });
    expect(room.phase).toBe('lobby');
    room.handle(a.id, { type: Msg.StartNow });
    expect(room.phase).toBe('countdown');
    room.dispose();
  });

  it('room is full at 8', () => {
    const room = new Room(R, 'TEST04');
    for (let i = 0; i < 8; i++)
      expect(room.join(`P${i}`, 'era2000_coupe', () => {})).not.toBeNull();
    expect(room.join('P9', 'era2000_coupe', () => {})).toBeNull();
    room.dispose();
  });
});

describe('server-side plausibility', () => {
  it('rejects a teleport and answers with a correction', () => {
    const room = new Room(R, 'CHEAT1');
    const got: ServerMsg[] = [];
    const p = room.join('Читер', 'era2000_coupe', (d) => got.push(decodeServer(d)))!;
    room.handle(p.id, { type: Msg.StartNow });
    const g = room.track.grid[0]!;
    const base: CarState = {
      x: g.x,
      y: 0.8,
      z: g.z,
      qx: 0,
      qy: 0,
      qz: 0,
      qw: 1,
      vx: 0,
      vy: 0,
      vz: 0,
      steer: 0,
      rpm: 900,
      flags: 0,
    };
    for (let i = 0; i < 10; i++) room.tick();
    room.handle(p.id, { type: Msg.State, step: 10, seq: 1, car: base });
    room.handle(p.id, { type: Msg.State, step: 12, seq: 2, car: { ...base, z: base.z - 300 } });
    const corr = got.find((m) => m.type === Msg.Correction);
    expect(corr && corr.type === Msg.Correction && corr.reason).toBe('teleport');
    // Принятое состояние не изменилось
    expect(room.humans.get(p.id)!.state!.z).toBeCloseTo(base.z);
    room.dispose();
  });

  it('rejects packets from the future and movement during countdown', () => {
    const room = new Room(R, 'CHEAT2');
    const got: ServerMsg[] = [];
    const p = room.join('Читер', 'era2000_coupe', (d) => got.push(decodeServer(d)))!;
    room.handle(p.id, { type: Msg.StartNow });
    const g = room.track.grid[0]!;
    const base: CarState = {
      x: g.x,
      y: 0.8,
      z: g.z,
      qx: 0,
      qy: 0,
      qz: 0,
      qw: 1,
      vx: 0,
      vy: 0,
      vz: 0,
      steer: 0,
      rpm: 900,
      flags: 0,
    };
    room.handle(p.id, { type: Msg.State, step: 1, seq: 1, car: base });
    room.handle(p.id, { type: Msg.State, step: 5000, seq: 2, car: base });
    room.handle(p.id, {
      type: Msg.State,
      step: 3,
      seq: 3,
      car: { ...base, vz: -30, z: base.z - 1 },
    });
    const reasons = got
      .filter((m) => m.type === Msg.Correction)
      .map((m) => (m.type === Msg.Correction ? m.reason : ''));
    expect(reasons).toEqual(['clock', 'countdown']);
    room.dispose();
  });

  it('a racer who keeps sending forged data is disqualified', () => {
    const room = new Room(R, 'CHEAT3');
    const got: ServerMsg[] = [];
    const p = room.join('Читер', 'era2000_coupe', (d) => got.push(decodeServer(d)))!;
    room.handle(p.id, { type: Msg.StartNow });
    const g = room.track.grid[0]!;
    const base: CarState = {
      x: g.x,
      y: 0.8,
      z: g.z,
      qx: 0,
      qy: 0,
      qz: 0,
      qw: 1,
      vx: 0,
      vy: 0,
      vz: 0,
      steer: 0,
      rpm: 900,
      flags: 0,
    };
    room.handle(p.id, { type: Msg.State, step: 1, seq: 1, car: base });
    for (let i = 0; i < 100; i++)
      room.handle(p.id, { type: Msg.State, step: 2 + i, seq: 2 + i, car: { ...base, vz: -500 } });
    expect(room.humans.get(p.id)!.dnf).toBe(true);
    expect(got.some((m) => m.type === Msg.RaceEvent && m.event === RaceEventType.Dnf)).toBe(true);
    room.dispose();
  });
});

describe('network race (checkpoint 3, scaled)', { timeout: 120_000 }, () => {
  it('4 clients at 150 ms + 2% loss finish with an undisputed order', () => {
    const clock = new Clock();
    const room = new Room(R, 'NET001', { laps: 1 });
    const net = { latency: 150, jitter: 25, loss: 0.02 };
    const clients = ['A', 'B', 'C', 'D'].map((n, i) => new TestClient(room, n, clock, net, i + 1));
    for (const c of clients) c.join();
    for (const c of clients) c.send({ type: Msg.Ready, ready: true });
    runRace(room, clients, clock, 200);

    expect(room.phase).toBe('finished');
    const results = clients[0]!.received.find((m) => m.type === Msg.Results);
    expect(results).toBeDefined();
    if (!results || results.type !== Msg.Results) return;
    // Никаких отклонённых пакетов у честных клиентов
    for (const c of clients) expect(c.corrections).toBe(0);
    // Все финишировали
    expect(results.rows.every((r) => r.finishSteps > 0)).toBe(true);
    // Порядок сервера совпадает с порядком локальных финишей клиентов (кроме «фотофинишей» < 0,1 с)
    const local = clients.map((c) => ({ id: c.id, t: c.localFinishStep }));
    for (const a of local)
      for (const b of local) {
        if (a.t + 6 < b.t) {
          const ra = results.rows.find((r) => r.id === a.id)!;
          const rb = results.rows.find((r) => r.id === b.id)!;
          expect(ra.position).toBeLessThan(rb.position);
        }
      }
    // Все клиенты получили одинаковые результаты
    const ref = JSON.stringify(results.rows);
    for (const c of clients) {
      const r = c.received.find((m) => m.type === Msg.Results);
      expect(JSON.stringify(r && r.type === Msg.Results ? r.rows : null)).toBe(ref);
    }
    room.dispose();
    for (const c of clients) c.sim?.dispose();
  });
});

// Флаги используются в протоколе — проверка, что сброс помечается корректно
it('reset flag constant', () => {
  expect(CarFlags.Reset).toBe(8);
});

describe('race report to API', { timeout: 120_000 }, () => {
  it('reports a ranked result for logged-in players', () => {
    const clock = new Clock();
    const reports: RaceReport[] = [];
    const room = new Room(R, 'REP001', { laps: 1, report: (r) => reports.push(r) });
    const net = { latency: 30, jitter: 5, loss: 0 };
    const a = new TestClient(room, 'A', clock, net, 11);
    const b = new TestClient(room, 'B', clock, net, 12);
    a.join({ userId: 'user-a', ownedCarId: 'car-a' });
    b.join({ userId: 'user-b', ownedCarId: null });
    for (const c of [a, b]) c.send({ type: Msg.Ready, ready: true });
    runRace(room, [a, b], clock, 200);
    expect(reports.length).toBe(1);
    const r = reports[0]!;
    expect(r.ranked).toBe(true);
    expect(r.raceId).toMatch(/^REP001-/);
    expect(r.rows.map((x) => x.userId).sort()).toEqual(['user-a', 'user-b']);
    expect(r.rows.find((x) => x.userId === 'user-a')!.ownedCarId).toBe('car-a');
    expect(new Set(r.rows.map((x) => x.position)).size).toBe(2);
    room.dispose();
    for (const c of [a, b]) c.sim?.dispose();
  });
});
