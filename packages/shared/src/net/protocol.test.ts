import { describe, expect, it } from 'vitest';
import {
  CarFlags,
  Msg,
  PROTOCOL_VERSION,
  RaceEventType,
  decodeClient,
  decodeServer,
  encodeClient,
  encodeServer,
  type CarState,
  type ClientMsg,
  type ServerMsg,
} from './protocol';
import { ProtocolError } from './codec';

const car: CarState = {
  x: 123.25,
  y: 0.75,
  z: -321.5,
  qx: 0,
  qy: 0.3826834,
  qz: 0,
  qw: 0.9238795,
  vx: 25.5,
  vy: -0.25,
  vz: -40.12,
  steer: -0.5,
  rpm: 6543,
  flags: CarFlags.Nitro | CarFlags.Brake,
};

function closeCar(a: CarState, b: CarState) {
  expect(a.x).toBeCloseTo(b.x, 3);
  expect(a.z).toBeCloseTo(b.z, 3);
  expect(a.qy).toBeCloseTo(b.qy, 3);
  expect(a.qw).toBeCloseTo(b.qw, 3);
  expect(a.vx).toBeCloseTo(b.vx, 1);
  expect(a.vz).toBeCloseTo(b.vz, 1);
  expect(a.steer).toBeCloseTo(b.steer, 1);
  expect(a.rpm).toBe(b.rpm);
  expect(a.flags).toBe(b.flags);
}

describe('protocol', () => {
  it('client messages round-trip', () => {
    const msgs: ClientMsg[] = [
      {
        type: Msg.Hello,
        version: PROTOCOL_VERSION,
        name: 'Игрок ✓',
        carId: 'era2000_coupe',
        mode: 'join',
        room: 'ABC123',
        token: 'eyJ' + 'x'.repeat(400),
        ownedCarId: '9b2f7c1e-0000-4000-8000-000000000001',
      },
      { type: Msg.Ready, ready: true },
      { type: Msg.Ping, t: 123456.789 },
      { type: Msg.Leave },
      { type: Msg.StartNow },
      { type: Msg.Challenge, target: 12 },
      { type: Msg.ChallengeReply, from: 3, accept: true },
      {
        type: Msg.Hello,
        version: PROTOCOL_VERSION,
        name: 'x',
        carId: 'c',
        mode: 'freeroam',
        room: 'moscow_synth',
        token: '',
        ownedCarId: '',
      },
    ];
    for (const m of msgs) expect(decodeClient(encodeClient(m))).toEqual(m);
    const st = decodeClient(encodeClient({ type: Msg.State, step: 4321, seq: 99, car }));
    expect(st.type).toBe(Msg.State);
    if (st.type === Msg.State) {
      expect(st.step).toBe(4321);
      closeCar(st.car, car);
    }
  });

  it('server messages round-trip', () => {
    const msgs: ServerMsg[] = [
      {
        type: Msg.Welcome,
        version: PROTOCOL_VERSION,
        playerId: 7,
        room: 'XYZ',
        trackId: 'polygon',
        laps: 3,
        city: 'moscow_synth',
      },
      { type: Msg.ChallengeInvite, from: 4, name: 'Вега', trackId: 'msk_sprint' },
      { type: Msg.ChallengeStart, room: 'ABC123', trackId: 'msk_sprint' },
      {
        type: Msg.Lobby,
        phase: 'countdown',
        timer: 12.5,
        hostId: 7,
        players: [
          { id: 7, name: 'А', carId: 'era2026_hatch', ready: true, bot: false, ping: 42 },
          { id: 8, name: 'Бот', carId: 'era2000_coupe', ready: true, bot: true, ping: 0 },
        ],
      },
      { type: Msg.RaceEvent, event: RaceEventType.Lap, playerId: 3, step: 9000, value: 4567 },
      {
        type: Msg.Results,
        rows: [
          { id: 1, name: 'x', position: 1, finishSteps: 12345, bestLapSteps: 4000, bot: false },
        ],
      },
      { type: Msg.Pong, t: 1.5, serverStep: 777 },
      { type: Msg.Error, code: 'version', message: 'обновите страницу' },
    ];
    for (const m of msgs) {
      const d = decodeServer(encodeServer(m));
      if (m.type === Msg.Lobby) expect((d as typeof m).players).toEqual(m.players);
      else expect(d).toEqual(m);
    }
    const snap = decodeServer(
      encodeServer({
        type: Msg.Snapshot,
        step: 600,
        startStep: 180,
        entries: [{ id: 2, lap: 1, position: 3, car }],
      }),
    );
    if (snap.type !== Msg.Snapshot) throw new Error('type');
    expect(snap.entries[0]!.position).toBe(3);
    closeCar(snap.entries[0]!.car, car);
  });

  it('snapshot of 8 cars fits in a small packet', () => {
    const entries = Array.from({ length: 8 }, (_, i) => ({ id: i, lap: 0, position: i + 1, car }));
    expect(
      encodeServer({ type: Msg.Snapshot, step: 1, startStep: 0, entries }).length,
    ).toBeLessThan(400);
  });

  it('truncated or unknown messages throw ProtocolError', () => {
    const b = encodeClient({ type: Msg.State, step: 1, seq: 1, car });
    expect(() => decodeClient(b.slice(0, 10))).toThrow(ProtocolError);
    expect(() => decodeClient(new Uint8Array([200]))).toThrow(ProtocolError);
    expect(() => decodeServer(new Uint8Array([3]))).toThrow(ProtocolError);
  });
});
