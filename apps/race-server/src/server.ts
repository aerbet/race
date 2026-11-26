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
import { Room, type RaceReport } from './room';
import { verifyJwt } from './auth';
import { FreeRoam } from './freeroam';
import { verifyRun, type VerifyRequest } from './verify';
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
  /** Ключ для внутренних вызовов (проверка рекордов из API). */
  internalKey?: string;
  /** Базовый адрес API (итоги гонок); без него награды не начисляются. */
  apiUrl?: string;
  /** Секрет JWT API — для проверки токена игрока. */
  jwtSecret?: string;
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
    readonly opts: {
      botFillSeconds?: number;
      cities?: City[];
      report?: (r: RaceReport) => void;
    } = {},
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
      report: this.opts.report,
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
    const r = new Room(this.R, code, {
      isPrivate,
      botFillSeconds: this.opts.botFillSeconds,
      report: this.opts.report,
    });
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

const DEV_JWT = 'dev-only-secret-change-me-0123456789abcdef';
const DEV_INTERNAL = 'dev-internal-key';

/**
 * Секреты сервера. В продакшене (NODE_ENV=production) — только из окружения и не dev-значения:
 * иначе по значению из репозитория можно подделать вход (PLAN_V2 7.0.2).
 */
export function resolveSecrets(
  env: Record<string, string | undefined>,
  opts: { internalKey?: string; jwtSecret?: string } = {},
): { internalKey: string; jwtSecret: string } {
  const prod = env.NODE_ENV === 'production';
  const internalKey = opts.internalKey ?? env.INTERNAL_KEY ?? (prod ? '' : DEV_INTERNAL);
  const jwtSecret = opts.jwtSecret ?? env.JWT_SECRET ?? (prod ? '' : DEV_JWT);
  if (prod) {
    if (Buffer.byteLength(jwtSecret) < 32 || jwtSecret === DEV_JWT)
      throw new Error(
        'JWT_SECRET не задан или это значение для разработки — в production запуск запрещён',
      );
    if (internalKey.length < 16 || internalKey === DEV_INTERNAL)
      throw new Error(
        'INTERNAL_KEY не задан или это значение для разработки — в production запуск запрещён',
      );
  }
  return { internalKey, jwtSecret };
}

export function startServer(
  R: Rapier,
  opts: ServerOptions,
): { http: Server; wss: WebSocketServer; manager: RoomManager; stop: () => void } {
  const log = opts.log ?? ((m: string) => console.log(`[race-server] ${m}`));
  const apiUrl = opts.apiUrl ?? process.env.API_URL;
  const { internalKey, jwtSecret } = resolveSecrets(process.env, opts);
  const report = (r: RaceReport) => {
    if (!apiUrl) return;
    fetch(`${apiUrl}/internal/race-results`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-key': internalKey },
      body: JSON.stringify(r),
    }).catch((e: unknown) => log(`не удалось отправить итог гонки ${r.raceId}: ${String(e)}`));
  };
  const manager = new RoomManager(R, {
    report,
    botFillSeconds: opts.botFillSeconds,
    cities: opts.cities ?? loadCities(),
  });
  const http = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: manager.rooms.size, protocol: PROTOCOL_VERSION }));
      return;
    }
    if (req.url === '/verify' && req.method === 'POST') {
      if (req.headers['x-internal-key'] !== internalKey) {
        res.writeHead(403);
        res.end();
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > 2_000_000) req.destroy();
        else chunks.push(c);
      });
      req.on('end', () => {
        let out;
        try {
          out = verifyRun(
            R,
            manager.cities,
            JSON.parse(Buffer.concat(chunks).toString('utf8')) as VerifyRequest,
          );
        } catch {
          out = { ok: false, error: 'bad_request' };
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(out));
      });
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
        const who = verifyJwt(msg.token, jwtSecret);
        const identity = who ? { userId: who.userId, ownedCarId: msg.ownedCarId || null } : null;
        const p =
          target instanceof Room
            ? target.join(msg.name, msg.carId, send, identity)
            : target.join(msg.name, msg.carId, send);
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
