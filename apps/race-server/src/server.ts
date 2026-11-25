import { WebSocketServer, type WebSocket } from 'ws';
import { createServer, type Server } from 'node:http';
import {
  DelayedChannel,
  Msg,
  PROTOCOL_VERSION,
  SERVER_TICK_HZ,
  decodeClient,
  parseCity,
  registerTrack,
  type City,
  encodeServer,
  type NetConditions,
} from '@sr/shared';
import type { Rapier } from '@sr/physics';
import { Room } from './room';
import { FreeRoam } from './freeroam';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ServerOptions {
  port: number;
  /** Симуляция плохой сети на исходящих (dev). */
  net?: NetConditions;
  botFillSeconds?: number;
  log?: (msg: string) => void;
  cities?: City[];
}

/** Города берём из того же места, откуда их раздаёт клиент. */
export function loadCities(
  dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../client/public/cities'),
): City[] {
  if (!existsSync(dir)) return [];
  const out: City[] = [];
  for (const id of readdirSync(dir)) {
    const f = join(dir, id, 'city.json');
    if (existsSync(f)) out.push(parseCity(JSON.parse(readFileSync(f, 'utf8'))));
  }
  return out;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeCode(): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

/** Менеджер комнат: быстрый поиск, приватные комнаты по коду. */
export class RoomManager {
  readonly rooms = new Map<string, Room>();
  readonly freeroams = new Map<string, FreeRoam>();
  readonly cities = new Map<string, City>();

  constructor(
    readonly R: Rapier,
    readonly opts: { botFillSeconds?: number; cities?: City[] } = {},
  ) {
    for (const c of opts.cities ?? []) {
      this.cities.set(c.id, c);
      for (const t of c.tracks) registerTrack(t);
    }
  }

  /** Свободная езда: зона города с местом; при заполнении создаётся следующая. */
  freeroam(cityId: string): FreeRoam | undefined {
    const city = this.cities.get(cityId);
    if (!city) return undefined;
    for (const f of this.freeroams.values()) if (f.city.id === cityId && !f.full) return f;
    let code = makeCode();
    while (this.freeroams.has(code) || this.rooms.has(code)) code = makeCode();
    const f = new FreeRoam(city, code, (trackId, cid) => this.createRace(trackId, cid));
    this.freeroams.set(code, f);
    return f;
  }

  /** Приватная гонка-вызов на городской трассе (2 человека, без ботов). */
  createRace(trackId: string, cityId: string): Room {
    let code = makeCode();
    while (this.rooms.has(code)) code = makeCode();
    const r = new Room(this.R, code, {
      isPrivate: true,
      trackId,
      cityId,
      laps: 1,
      botFillSeconds: 60,
      minRacers: 2,
    });
    this.rooms.set(code, r);
    return r;
  }

  quick(): Room {
    for (const r of this.rooms.values()) if (!r.isPrivate && r.joinable) return r;
    return this.create(false);
  }

  create(isPrivate: boolean): Room {
    let code = makeCode();
    while (this.rooms.has(code)) code = makeCode();
    const r = new Room(this.R, code, { isPrivate, botFillSeconds: this.opts.botFillSeconds });
    this.rooms.set(code, r);
    return r;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  tick(): void {
    for (const [code, f] of this.freeroams) {
      f.tick();
      if (f.empty) this.freeroams.delete(code);
    }
    for (const [code, r] of this.rooms) {
      r.tick();
      if (r.empty && (r.phase !== 'lobby' || r.lobbySteps > 0)) {
        r.dispose();
        this.rooms.delete(code);
      }
    }
  }
}

export function startServer(
  R: Rapier,
  opts: ServerOptions,
): { http: Server; wss: WebSocketServer; manager: RoomManager; stop: () => void } {
  const log = opts.log ?? ((m: string) => console.log(`[race-server] ${m}`));
  const manager = new RoomManager(R, {
    botFillSeconds: opts.botFillSeconds,
    cities: opts.cities ?? loadCities(),
  });
  const http = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: manager.rooms.size, protocol: PROTOCOL_VERSION }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const wss = new WebSocketServer({ server: http, maxPayload: 4096 });

  wss.on('connection', (ws: WebSocket) => {
    let room: Pick<Room, 'handle' | 'leave' | 'code'> | null = null;
    let playerId = 0;
    const out = new DelayedChannel<Uint8Array>(
      opts.net ?? { latency: 0, jitter: 0, loss: 0 },
      (d) => {
        if (ws.readyState === ws.OPEN) ws.send(d);
      },
    );
    const send = (d: Uint8Array) => out.send(d);
    const fail = (code: string, message: string) => {
      send(encodeServer({ type: Msg.Error, code, message }));
      setTimeout(() => ws.close(), 50);
    };

    ws.on('message', (raw: Buffer, isBinary: boolean) => {
      if (!isBinary) return fail('format', 'ожидаются бинарные сообщения');
      let msg;
      try {
        msg = decodeClient(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
      } catch {
        return fail('protocol', 'некорректное сообщение');
      }
      if (!room) {
        if (msg.type !== Msg.Hello) return fail('protocol', 'сначала Hello');
        if (msg.version !== PROTOCOL_VERSION)
          return fail(
            'version',
            `версия протокола ${msg.version}, сервер ждёт ${PROTOCOL_VERSION} — обновите страницу`,
          );
        const target =
          msg.mode === 'freeroam'
            ? manager.freeroam(msg.room)
            : msg.mode === 'join'
              ? manager.get(msg.room)
              : msg.mode === 'create'
                ? manager.create(true)
                : manager.quick();
        if (!target) return fail('room', 'комната не найдена');
        const p = target.join(msg.name, msg.carId, send);
        if (!p) return fail('room', 'комната заполнена или гонка уже идёт');
        room = target;
        playerId = p.id;
        log(`игрок ${p.id} «${p.name}» → комната ${room.code}`);
        return;
      }
      room.handle(playerId, msg);
    });

    ws.on('close', () => {
      if (room) {
        room.leave(playerId);
        log(`игрок ${playerId} вышел из ${room.code}`);
      }
    });
    ws.on('error', () => ws.close());
  });

  const timer = setInterval(() => manager.tick(), 1000 / SERVER_TICK_HZ);
  http.listen(opts.port);
  log(`слушаю :${opts.port} (протокол v${PROTOCOL_VERSION})`);
  return {
    http,
    wss,
    manager,
    stop: () => {
      clearInterval(timer);
      wss.close();
      http.close();
    },
  };
}
