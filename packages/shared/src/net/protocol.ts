import { ProtocolError, Reader, Writer } from './codec';

/** Версия протокола. Меняется при любом несовместимом изменении формата. */
export const PROTOCOL_VERSION = 2;
/** Частота сервера, Гц (снимки и обработка). */
export const SERVER_TICK_HZ = 30;
/** Частота отправки состояния клиентом, Гц. */
export const CLIENT_SEND_HZ = 30;
export const MAX_PLAYERS = 8;
/** Свободная езда: игроков в одной зоне. */
export const MAX_FREEROAM = 16;
/** Через сколько секунд ожидания в комнату добавляются боты. */
export const BOT_FILL_SECONDS = 30;

export enum Msg {
  // Клиент → сервер
  Hello = 1,
  Ready = 2,
  State = 3,
  Ping = 4,
  Leave = 5,
  StartNow = 6,
  /** Вызов на гонку (мигнул фарами рядом с игроком). */
  Challenge = 7,
  ChallengeReply = 8,
  // Сервер → клиент
  Welcome = 64,
  Lobby = 65,
  Snapshot = 66,
  RaceEvent = 67,
  Results = 68,
  Pong = 69,
  Correction = 70,
  Error = 71,
  ChallengeInvite = 72,
  ChallengeStart = 73,
}

export type JoinMode = 'quick' | 'create' | 'join' | 'freeroam';

export interface HelloMsg {
  type: Msg.Hello;
  version: number;
  name: string;
  carId: string;
  mode: JoinMode;
  /** Код приватной комнаты (для join). */
  room: string;
}

/** Флаги состояния машины. */
export const enum CarFlags {
  Brake = 1,
  Nitro = 2,
  Handbrake = 4,
  /** Машина была сброшена на трассу (разрешённый «телепорт»). */
  Reset = 8,
  Finished = 16,
  /** Мигание фарами (вызов на гонку). */
  Lights = 32,
}

/** Состояние машины — и в пакете клиента, и в снимке сервера. */
export interface CarState {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  vx: number;
  vy: number;
  vz: number;
  /** −1..1 */
  steer: number;
  rpm: number;
  flags: number;
}

export interface StateMsg {
  type: Msg.State;
  /** Номер шага физики клиента от старта гонки. */
  step: number;
  seq: number;
  car: CarState;
}

export interface PingMsg {
  type: Msg.Ping;
  t: number;
}

export interface WelcomeMsg {
  type: Msg.Welcome;
  version: number;
  playerId: number;
  room: string;
  trackId: string;
  laps: number;
  /** Город (пусто — полигон). */
  city: string;
}

export interface LobbyPlayer {
  id: number;
  name: string;
  carId: string;
  ready: boolean;
  bot: boolean;
  ping: number;
}

export type RoomPhase = 'lobby' | 'countdown' | 'racing' | 'finished' | 'freeroam';
export const ROOM_PHASES: RoomPhase[] = ['lobby', 'countdown', 'racing', 'finished', 'freeroam'];

export interface LobbyMsg {
  type: Msg.Lobby;
  phase: RoomPhase;
  /** Секунд до автодобавления ботов / до старта. */
  timer: number;
  hostId: number;
  players: LobbyPlayer[];
}

export interface SnapshotEntry {
  id: number;
  car: CarState;
  lap: number;
  position: number;
}

export interface SnapshotMsg {
  type: Msg.Snapshot;
  /** Серверный шаг гонки (60 Гц) — ось времени для интерполяции. */
  step: number;
  /** Шаг старта (для обратного отсчёта на клиенте). */
  startStep: number;
  entries: SnapshotEntry[];
}

export enum RaceEventType {
  Countdown = 1,
  Start = 2,
  Checkpoint = 3,
  Lap = 4,
  Finish = 5,
  Overtake = 6,
  Dnf = 7,
}

export interface RaceEventMsg {
  type: Msg.RaceEvent;
  event: RaceEventType;
  playerId: number;
  step: number;
  value: number;
}

export interface ResultRowNet {
  id: number;
  name: string;
  position: number;
  /** Время финиша в шагах; 0 — не финишировал. */
  finishSteps: number;
  bestLapSteps: number;
  bot: boolean;
}

export interface ResultsMsg {
  type: Msg.Results;
  rows: ResultRowNet[];
}

export interface PongMsg {
  type: Msg.Pong;
  t: number;
  serverStep: number;
}

export interface CorrectionMsg {
  type: Msg.Correction;
  reason: string;
  car: CarState;
}

export interface ErrorMsg {
  type: Msg.Error;
  code: string;
  message: string;
}

export type ClientMsg =
  | HelloMsg
  | { type: Msg.Ready; ready: boolean }
  | StateMsg
  | PingMsg
  | { type: Msg.Leave }
  | { type: Msg.StartNow }
  | { type: Msg.Challenge; target: number }
  | { type: Msg.ChallengeReply; from: number; accept: boolean };

export interface ChallengeInviteMsg {
  type: Msg.ChallengeInvite;
  from: number;
  name: string;
  trackId: string;
}

/** Обе стороны согласились: идём в приватную комнату гонки. */
export interface ChallengeStartMsg {
  type: Msg.ChallengeStart;
  room: string;
  trackId: string;
}

export type ServerMsg =
  | WelcomeMsg
  | LobbyMsg
  | SnapshotMsg
  | RaceEventMsg
  | ResultsMsg
  | PongMsg
  | CorrectionMsg
  | ErrorMsg
  | ChallengeInviteMsg
  | ChallengeStartMsg;

// --- машина: 12×f32 позиции/скорости заменены на компактный формат: 41 байт
function writeCar(w: Writer, c: CarState): void {
  w.f32(c.x).f32(c.y).f32(c.z);
  w.i16(c.qx * 32767)
    .i16(c.qy * 32767)
    .i16(c.qz * 32767)
    .i16(c.qw * 32767);
  w.i16(c.vx * 100)
    .i16(c.vy * 100)
    .i16(c.vz * 100);
  w.i8(c.steer * 127);
  w.u16(c.rpm);
  w.u8(c.flags);
}

function readCar(r: Reader): CarState {
  return {
    x: r.f32(),
    y: r.f32(),
    z: r.f32(),
    qx: r.i16() / 32767,
    qy: r.i16() / 32767,
    qz: r.i16() / 32767,
    qw: r.i16() / 32767,
    vx: r.i16() / 100,
    vy: r.i16() / 100,
    vz: r.i16() / 100,
    steer: r.i8() / 127,
    rpm: r.u16(),
    flags: r.u8(),
  };
}

const JOIN_MODES: JoinMode[] = ['quick', 'create', 'join', 'freeroam'];

export function encodeClient(m: ClientMsg): Uint8Array {
  const w = new Writer(64);
  w.u8(m.type);
  switch (m.type) {
    case Msg.Hello:
      w.u16(m.version).str(m.name).str(m.carId).u8(JOIN_MODES.indexOf(m.mode)).str(m.room);
      break;
    case Msg.Ready:
      w.u8(m.ready ? 1 : 0);
      break;
    case Msg.State:
      w.u32(m.step).u32(m.seq);
      writeCar(w, m.car);
      break;
    case Msg.Ping:
      w.f64(m.t);
      break;
    case Msg.Leave:
    case Msg.StartNow:
      break;
    case Msg.Challenge:
      w.u16(m.target);
      break;
    case Msg.ChallengeReply:
      w.u16(m.from).u8(m.accept ? 1 : 0);
      break;
  }
  return w.finish();
}

export function decodeClient(data: Uint8Array): ClientMsg {
  const r = new Reader(data);
  const type = r.u8();
  switch (type) {
    case Msg.Hello: {
      const version = r.u16();
      const name = r.str();
      const carId = r.str();
      const mode = JOIN_MODES[r.u8()];
      if (!mode) throw new ProtocolError('неизвестный режим входа');
      return { type, version, name, carId, mode, room: r.str() };
    }
    case Msg.Ready:
      return { type, ready: r.u8() === 1 };
    case Msg.State:
      return { type, step: r.u32(), seq: r.u32(), car: readCar(r) };
    case Msg.Ping:
      return { type, t: r.f64() };
    case Msg.Leave:
      return { type };
    case Msg.StartNow:
      return { type };
    case Msg.Challenge:
      return { type, target: r.u16() };
    case Msg.ChallengeReply:
      return { type, from: r.u16(), accept: r.u8() === 1 };
    default:
      throw new ProtocolError(`неизвестный тип сообщения клиента: ${type}`);
  }
}

export function encodeServer(m: ServerMsg): Uint8Array {
  const w = new Writer(128);
  w.u8(m.type);
  switch (m.type) {
    case Msg.Welcome:
      w.u16(m.version).u16(m.playerId).str(m.room).str(m.trackId).u8(m.laps).str(m.city);
      break;
    case Msg.Lobby:
      w.u8(ROOM_PHASES.indexOf(m.phase)).f32(m.timer).u16(m.hostId).u8(m.players.length);
      for (const p of m.players) {
        w.u16(p.id)
          .str(p.name)
          .str(p.carId)
          .u8((p.ready ? 1 : 0) | (p.bot ? 2 : 0))
          .u16(p.ping);
      }
      break;
    case Msg.Snapshot:
      w.u32(m.step).u32(m.startStep).u8(m.entries.length);
      for (const e of m.entries) {
        w.u16(e.id).u8(e.lap).u8(e.position);
        writeCar(w, e.car);
      }
      break;
    case Msg.RaceEvent:
      w.u8(m.event).u16(m.playerId).u32(m.step).f64(m.value);
      break;
    case Msg.Results:
      w.u8(m.rows.length);
      for (const r of m.rows) {
        w.u16(r.id)
          .str(r.name)
          .u8(r.position)
          .u32(r.finishSteps)
          .u32(r.bestLapSteps)
          .u8(r.bot ? 1 : 0);
      }
      break;
    case Msg.Pong:
      w.f64(m.t).u32(m.serverStep);
      break;
    case Msg.Correction:
      w.str(m.reason);
      writeCar(w, m.car);
      break;
    case Msg.Error:
      w.str(m.code).str(m.message);
      break;
    case Msg.ChallengeInvite:
      w.u16(m.from).str(m.name).str(m.trackId);
      break;
    case Msg.ChallengeStart:
      w.str(m.room).str(m.trackId);
      break;
  }
  return w.finish();
}

export function decodeServer(data: Uint8Array): ServerMsg {
  const r = new Reader(data);
  const type = r.u8();
  switch (type) {
    case Msg.Welcome:
      return {
        type,
        version: r.u16(),
        playerId: r.u16(),
        room: r.str(),
        trackId: r.str(),
        laps: r.u8(),
        city: r.str(),
      };
    case Msg.Lobby: {
      const phase = ROOM_PHASES[r.u8()] ?? 'lobby';
      const timer = r.f32();
      const hostId = r.u16();
      const n = r.u8();
      const players: LobbyPlayer[] = [];
      for (let i = 0; i < n; i++) {
        const id = r.u16();
        const name = r.str();
        const carId = r.str();
        const f = r.u8();
        players.push({ id, name, carId, ready: !!(f & 1), bot: !!(f & 2), ping: r.u16() });
      }
      return { type, phase, timer, hostId, players };
    }
    case Msg.Snapshot: {
      const step = r.u32();
      const startStep = r.u32();
      const n = r.u8();
      const entries: SnapshotEntry[] = [];
      for (let i = 0; i < n; i++) {
        const id = r.u16();
        const lap = r.u8();
        const position = r.u8();
        entries.push({ id, lap, position, car: readCar(r) });
      }
      return { type, step, startStep, entries };
    }
    case Msg.RaceEvent:
      return {
        type,
        event: r.u8() as RaceEventType,
        playerId: r.u16(),
        step: r.u32(),
        value: r.f64(),
      };
    case Msg.Results: {
      const n = r.u8();
      const rows: ResultRowNet[] = [];
      for (let i = 0; i < n; i++) {
        rows.push({
          id: r.u16(),
          name: r.str(),
          position: r.u8(),
          finishSteps: r.u32(),
          bestLapSteps: r.u32(),
          bot: r.u8() === 1,
        });
      }
      return { type, rows };
    }
    case Msg.Pong:
      return { type, t: r.f64(), serverStep: r.u32() };
    case Msg.Correction:
      return { type, reason: r.str(), car: readCar(r) };
    case Msg.Error:
      return { type, code: r.str(), message: r.str() };
    case Msg.ChallengeInvite:
      return { type, from: r.u16(), name: r.str(), trackId: r.str() };
    case Msg.ChallengeStart:
      return { type, room: r.str(), trackId: r.str() };
    default:
      throw new ProtocolError(`неизвестный тип сообщения сервера: ${type}`);
  }
}
