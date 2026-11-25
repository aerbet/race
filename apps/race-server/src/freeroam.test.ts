import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CarFlags,
  MAX_FREEROAM,
  Msg,
  decodeServer,
  parseCity,
  type CarState,
  type ServerMsg,
} from '@sr/shared';
import { initPhysics, type Rapier } from '@sr/physics';
import { RoomManager } from './server';

let R: Rapier;
beforeAll(async () => {
  R = await initPhysics();
});

const city = parseCity(
  JSON.parse(
    readFileSync(
      new URL('../../client/public/cities/moscow_synth/city.json', import.meta.url),
      'utf8',
    ),
  ),
);
const road = city.roads[0]!.points[3]!;
const at = (x: number, z: number, p: Partial<CarState> = {}): CarState => ({
  x,
  y: 0.8,
  z,
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
  ...p,
});

function client(m: RoomManager) {
  const got: ServerMsg[] = [];
  const zone = m.freeroam('moscow_synth')!;
  const p = zone.join('П', 'era2000_coupe', (d) => got.push(decodeServer(d)))!;
  return {
    zone,
    id: p.id,
    got,
    last: <T extends Msg>(t: T) =>
      got.filter((x) => x.type === t).pop() as Extract<ServerMsg, { type: T }> | undefined,
  };
}

describe('free roam', () => {
  it('welcomes with city id and streams snapshots of everyone', () => {
    const m = new RoomManager(R, { cities: [city] });
    const a = client(m);
    const b = client(m);
    expect(a.zone).toBe(b.zone);
    expect(a.last(Msg.Welcome)).toMatchObject({ city: 'moscow_synth', laps: 0 });
    a.zone.handle(a.id, { type: Msg.State, step: 1, seq: 1, car: at(road[0], road[1]) });
    b.zone.handle(b.id, { type: Msg.State, step: 1, seq: 1, car: at(road[0] + 10, road[1]) });
    m.tick();
    expect(
      b
        .last(Msg.Snapshot)!
        .entries.map((e) => e.id)
        .sort(),
    ).toEqual([a.id, b.id].sort());
    expect(b.last(Msg.Lobby)!.phase).toBe('freeroam');
  });

  it('opens a new zone after 16 players', () => {
    const m = new RoomManager(R, { cities: [city] });
    const first = client(m).zone;
    for (let i = 1; i < MAX_FREEROAM; i++) client(m);
    expect(client(m).zone).not.toBe(first);
  });

  it('teleport is rejected, reset onto a street is allowed', () => {
    const m = new RoomManager(R, { cities: [city] });
    const a = client(m);
    a.zone.handle(a.id, { type: Msg.State, step: 1, seq: 1, car: at(road[0], road[1]) });
    a.zone.handle(a.id, { type: Msg.State, step: 3, seq: 2, car: at(road[0] + 400, road[1]) });
    expect(a.last(Msg.Correction)?.reason).toBe('teleport');
    const other = city.roads[5]!.points[1]!;
    a.zone.handle(a.id, {
      type: Msg.State,
      step: 5,
      seq: 3,
      car: at(other[0], other[1], { flags: CarFlags.Reset }),
    });
    expect(a.got.filter((x) => x.type === Msg.Correction).length).toBe(1);
  });

  it('headlight challenge: invite in range → accept → both get the same race room', () => {
    const m = new RoomManager(R, { cities: [city] });
    const a = client(m);
    const b = client(m);
    a.zone.handle(a.id, { type: Msg.State, step: 1, seq: 1, car: at(road[0], road[1]) });
    b.zone.handle(b.id, { type: Msg.State, step: 1, seq: 1, car: at(road[0] + 20, road[1]) });
    a.zone.handle(a.id, { type: Msg.Challenge, target: b.id });
    const inv = b.last(Msg.ChallengeInvite)!;
    expect(inv).toMatchObject({ from: a.id });
    expect(city.tracks.map((t) => t.id)).toContain(inv.trackId);
    b.zone.handle(b.id, { type: Msg.ChallengeReply, from: a.id, accept: true });
    const sa = a.last(Msg.ChallengeStart)!;
    const sb = b.last(Msg.ChallengeStart)!;
    expect(sa.room).toBe(sb.room);
    const room = m.get(sa.room)!;
    expect(room.track.def.id).toBe(inv.trackId);
    expect(room.cityId).toBe('moscow_synth');
    // Двое готовы → старт без ботов
    const ga = room.join('A', 'era2000_coupe', () => {})!;
    const gb = room.join('B', 'era2000_coupe', () => {})!;
    room.handle(ga.id, { type: Msg.Ready, ready: true });
    room.handle(gb.id, { type: Msg.Ready, ready: true });
    expect(room.phase).toBe('countdown');
    expect(room.bots.length).toBe(0);
    room.dispose();
  });

  it('no invite when too far, declined invite starts nothing', () => {
    const m = new RoomManager(R, { cities: [city] });
    const a = client(m);
    const b = client(m);
    a.zone.handle(a.id, { type: Msg.State, step: 1, seq: 1, car: at(road[0], road[1]) });
    b.zone.handle(b.id, { type: Msg.State, step: 1, seq: 1, car: at(road[0] + 300, road[1]) });
    a.zone.handle(a.id, { type: Msg.Challenge, target: b.id });
    expect(b.last(Msg.ChallengeInvite)).toBeUndefined();
    b.zone.handle(b.id, {
      type: Msg.State,
      step: 3,
      seq: 2,
      car: at(road[0] + 15, road[1], { vx: 0 }),
    });
    // Слишком большой прыжок — коррекция; ставим рядом через новый вход
    const c = client(m);
    c.zone.handle(c.id, { type: Msg.State, step: 1, seq: 1, car: at(road[0] + 10, road[1]) });
    a.zone.handle(a.id, { type: Msg.Challenge, target: c.id });
    c.zone.handle(c.id, { type: Msg.ChallengeReply, from: a.id, accept: false });
    expect(a.last(Msg.ChallengeStart)).toBeUndefined();
  });
});
